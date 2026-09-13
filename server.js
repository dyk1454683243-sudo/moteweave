import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { routeApi } from './src/server/routes/index.js'
import { legacyStudioRedirectLocation } from './src/server/legacyStudioRedirect.js'
import { acceptFullSheetGeneration } from './src/server/fullSheetGenerationAcceptance.js'
import { buildCharacterPackArtifactManifest } from './src/character-pack/artifactManifest.js'
import { writeCharacterPackArtifacts } from './src/character-pack/artifactWriter.js'
import { buildBenchmarkGallery } from './src/character-pack/benchmark/benchmarkGallery.js'
import {
  actionRepairRegionKeyForFrameIndex,
  isActionRepairSourceLayoutId,
  normalizeActionRepairActions,
  resolveActionRepairLayout,
} from './src/character-pack/actionRepairLayouts.js'
import { DEFAULT_GENERATION_PRESET } from './src/character-pack/generationDefaults.js'
import {
  BACKGROUND_RECIPE_IDS,
  resolveBackgroundMode,
} from './src/character-pack/backgroundProcessingContract.js'
import {
  assertFullSheetGenerationProfileRequest,
  resolveFullSheetGenerationProfile,
} from './src/character-pack/generationProfiles.js'
import {
  GENERATION_PROMPT_FILE,
  GENERATION_REFERENCE_MANIFEST_FILE,
  GENERATION_REQUEST_MANIFEST_FILE,
  GENERATION_REVIEW_FILE,
  assertFullSheetGenerationReferenceManifest,
  assertFullSheetGenerationRequestManifest,
  assertFullSheetGenerationReview,
  buildFullSheetGenerationReview,
  hashGenerationReviewValue,
  sha256GenerationBytes,
} from './src/character-pack/generationReview.js'
import {
  buildIdentityReferenceBoard,
  buildPaletteReferenceBoard,
  buildStructureReferenceBoard,
} from './src/character-pack/generationReferenceBoards.js'
import { encodeRgbaPng, loadRgba } from './src/character-pack/imageCodec.js'
import { getGeminiProviderState } from './src/character-pack/providers/geminiProvider.js'
import {
  buildGeminiGenerateContentUrl,
  resolveProviderPreset,
} from './src/character-pack/providers/providerConfig.js'
import { createJob, getJob, JOB_STATUS, updateJob } from './src/character-pack/jobStore.js'
import { createJobQueue } from './src/character-pack/jobQueue.js'
import { processSheetBuffer } from './src/character-pack/processSheet.js'
import { normalizePixelGridRefinementOptions } from './src/character-pack/pixelGridRefinement.js'
import { applyPixelStyleCorrection } from './src/character-pack/stylePipeline.js'
import {
  buildFixedRegionSourceRepairPlan,
  buildFixedRegionSourceRepairReferenceBundle,
  finalizeFixedRegionSourceRepairPlan,
  runFixedRegionSourceRepairLoop,
  serializeFixedRegionSourceRepairLoopResult,
  serializeFixedRegionSourceRepairPlan,
} from './src/character-pack/sourceRegionRepair.js'
import {
  FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES,
  FIXED_REGION_ACTION_REPAIR_REVIEW_FILE,
  assertFixedRegionActionRepairReviewContract,
  buildFixedRegionActionRepairAcceptanceManifest,
  buildFixedRegionActionRepairReviewContract,
  fixedRegionActionRepairArtifactKey,
  hashActionRepairValue,
  sha256ActionRepairBytes,
} from './src/character-pack/fixedRegionActionRepairReview.js'
import {
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from './src/character-pack/sourceLayoutIds.js'
import {
  loadAuthoritativeGenerationStructureImage,
  loadTemplateImage,
} from './src/character-pack/templateStore.js'
import { writeTextToImageArtifacts } from './src/character-pack/textToImageArtifacts.js'
import {
  normalizeGenerationOptions,
  normalizePromptFields,
  normalizeTextToImageMode,
  resolveTextToImageAspectRatio,
  TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
} from './src/character-pack/textToImagePrompt.js'
import {
  runProductionSheetTextToImage,
  runQualityCharacterTextToImage,
} from './src/character-pack/textToImageGeneration.js'
import { buildFrameGifFromImages } from './src/frameGif.js'
import { loadCharacterPackResultFromDir, loadScenePackResultFromDir } from './src/project-pack/artifactLoader.js'
import { writeProjectPackArtifacts } from './src/project-pack/artifactWriter.js'
import { buildProjectPack } from './src/project-pack/projectPack.js'
import { writeScenePackArtifacts } from './src/scene-pack/artifactWriter.js'
import {
  buildTileConditioningReview,
  renderTileConditioningContactSheet,
} from './src/scene-pack/tileConditioningReview.js'
import { conditionTileSheetEdges } from './src/scene-pack/tileEdgeConditioning.js'
import { generateSceneTilePack } from './src/scene-pack/tileGenerate.js'
import { buildScenePackFromTileSheet } from './src/scene-pack/tileSheetIngestion.js'
import { writeTwoPointFiveDTilesetArtifacts } from './src/two-point-five-d/atlasExporter.js'
import { generateTwoPointFiveDMaterialSource } from './src/two-point-five-d/aiMaterialSourceBridge.js'
import {
  buildTwoPointFiveDMaterialSourceBenchmarkPlan,
  runTwoPointFiveDMaterialSourceBenchmark,
} from './src/two-point-five-d/materialSourceBenchmark.js'
import { analyzeMotionSource } from './src/motion-source/sourceAnalyzer.js'
import { createMotionSourceContract } from './src/motion-source/contract.js'
import { buildMotionStrip } from './src/motion-source/stripBuilder.js'
import { applyMotionStrip } from './src/motion-source/stripApplier.js'
import { applyMotionSourceSet } from './src/motion-source/sourceSetApplier.js'
import { validateMotionSourceSetManifest } from './src/motion-source/sourceSet.js'
import { evaluateIdentityConsistency } from './src/motion-source/identityConsistencyGate.js'
import { buildMotionFramePreviewArtifacts } from './src/motion-source/framePreview.js'
import { applyExternalMattingToFrames, resolveRembgPath } from './src/motion-source/externalMatting.js'
import { runGuardedTool } from './src/motion-source/guardedToolRunner.js'
import {
  createMotionSourceJobLifecycle,
  motionSourceCancellationPatch,
} from './src/motion-source/jobLifecycle.js'
import { normalizeMotionSelectionRequest } from './src/motion-source/selectionMode.js'
import {
  MOTION_SELECTION_RECIPE_IDS,
  normalizeMotionSelectionOptions,
} from './src/motion-source/frameSelector.js'
import { createMotionSourceUploadStore } from './src/motion-source/uploadStore.js'
import { extractFrames, resolveFfmpegPath } from './src/video-sprite/frameExtractor.js'
import {
  createEditorArtifactAccessRegistry,
  handleEditorProjectApi,
} from './src/editor-project/apiHandler.js'
import { resolveManagedRevisionArtifactFile } from './src/editor-project/paths.js'
import { loadEditorProject } from './src/editor-project/projectStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    if (Object.hasOwn(process.env, key)) continue
    process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '')
  }
}

loadLocalEnv()

const port = Number(process.env.PORT || 4173)
const generatedDir = path.join(__dirname, 'generated')
const motionSourceSpoolDir = process.env.MOTION_SOURCE_SPOOL_DIR
  ? path.resolve(process.env.MOTION_SOURCE_SPOOL_DIR)
  : path.join(
      os.tmpdir(),
      'gametool-motion-source',
      `server-${process.pid}-${randomUUID().replaceAll('-', '')}`
    )
const editorWorkspaceDir = process.env.EDITOR_WORKSPACE_ROOT
  ? path.resolve(process.env.EDITOR_WORKSPACE_ROOT)
  : path.join(__dirname, 'workspace')
const editorGeneratedDir = process.env.EDITOR_GENERATED_DIR
  ? path.resolve(process.env.EDITOR_GENERATED_DIR)
  : generatedDir
const editorArtifactAccessRegistry = createEditorArtifactAccessRegistry()
let runtimeProviderEnv = {}
const jobQueue = createJobQueue({ concurrency: process.env.CHARACTER_JOB_CONCURRENCY || 2 })
const motionMediaQueue = createJobQueue({ concurrency: 1 })
const motionSourceUploadStore = createMotionSourceUploadStore({ spoolDir: motionSourceSpoolDir })
const motionSourceLifecycle = createMotionSourceJobLifecycle()
const motionSourcePendingReleases = new Set()
const motionSourceWorkerReferences = new Map()
const motionSourcePendingUploadOperationReleases = new Set()
const motionSourceReleaseRetryTimers = new Map()
const motionSourceReleaseRetryAttempts = new Map()
const MOTION_SOURCE_PENDING_RELEASE_OPERATION_LIMIT = 1024
const MOTION_SOURCE_RELEASE_RETRY_DELAYS_MS = Object.freeze([250, 1000, 4000])
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ldtk': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.tsx': 'application/xml; charset=utf-8',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function currentProviderEnv() {
  return { ...process.env, ...runtimeProviderEnv }
}

function publicProviderState() {
  return {
    ...getGeminiProviderState(currentProviderEnv()),
    runtime_configured: Boolean(runtimeProviderEnv.CHARACTER_IMAGE_API_KEY),
  }
}

function publicTwoPointFiveDMaterialSourceProviderConfig(providerPresetId = '') {
  const state = getGeminiProviderState(currentProviderEnv())
  const requestedId = providerPresetId || state.active_preset_id || ''
  const selected = state.presets.find((preset) => preset.id === requestedId) ||
    state.presets.find((preset) => preset.id === state.active_preset_id) ||
    state.presets[0] ||
    null
  return {
    available: state.available,
    status: state.status,
    runtime_configured: Boolean(runtimeProviderEnv.CHARACTER_IMAGE_API_KEY),
    requested_provider_preset_id: providerPresetId || null,
    active_preset_id: state.active_preset_id,
    selected_preset_id: selected?.id ?? null,
    provider: selected?.provider ?? state.provider,
    route_kind: selected?.route_kind ?? null,
    model: selected?.model ?? state.model,
    selected_available: Boolean(selected?.available),
    image_config: selected?.image_config ?? null,
  }
}

function twoPointFiveDMaterialSourceProviderBinding(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expectedProviderConfig must be an object')
  }
  const binding = {
    selected_available: value.selected_available === true,
    selected_preset_id: String(value.selected_preset_id ?? ''),
    provider: String(value.provider ?? ''),
    route_kind: String(value.route_kind ?? ''),
    model: String(value.model ?? ''),
  }
  if (['selected_preset_id', 'provider', 'route_kind', 'model'].some((field) => !binding[field])) {
    throw new Error('expectedProviderConfig must seal preset, provider, route, and model')
  }
  return binding
}

function twoPointFiveDMaterialSourceProviderBindingMatches(left, right) {
  return ['selected_available', 'selected_preset_id', 'provider', 'route_kind', 'model']
    .every((field) => left[field] === right[field])
}

function runtimeString(body = {}, ...keys) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) return String(body[key]).trim()
  }
  return ''
}

function runtimeProviderConfigFromBody(body = {}) {
  const provider = runtimeString(body, 'provider', 'providerType', 'provider_type')
  const model = runtimeString(body, 'model', 'imageModel', 'image_model')
  const apiKey = runtimeString(body, 'apiKey', 'api_key')
  if (!provider) throw new Error('provider is required')
  if (!model) throw new Error('model is required')
  if (!apiKey) throw new Error('apiKey is required')

  const imageSize = runtimeString(body, 'imageSize', 'image_size')
  const aspectRatio = runtimeString(body, 'aspectRatio', 'aspect_ratio')
  const baseUrl = runtimeString(body, 'baseUrl', 'base_url')
  return {
    CHARACTER_PROVIDER_PRESETS: '',
    OPENROUTER_PROVIDER_PRESETS: '',
    CHARACTER_IMAGE_PRESET_ID: 'browser-runtime',
    CHARACTER_DEFAULT_PROVIDER: 'browser-runtime',
    CHARACTER_IMAGE_PROVIDER_LABEL: 'Browser session',
    CHARACTER_IMAGE_PROVIDER: provider,
    CHARACTER_IMAGE_MODEL: model,
    CHARACTER_IMAGE_API_KEY: apiKey,
    ...(imageSize ? { CHARACTER_IMAGE_SIZE: imageSize } : {}),
    ...(aspectRatio ? { CHARACTER_IMAGE_ASPECT_RATIO: aspectRatio } : {}),
    ...(baseUrl ? { CHARACTER_IMAGE_BASE_URL: baseUrl } : {}),
  }
}

function uploadedImageFromBody(body, prefix, fallbackName) {
  const base64 = body[`${prefix}_image_base64`]
  if (!base64) return null
  return {
    name: body[`${prefix}_image_name`] || fallbackName,
    mimeType: body[`${prefix}_image_mime`] || 'image/png',
    buffer: Buffer.from(base64, 'base64'),
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function boundedBodyError(code, message, httpStatus) {
  return Object.assign(new Error(message), {
    code,
    http_status: httpStatus,
  })
}

async function readBodyBounded(req, maxBytes) {
  const contentLength = req.headers['content-length']
  if (contentLength != null) {
    const declared = Number(contentLength)
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw boundedBodyError(
        'invalid_acceptance_request',
        'Content-Length must be a non-negative integer',
        400,
      )
    }
    if (declared > maxBytes) {
      throw boundedBodyError('acceptance_request_too_large', 'manual acceptance request is too large', 413)
    }
  }
  const chunks = []
  let totalBytes = 0
  for await (const chunk of req) {
    totalBytes += chunk.byteLength
    if (totalBytes > maxBytes) {
      throw boundedBodyError('acceptance_request_too_large', 'manual acceptance request is too large', 413)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, totalBytes)
}

const MOTION_SOURCE_LEGACY_JSON_LIMIT = 16 * 1024 * 1024
const MOTION_CLIENT_PATH_FIELDS = new Set([
  'inputPath',
  'input_path',
  'videoOutputDir',
  'video_output_dir',
  'ffmpegPath',
  'ffmpeg_path',
  'rembgPath',
  'rembg_path',
])

function motionRequestError(code, reason, { httpStatus = 400, retryHint = null, details = null } = {}) {
  return Object.assign(new Error(reason), {
    code,
    status: code,
    failure_status: code,
    http_status: httpStatus,
    retry_hint: retryHint,
    details,
  })
}

async function readMotionSourceBody(req) {
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined) {
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw motionRequestError('invalid_content_length', 'Content-Length must be a non-negative integer')
    }
    if (parsedLength > MOTION_SOURCE_LEGACY_JSON_LIMIT) {
      throw motionRequestError(
        'use_motion_source_upload',
        'Motion JSON requests are limited to 16 MiB; upload source media with /api/motion-source/uploads.',
        { httpStatus: 413, retryHint: 'use_motion_source_upload' }
      )
    }
  }
  const chunks = []
  let byteLength = 0
  for await (const chunk of req) {
    byteLength += chunk.length
    if (byteLength > MOTION_SOURCE_LEGACY_JSON_LIMIT) {
      throw motionRequestError(
        'use_motion_source_upload',
        'Motion JSON requests are limited to 16 MiB; upload source media with /api/motion-source/uploads.',
        { httpStatus: 413, retryHint: 'use_motion_source_upload' }
      )
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, byteLength)
}

async function parseMotionSourceJson(req) {
  let raw
  try {
    raw = await readMotionSourceBody(req)
  } catch (error) {
    throw error
  }
  try {
    return assertMotionSourceJsonShape(JSON.parse(raw.toString('utf8')))
  } catch (error) {
    if (error?.code === 'invalid_motion_request_shape') throw error
    throw motionRequestError('invalid_json', String(error.message || error))
  }
}

function isPlainJsonRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertMotionSourceJsonShape(value) {
  if (!isPlainJsonRecord(value)) {
    throw motionRequestError(
      'invalid_motion_request_shape',
      'Motion JSON request body must be an object.'
    )
  }
  if (Object.hasOwn(value, 'options') && !isPlainJsonRecord(value.options)) {
    throw motionRequestError(
      'invalid_motion_request_shape',
      'Motion JSON options must be an object when provided.'
    )
  }
  const limits = {
    maxDepth: 16,
    maxNodes: 20_000,
    maxObjectKeys: 4_096,
    maxArrayLength: 1_024,
  }
  const pending = [{ item: value, depth: 0 }]
  let nodes = 0
  let objectKeys = 0
  while (pending.length) {
    const { item, depth } = pending.pop()
    nodes += 1
    if (nodes > limits.maxNodes || depth > limits.maxDepth) {
      throw motionRequestError(
        'invalid_motion_request_shape',
        'Motion JSON request exceeds the supported structure budget.'
      )
    }
    if (!item || typeof item !== 'object') continue
    if (Array.isArray(item)) {
      if (item.length > limits.maxArrayLength) {
        throw motionRequestError(
          'invalid_motion_request_shape',
          'Motion JSON array exceeds the supported length budget.'
        )
      }
      for (let index = item.length - 1; index >= 0; index -= 1) {
        pending.push({ item: item[index], depth: depth + 1 })
      }
      continue
    }
    const keys = Object.keys(item)
    objectKeys += keys.length
    if (objectKeys > limits.maxObjectKeys) {
      throw motionRequestError(
        'invalid_motion_request_shape',
        'Motion JSON request has too many object fields.'
      )
    }
    for (const key of keys) pending.push({ item: item[key], depth: depth + 1 })
  }
  return value
}

function rejectMotionClientPaths(body) {
  const pending = [{ value: body, path: '$' }]
  const seen = new Set()
  while (pending.length) {
    const { value, path: valuePath } = pending.pop()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach((item, index) => pending.push({ value: item, path: `${valuePath}[${index}]` }))
      continue
    }
    for (const [key, item] of Object.entries(value)) {
      if (MOTION_CLIENT_PATH_FIELDS.has(key)) {
        throw motionRequestError(
          'client_path_not_allowed',
          `Motion browser/API requests cannot set local path field ${key}.`,
          { details: { field: key, path: `${valuePath}.${key}` } }
        )
      }
      pending.push({ value: item, path: `${valuePath}.${key}` })
    }
  }
}

function sendMotionError(res, error, fallbackCode = 'motion_source_request_failed') {
  return sendJson(res, Number(error?.http_status) || 400, {
    error: error?.code ?? fallbackCode,
    code: error?.code ?? fallbackCode,
    failure_status: error?.failure_status ?? error?.code ?? fallbackCode,
    reason: String(error?.reason ?? error?.message ?? error),
    retry_hint: error?.retry_hint ?? null,
    ...(error?.details ? { details: error.details } : {}),
  })
}

async function writeJobArtifacts(job, result, artifactWriteOptions = {}) {
  const written = await writeCharacterPackArtifacts({
    jobId: job.id,
    outputDir: generatedDir,
    result,
    ...artifactWriteOptions,
  })
  const releaseGate = result.generationReleaseGate ?? null
  updateJob(job.id, {
    status: written.status,
    ...written.urls,
    reason: written.reason,
    retry_hint: written.retry_hint,
    ...(releaseGate ? {
      release_gate: releaseGate,
      release_ready: written.artifact_disposition === 'release' && result.releaseReady === true,
      artifact_disposition: written.artifact_disposition ?? 'diagnostic_only',
      failure_status: written.failure_status ?? null,
      manual_review_required: written.manual_review_required === true,
      review_status: written.review_status ?? null,
      human_decision_status: written.human_decision_status ?? null,
    } : {}),
  })
}

async function writeTextToImageJobArtifacts(job, result) {
  const written = await writeTextToImageArtifacts({ jobId: job.id, outputDir: generatedDir, result })
  const releaseGate = result.generationReleaseGate ?? null
  updateJob(job.id, {
    status: written.status,
    ...written.urls,
    reason: written.reason,
    retry_hint: written.retry_hint,
    ...(releaseGate ? {
      release_gate: releaseGate,
      release_ready: written.artifact_disposition === 'release' && result.releaseReady === true,
      artifact_disposition: written.artifact_disposition ?? 'diagnostic_only',
      failure_status: written.failure_status ?? null,
    } : {}),
  })
}

async function writeSceneJobArtifacts(job, result) {
  const written = await writeScenePackArtifacts({ jobId: job.id, outputDir: generatedDir, result })
  updateJob(job.id, {
    status: written.status,
    ...written.urls,
    reason: written.reason,
    retry_hint: written.retry_hint,
  })
}

async function writeProjectJobArtifacts(job, result) {
  const written = await writeProjectPackArtifacts({ jobId: job.id, outputDir: generatedDir, result })
  updateJob(job.id, {
    status: written.status,
    ...written.urls,
    reason: written.reason,
    retry_hint: written.retry_hint,
  })
}

function generatedUrlForFile(filePath) {
  const rel = path.relative(generatedDir, filePath).split(path.sep).join('/')
  return `/generated/${rel}`
}

async function writeTwoPointFiveDJobArtifacts(job, result) {
  const urls = Object.fromEntries(Object.entries(result.artifacts ?? {}).map(([key, filePath]) => [`${key}_url`, generatedUrlForFile(filePath)]))
  updateJob(job.id, {
    status: 'done',
    ...urls,
    validation_status: result.validation?.status ?? null,
    tile_map_status: result.tile_map_validation?.status ?? null,
    map_editor_workflow_status: result.map_editor_workflow?.status ?? null,
    map_editor_operation_count: result.map_editor_workflow?.operations?.length ?? 0,
    ldtk_project_status: result.ldtk_project_validation?.status ?? null,
    ldtk_workflow_validation_status: result.ldtk_workflow_validation?.status ?? null,
    workflow_release_evidence_status: result.workflow_release_evidence?.status ?? null,
    workflow_release_ready: result.workflow_release_evidence?.release_ready ?? null,
    consumer_package_audit_status: result.consumer_package_audit?.status ?? null,
    import_validation_status: result.import_validation?.status ?? null,
    release_demo_pack_status: result.release_demo_manifest?.status ?? null,
    release_demo_release_ready: result.release_demo_manifest?.release_ready ?? null,
    external_tool_probe_status: result.external_tool_probe?.status ?? null,
    external_import_smoke_status: result.external_import_smoke?.status ?? null,
    external_roundtrip_validation_status: result.external_roundtrip_validation?.status ?? null,
    external_roundtrip_ready: result.external_roundtrip_validation?.ready_for_manual_roundtrip ?? null,
    ai_material_source_bridge_status: result.ai_material_source_bridge?.status ?? null,
    ai_material_source_provider: result.ai_material_source_bridge?.provider ?? null,
    ai_material_source_provider_preset_id: result.ai_material_source_bridge?.provider_preset_id ?? null,
    ai_material_source_model: result.ai_material_source_bridge?.model ?? null,
    provider_call_budget: result.ai_material_source_bridge?.provider_call_budget ?? null,
    reason: null,
    retry_hint: null,
  })
}

function safeGeneratedJobDir(jobId) {
  const id = String(jobId ?? '')
  if (!/^[a-zA-Z0-9._-]+$/.test(id) || id.includes('..')) throw new Error(`invalid generated job id: ${id || '(empty)'}`)
  return path.join(generatedDir, id)
}

function repairActionFromBody(body = {}) {
  return String(
    body.animation ??
    body.action ??
    body.runtime_action ??
    body.options?.animation ??
    body.options?.action ??
    ''
  ).trim()
}

function repairActionsFromBody(body = {}) {
  const options = body.options ?? {}
  const raw =
    body.actions ??
    body.sourceActions ??
    body.source_actions ??
    body.animations ??
    options.actions ??
    options.sourceActions ??
    options.source_actions ??
    null
  const actions = Array.isArray(raw) ? raw : raw ? [raw] : [repairActionFromBody(body)]
  return [...new Set(actions.map((action) => String(action ?? '').trim()).filter(Boolean))]
}

function repairRegionKeysFromBody(body = {}) {
  const options = body.options ?? {}
  const raw = body.regionKeys ?? body.region_keys ??
    options.regionKeys ?? options.region_keys ?? null
  if (raw == null) return null
  const regionKeys = Array.isArray(raw) ? raw : [raw]
  return [...new Set(regionKeys.map((key) => String(key ?? '').trim()).filter(Boolean))]
}

function repairProviderPresetIdFromBody(body = {}) {
  return String(
    body.providerPresetId ??
    body.provider_preset_id ??
    body.provider_preset ??
    body.options?.providerPresetId ??
    body.options?.provider_preset_id ??
    ''
  ).trim()
}

function repairImageConfigFromBody(body = {}) {
  const options = body.options ?? {}
  const input = body.imageConfig ?? body.image_config ?? options.imageConfig ?? options.image_config ?? {}
  const imageSize = input.image_size ?? input.imageSize ?? body.imageSize ?? body.image_size ?? options.imageSize ?? options.image_size
  const aspectRatio = input.aspect_ratio ?? input.aspectRatio ?? body.aspectRatio ?? body.aspect_ratio ?? options.aspectRatio ?? options.aspect_ratio
  return {
    ...(imageSize ? { image_size: imageSize } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
  }
}

function repairEquipmentPolicyFromBody(body = {}) {
  const options = body.options ?? {}
  return body.equipmentPolicy ?? body.equipment_policy ??
    options.equipmentPolicy ?? options.equipment_policy ?? 'none'
}

function repairInstructionFromBody(body = {}) {
  const options = body.options ?? {}
  return body.instruction ?? body.repairInstruction ?? body.repair_instruction ??
    options.instruction ?? options.repairInstruction ?? options.repair_instruction ??
    'Correct the selected action slots while preserving the character identity.'
}

function fixedRegionActionRepairIdentityFromBody(body = {}, sourceJobId = '') {
  const identity = {
    project_id: String(body.projectId ?? body.project_id ?? '').trim(),
    asset_id: String(body.assetId ?? body.asset_id ?? '').trim(),
    parent_revision_id: String(body.parentRevisionId ?? body.parent_revision_id ?? '').trim(),
    source_job_id: String(sourceJobId ?? '').trim(),
  }
  for (const [key, value] of Object.entries(identity)) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(value) || value.includes('..')) {
      throw new Error(`action repair ${key} is required and must be a safe id`)
    }
  }
  return identity
}

function fixedRegionActionRepairReviewBindingFromBody(body = {}) {
  const reviewId = String(body.reviewedRunId ?? body.reviewed_run_id ?? '').trim()
  const expectedPlanHash = String(body.expectedPlanHash ?? body.expected_plan_hash ?? '').trim()
  const expectedReferenceManifestSha256 = String(
    body.expectedReferenceManifestSha256 ?? body.expected_reference_manifest_sha256 ?? '',
  ).trim()
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(reviewId) || reviewId.includes('..')) {
    throw new Error('reviewedRunId is required for action repair live generation')
  }
  if (!/^[a-f0-9]{64}$/.test(expectedPlanHash)) {
    throw new Error('expectedPlanHash is required for action repair live generation')
  }
  if (!/^[a-f0-9]{64}$/.test(expectedReferenceManifestSha256)) {
    throw new Error('expectedReferenceManifestSha256 is required for action repair live generation')
  }
  return { reviewId, expectedPlanHash, expectedReferenceManifestSha256 }
}

function repairNormalizedFrameMappings(debugReport = {}, sourceLayoutId = debugReport.source_layout?.id) {
  return (Array.isArray(debugReport.frames) ? debugReport.frames : [])
    .map((frame) => ({
      frame_index: frame?.index,
      region_key: frame?.source_frame?.region_key ?? actionRepairRegionKeyForFrameIndex(sourceLayoutId, frame?.index),
    }))
    .filter((item) => Number.isInteger(item.frame_index) && typeof item.region_key === 'string')
}

function repairMotionTemplateForSourceLayout(sourceLayoutId) {
  const layout = resolveActionRepairLayout(sourceLayoutId)
  return {
    enabled: true,
    preset: layout.template_preset,
    layout: layout.id,
  }
}

function isActionRepairDebugReport(debugReport = {}) {
  return isActionRepairSourceLayoutId(debugReport.source_layout?.id)
}

function requiredManagedRepairIdentity(body = {}, camelKey, snakeKey, label) {
  const value = String(body[camelKey] ?? body[snakeKey] ?? '').trim()
  if (!value) throw new Error(`${label} is required when the source job is not active`)
  return value
}

async function assertManagedRevisionRepairIdentity(body = {}, sourceJobId) {
  const projectId = requiredManagedRepairIdentity(body, 'projectId', 'project_id', 'projectId')
  const assetId = requiredManagedRepairIdentity(body, 'assetId', 'asset_id', 'assetId')
  const parentRevisionId = requiredManagedRepairIdentity(
    body,
    'parentRevisionId',
    'parent_revision_id',
    'parentRevisionId',
  )
  const { project } = await loadEditorProject({
    projectId,
    projectRoot: __dirname,
    workspaceRoot: editorWorkspaceDir,
  })
  const asset = project.id === projectId ? project.assets?.[assetId] : null
  const revision = asset?.revisions?.[parentRevisionId]
  if (
    asset?.id !== assetId ||
    asset.kind !== 'character_pack' ||
    asset.active_revision_id !== parentRevisionId ||
    revision?.id !== parentRevisionId ||
    revision.source_job_id !== sourceJobId
  ) {
    throw new Error('managed character repair identity does not match the active parent revision')
  }
  return { projectId, assetId, parentRevisionId, revision }
}

async function managedRevisionRepairSourceContext(body = {}, sourceJobId, verifiedIdentity = null) {
  const {
    projectId,
    assetId,
    revision,
  } = verifiedIdentity ?? await assertManagedRevisionRepairIdentity(body, sourceJobId)
  const artifactOptions = {
    projectId,
    assetId,
    revision,
    projectRoot: __dirname,
    workspaceRoot: editorWorkspaceDir,
  }
  const [debugReportPath, normalizedSheetPath, sourceSheetPath] = await Promise.all([
    resolveManagedRevisionArtifactFile({ ...artifactOptions, artifactKey: 'debug_report' }),
    resolveManagedRevisionArtifactFile({ ...artifactOptions, artifactKey: 'sheet' }),
    resolveManagedRevisionArtifactFile({ ...artifactOptions, artifactKey: 'source' }),
  ])
  const debugReport = JSON.parse(await readFile(debugReportPath, 'utf8'))
  if (!isActionRepairDebugReport(debugReport)) {
    throw new Error('managed revision repair recovery requires a supported action-repair source layout')
  }
  return {
    sourceJobId,
    sourceJob: {
      id: sourceJobId,
      type: 'editor_managed_character_revision',
      status: 'done',
      description: '',
    },
    sourceDir: path.dirname(debugReportPath),
    debugReport,
    debugReportPath,
    normalizedSheetPath,
    sourceSheetPath,
  }
}

async function repairSourceContextFromBody(body = {}) {
  const sourceJobId = String(body.jobId ?? body.job_id ?? body.sourceJobId ?? body.source_job_id ?? '').trim()
  if (!sourceJobId) throw new Error('jobId is required')
  const verifiedIdentity = await assertManagedRevisionRepairIdentity(body, sourceJobId)
  const sourceJob = getJob(sourceJobId)
  if (!sourceJob) return managedRevisionRepairSourceContext(body, sourceJobId, verifiedIdentity)
  const sourceDir = safeGeneratedJobDir(sourceJobId)
  const debugReportPath = path.join(sourceDir, 'debug_report.json')
  const normalizedSheetPath = path.join(sourceDir, 'normalized_sheet.png')
  const sourceSheetPath = path.join(sourceDir, 'source.png')
  if (!existsSync(debugReportPath) || !existsSync(normalizedSheetPath)) {
    throw new Error('source job is missing character pack artifacts; process or generate a character sheet first')
  }
  const debugReport = JSON.parse(await readFile(debugReportPath, 'utf8'))
  return {
    sourceJobId,
    sourceJob,
    sourceDir,
    debugReport,
    debugReportPath,
    normalizedSheetPath,
    sourceSheetPath: existsSync(sourceSheetPath) ? sourceSheetPath : null,
  }
}

function assertActionRepairSource(debugReport = {}, actions = []) {
  const sourceLayoutId = debugReport.source_layout?.id
  if (!isActionRepairDebugReport(debugReport)) {
    throw new Error('character action repair requires topdown_rpg_v0 or fixed_region_motion_v0 source evidence')
  }
  normalizeActionRepairActions(sourceLayoutId, actions)
  return sourceLayoutId
}

async function motionTemplateForRepairPlan(plan) {
  const template = plan.motion_template
  if (!template?.enabled || !template.preset) return null
  const loaded = await loadTemplateImage(template.preset, { rootDir: __dirname })
  if (!loaded) throw new Error(`motion template preset is unavailable: ${template.preset}`)
  return {
    buffer: loaded.buffer,
    name: loaded.name,
    layout: template.layout ?? template.preset,
  }
}

async function writeFixedRegionSourceRepairReferenceFiles(plan, referenceImages = []) {
  const fileByName = new Map([
    ['identity_anchor_atlas.png', plan.files.identity_anchor_atlas],
    ['pose_guide_atlas.png', plan.files.pose_guide_atlas],
    ['empty_output_atlas.png', plan.files.empty_output_atlas],
  ])
  for (const image of referenceImages) {
    const file = fileByName.get(image.name)
    if (file) await writeFile(file, image.buffer)
  }
}

async function writeFixedRegionSourceRepairPlanArtifacts(plan, referenceImages = [], reviewContract = null) {
  await mkdir(plan.output_dir, { recursive: true })
  await writeFile(plan.files.plan, JSON.stringify(serializeFixedRegionSourceRepairPlan(plan), null, 2))
  await writeFile(plan.files.prompt, plan.selected.prompt)
  await writeFixedRegionSourceRepairReferenceFiles(plan, referenceImages)
  if (reviewContract) {
    await writeFile(plan.files.review_contract, JSON.stringify(reviewContract, null, 2))
  }
}

async function writeFixedRegionSourceRepairProviderCandidateArtifacts(plan, { generation, referenceImages = [] } = {}) {
  if (!generation?.raw_provider_png) throw new Error('action-repair provider candidate is required')
  await writeFixedRegionSourceRepairPlanArtifacts(plan, referenceImages)
  await writeFile(plan.files.raw_provider_output, generation.raw_provider_png)
}

async function writeFixedRegionSourceRepairLoopArtifacts(plan, result) {
  if (result.generation) {
    await writeFixedRegionSourceRepairProviderCandidateArtifacts(plan, {
      generation: result.generation,
      referenceImages: result.reference_images ?? [],
    })
    if (result.generation.normalized_provider_source_sheet_png) {
      await writeFile(plan.files.normalized_provider_sheet, result.generation.normalized_provider_source_sheet_png)
    }
    if (result.generation.background_removed_provider_atlas_png) {
      await writeFile(plan.files.background_removed_provider_atlas, result.generation.background_removed_provider_atlas_png)
    }
    if (result.generation.atlas_extraction_report) {
      await writeFile(plan.files.atlas_extraction_report, JSON.stringify(result.generation.atlas_extraction_report, null, 2))
    }
    const extractedFrames = Object.entries(result.generation.extracted_frames ?? {})
    if (extractedFrames.length) {
      await mkdir(plan.files.extracted_frames_dir, { recursive: true })
      for (const [regionKey, buffer] of extractedFrames) {
        await writeFile(path.join(plan.files.extracted_frames_dir, `${regionKey}.png`), buffer)
      }
    }
  } else await writeFixedRegionSourceRepairPlanArtifacts(plan, result.reference_images ?? [])
  if (result.review_candidate) {
    await writeFile(plan.files.review_candidate_source_sheet, result.review_candidate.source_sheet_png)
  }
  if (result.candidate_validation) {
    await writeFile(plan.files.candidate_validation_report, JSON.stringify(result.candidate_validation, null, 2))
  }
  if (result.scope_validation) {
    await writeFile(plan.files.source_scope_report, JSON.stringify(result.scope_validation, null, 2))
  }
  if (result.quality_gate) {
    await writeFile(plan.files.equipment_quality_report, JSON.stringify(result.quality_gate.report, null, 2))
    await writeFile(plan.files.equipment_quality_overlay, result.quality_gate.overlay_png)
    if (result.quality_gate.separated) {
      await writeFile(plan.files.equipment_body_candidate, result.quality_gate.separated.body_candidate_png)
      await writeFile(plan.files.equipment_layer, result.quality_gate.separated.equipment_layer_png)
    }
  }
  if (result.apply_result) await writeFile(plan.files.repaired_source_sheet, result.apply_result.repaired_source_sheet_png)
  await writeFile(plan.files.summary, JSON.stringify(serializeFixedRegionSourceRepairLoopResult(result), null, 2))
}

function fixedRegionSourceRepairArtifactUrls(plan, result = null) {
  return {
    repair_plan_url: generatedUrlForFile(plan.files.plan),
    action_repair_review_contract_url: generatedUrlForFile(plan.files.review_contract),
    action_repair_acceptance_manifest_url: result?.acceptance_manifest
      ? generatedUrlForFile(plan.files.acceptance_manifest)
      : null,
    repair_prompt_url: generatedUrlForFile(plan.files.prompt),
    repair_identity_anchor_atlas_url: generatedUrlForFile(plan.files.identity_anchor_atlas),
    repair_pose_guide_atlas_url: generatedUrlForFile(plan.files.pose_guide_atlas),
    repair_empty_output_atlas_url: generatedUrlForFile(plan.files.empty_output_atlas),
    repair_motion_template_reference_url: null,
    repair_source_sheet_reference_url: null,
    repair_normalized_sheet_reference_url: null,
    repair_summary_url: result ? generatedUrlForFile(plan.files.summary) : null,
    raw_provider_repair_output_url: result?.generation ? generatedUrlForFile(plan.files.raw_provider_output) : null,
    normalized_provider_source_sheet_url: result?.generation?.normalized_provider_source_sheet_png
      ? generatedUrlForFile(plan.files.normalized_provider_sheet)
      : null,
    background_removed_provider_atlas_url: result?.generation?.background_removed_provider_atlas_png
      ? generatedUrlForFile(plan.files.background_removed_provider_atlas)
      : null,
    atlas_extraction_report_url: result?.generation?.atlas_extraction_report
      ? generatedUrlForFile(plan.files.atlas_extraction_report)
      : null,
    repaired_source_sheet_url: result?.apply_result ? generatedUrlForFile(plan.files.repaired_source_sheet) : null,
    review_candidate_source_sheet_url: result?.review_candidate
      ? generatedUrlForFile(plan.files.review_candidate_source_sheet)
      : null,
    candidate_validation_report_url: result?.candidate_validation
      ? generatedUrlForFile(plan.files.candidate_validation_report)
      : null,
    source_scope_report_url: result?.scope_validation
      ? generatedUrlForFile(plan.files.source_scope_report)
      : null,
    equipment_quality_report_url: result?.quality_gate ? generatedUrlForFile(plan.files.equipment_quality_report) : null,
    equipment_quality_overlay_url: result?.quality_gate ? generatedUrlForFile(plan.files.equipment_quality_overlay) : null,
    equipment_body_candidate_url: result?.quality_gate?.separated
      ? generatedUrlForFile(plan.files.equipment_body_candidate)
      : null,
    equipment_layer_url: result?.quality_gate?.separated
      ? generatedUrlForFile(plan.files.equipment_layer)
      : null,
  }
}

async function buildFixedRegionActionRepairReview({ body, reviewId, fixedContext }) {
  const { plan } = fixedContext
  const identity = fixedRegionActionRepairIdentityFromBody(body, fixedContext.sourceJobId)
  const [sourceSheetBuffer, normalizedSheetBuffer, motionTemplate] = await Promise.all([
    readFile(plan.preflight.source_sheet),
    readFile(plan.preflight.normalized_sheet),
    motionTemplateForRepairPlan(plan),
  ])
  if (!motionTemplate?.buffer) throw new Error('action repair motion template is unavailable')
  const referenceBundle = await buildFixedRegionSourceRepairReferenceBundle({
    sourceSheetBuffer,
    normalizedSheetBuffer,
    motionTemplateBuffer: motionTemplate.buffer,
    normalizedFrameMappings: repairNormalizedFrameMappings(fixedContext.debugReport),
    actions: plan.actions,
    regionKeys: plan.region_keys,
    sourceLayoutId: plan.source_layout,
  })
  const reviewContract = buildFixedRegionActionRepairReviewContract({
    reviewId,
    identity,
    plan,
    sourceSheetBuffer,
    normalizedSheetBuffer,
    motionTemplateBuffer: motionTemplate.buffer,
    referenceBundle,
  })
  return {
    identity,
    sourceSheetBuffer,
    normalizedSheetBuffer,
    motionTemplateBuffer: motionTemplate.buffer,
    referenceBundle,
    reviewContract,
  }
}

async function readReviewedFixedRegionActionRepairReferences(reviewDir, reviewContract) {
  const referenceImages = []
  for (let index = 0; index < FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES.length; index += 1) {
    const expected = FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES[index]
    const recorded = reviewContract.references.items[index]
    const buffer = await readFile(path.join(reviewDir, expected.name))
    if (buffer.byteLength !== recorded.byte_length || sha256ActionRepairBytes(buffer) !== recorded.sha256) {
      throw new Error('reviewed action repair reference changed after planning')
    }
    referenceImages.push({ ...expected, mimeType: 'image/png', buffer })
  }
  return referenceImages
}

async function verifyFixedRegionActionRepairReview({ body, fixedContext }) {
  const binding = fixedRegionActionRepairReviewBindingFromBody(body)
  const reviewDir = safeGeneratedJobDir(binding.reviewId)
  const storedReview = assertFixedRegionActionRepairReviewContract(
    JSON.parse(await readFile(path.join(reviewDir, FIXED_REGION_ACTION_REPAIR_REVIEW_FILE), 'utf8')),
  )
  if (storedReview.review_id !== binding.reviewId || storedReview.plan_hash !== binding.expectedPlanHash ||
      storedReview.references.manifest_sha256 !== binding.expectedReferenceManifestSha256) {
    throw new Error('action repair review binding is stale')
  }
  const current = await buildFixedRegionActionRepairReview({
    body,
    reviewId: binding.reviewId,
    fixedContext,
  })
  if (current.reviewContract.plan_hash !== storedReview.plan_hash ||
      current.reviewContract.references.manifest_sha256 !== storedReview.references.manifest_sha256 ||
      hashActionRepairValue(current.reviewContract) !== hashActionRepairValue(storedReview)) {
    throw new Error('action repair inputs changed after planning')
  }
  const referenceImages = await readReviewedFixedRegionActionRepairReferences(reviewDir, storedReview)
  for (let index = 0; index < referenceImages.length; index += 1) {
    if (sha256ActionRepairBytes(referenceImages[index].buffer) !==
        current.reviewContract.references.items[index].sha256) {
      throw new Error('action repair reviewed references no longer match current authority')
    }
  }
  return {
    ...current,
    reviewContract: storedReview,
    referenceBundle: {
      reference_images: referenceImages,
      evidence: storedReview.atlas_evidence,
    },
  }
}

function fixedRegionActionRepairEvidenceFileNames(plan) {
  const names = [
    plan.files.plan,
    plan.files.review_contract,
    plan.files.summary,
    plan.files.prompt,
    plan.files.identity_anchor_atlas,
    plan.files.pose_guide_atlas,
    plan.files.empty_output_atlas,
    plan.files.raw_provider_output,
    plan.files.background_removed_provider_atlas,
    plan.files.atlas_extraction_report,
    plan.files.normalized_provider_sheet,
    plan.files.repaired_source_sheet,
    plan.files.review_candidate_source_sheet,
    plan.files.candidate_validation_report,
    plan.files.source_scope_report,
    plan.files.equipment_quality_report,
    plan.files.equipment_quality_overlay,
    plan.files.equipment_body_candidate,
    plan.files.equipment_layer,
    ...plan.region_keys.map((key) => path.join(plan.files.extracted_frames_dir, `${key}.png`)),
  ]
  return names.map((filePath) => path.relative(plan.output_dir, filePath).split(path.sep).join('/'))
}

async function writeFixedRegionActionRepairAcceptanceManifest({ jobId, plan, reviewContract, result, processed }) {
  const packManifest = buildCharacterPackArtifactManifest(jobId, processed)
  const names = [...new Set([
    ...packManifest.files.map((entry) => entry.name),
    ...fixedRegionActionRepairEvidenceFileNames(plan),
  ])]
  const artifactEntries = []
  for (const fileName of names) {
    const filePath = path.join(plan.output_dir, fileName)
    if (!existsSync(filePath)) continue
    artifactEntries.push({
      key: fixedRegionActionRepairArtifactKey(fileName),
      file_name: fileName,
      content: await readFile(filePath),
    })
  }
  const manifest = buildFixedRegionActionRepairAcceptanceManifest({
    jobId,
    reviewContract,
    result,
    artifactEntries,
  })
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
  await writeFile(plan.files.acceptance_manifest, manifestBuffer, { flag: 'wx' })
  return {
    manifest,
    sha256: sha256ActionRepairBytes(manifestBuffer),
  }
}

async function buildFixedRegionSourceRepairPlanFromBody(body = {}, { outputDir }) {
  const context = await repairSourceContextFromBody(body)
  const actions = repairActionsFromBody(body)
  const regionKeys = repairRegionKeysFromBody(body)
  const sourceLayoutId = assertActionRepairSource(context.debugReport, actions)
  const repairSourceSheetPath = sourceLayoutId === TOPDOWN_RPG_SOURCE_LAYOUT_ID
    ? context.normalizedSheetPath
    : context.sourceSheetPath
  const basePlan = finalizeFixedRegionSourceRepairPlan(buildFixedRegionSourceRepairPlan({
    sourceJobId: context.sourceJobId,
    sourceLayoutId,
    actions,
    regionKeys,
    outputDir,
    providerPresetId: repairProviderPresetIdFromBody(body),
    imageConfig: repairImageConfigFromBody(body),
    backgroundMode: body.backgroundMode ?? body.background_mode ?? body.options?.backgroundMode ?? 'auto',
    motionTemplate: repairMotionTemplateForSourceLayout(sourceLayoutId),
    sourceSheetPath: repairSourceSheetPath,
    normalizedSheetPath: context.normalizedSheetPath,
    equipmentPolicy: repairEquipmentPolicyFromBody(body),
    instruction: repairInstructionFromBody(body),
  }))
  const preset = resolveProviderPreset(currentProviderEnv(), basePlan.provider_preset_id || '')
  const providerErrors = preset.available === true ? [] : ['selected provider preset is unavailable']
  const plan = {
    ...basePlan,
    can_run: basePlan.can_run && providerErrors.length === 0,
    preflight: {
      ...basePlan.preflight,
      can_run: basePlan.preflight.can_run && providerErrors.length === 0,
      errors: [...basePlan.preflight.errors, ...providerErrors],
    },
    provider: {
      id: preset.id,
      provider: preset.provider,
      label: preset.label,
      model: preset.model,
      available: preset.available === true,
      image_config: {
        ...preset.imageConfig,
        ...basePlan.image_config,
      },
    },
  }
  return { ...context, plan }
}

async function writeDryRunCharacterActionRepairPlan(body, res) {
  const runId = safeRunId(body.runId ?? body.run_id, `repair_plan_${Date.now().toString(36)}`)
  const fixedContext = await buildFixedRegionSourceRepairPlanFromBody(body, { outputDir: safeGeneratedJobDir(runId) })
  const { plan } = fixedContext
  let review = null
  if (plan.can_run) {
    review = await buildFixedRegionActionRepairReview({ body, reviewId: runId, fixedContext })
  }
  await writeFixedRegionSourceRepairPlanArtifacts(
    plan,
    review?.referenceBundle.reference_images ?? [],
    review?.reviewContract ?? null,
  )
  return sendJson(res, 200, {
    mode: 'dry_run_plan',
    repair_mode: 'action_repair_atlas',
    status: plan.can_run ? 'done' : 'blocked',
    run_id: plan.run_id,
    review_id: review?.reviewContract.review_id ?? null,
    plan_hash: review?.reviewContract.plan_hash ?? null,
    reference_manifest_sha256: review?.reviewContract.references.manifest_sha256 ?? null,
    identity: review?.reviewContract.identity ?? null,
    can_run: plan.can_run,
    preflight: plan.preflight,
    estimated_provider_calls: plan.estimated_provider_calls,
    selected_animation: plan.actions[0] ?? null,
    selected_source_action: plan.actions[0] ?? null,
    selected_source_actions: plan.actions,
    selected_region_keys: plan.region_keys,
    selected_frames: plan.region_keys,
    source_action_layout: plan.source_layout,
    provider_preset_id: plan.provider_preset_id,
    provider: plan.provider,
    model: plan.provider.model,
    image_config: plan.image_config,
    equipment_policy: plan.equipment_policy,
    instruction: plan.instruction,
    atlas: plan.atlas,
    reference_policy: plan.reference_policy,
    actions: plan.actions,
    ...fixedRegionSourceRepairArtifactUrls(plan),
    claim_boundary: plan.claim_boundary,
  })
}

async function handleRepairCharacterAction(req, res) {
  loadLocalEnv()
  let body
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'))
  } catch (error) {
    return sendJson(res, 400, { error: 'invalid_json', reason: String(error.message || error) })
  }
  const dryRunPlan = Boolean(body.dryRunPlan ?? body.dry_run_plan)
  if (dryRunPlan) {
    try {
      return await writeDryRunCharacterActionRepairPlan(body, res)
    } catch (error) {
      return sendJson(res, 400, { error: 'repair_plan_failed', reason: String(error.message || error) })
    }
  }
  const liveConfirmed = Boolean(body.confirm_live_generation ?? body.yes)
  if (!liveConfirmed) {
    return sendJson(res, 400, {
      error: 'missing_live_generation_confirmation',
      reason: 'character action repair uses one live provider call; pass dryRunPlan: true to inspect or confirm_live_generation: true',
    })
  }
  if (!hasProviderCallBudgetLimit(body)) {
    return sendJson(res, 400, {
      error: 'missing_provider_call_budget',
      reason: 'character action repair requires maxProviderCalls before live provider generation',
    })
  }
  try {
    const reviewBinding = fixedRegionActionRepairReviewBindingFromBody(body)
    const reviewedPlanContext = await buildFixedRegionSourceRepairPlanFromBody(body, {
      outputDir: safeGeneratedJobDir(reviewBinding.reviewId),
    })
    if (!reviewedPlanContext.plan.can_run) {
      throw new Error(`action repair preflight failed: ${reviewedPlanContext.plan.preflight.errors.join('; ')}`)
    }
    const reviewedProviderCallBudget = providerCallBudgetFromBody(body, {
      plannedProviderCalls: reviewedPlanContext.plan.estimated_provider_calls,
    })
    if (reviewedProviderCallBudget.max_provider_calls !== 1) {
      throw new Error('action repair maxProviderCalls must be exactly 1')
    }
    const reviewed = await verifyFixedRegionActionRepairReview({
      body,
      fixedContext: reviewedPlanContext,
    })
    const job = createJob({ status: JOB_STATUS.QUEUED, type: 'fixed_region_source_provider_repair' })
    let plan
    let fixedContext
    let providerCallBudget
    try {
      fixedContext = await buildFixedRegionSourceRepairPlanFromBody(body, { outputDir: safeGeneratedJobDir(job.id) })
      plan = fixedContext.plan
      if (!plan.can_run) throw new Error(`action repair preflight failed: ${plan.preflight.errors.join('; ')}`)
      providerCallBudget = reviewedProviderCallBudget
      await writeFixedRegionSourceRepairPlanArtifacts(
        plan,
        reviewed.referenceBundle.reference_images,
        reviewed.reviewContract,
      )
      updateJob(job.id, {
        project_id: reviewed.reviewContract.identity.project_id,
        asset_id: reviewed.reviewContract.identity.asset_id,
        parent_revision_id: reviewed.reviewContract.identity.parent_revision_id,
        source_job_id: reviewed.reviewContract.identity.source_job_id,
        action_repair_review_id: reviewed.reviewContract.review_id,
        action_repair_plan_hash: reviewed.reviewContract.plan_hash,
        action_repair_reference_manifest_sha256: reviewed.reviewContract.references.manifest_sha256,
        selected_animation: plan.actions[0] ?? null,
        selected_source_action: plan.actions[0] ?? null,
        selected_source_actions: plan.actions,
        selected_region_keys: plan.region_keys,
        selected_frames: plan.region_keys,
        source_action_layout: plan.source_layout,
        estimated_provider_calls: plan.estimated_provider_calls,
        provider_preset_id: plan.provider_preset_id,
        provider: plan.provider.provider,
        model: plan.provider.model,
        provider_call_budget: publicProviderCallBudget(providerCallBudget),
        repair_mode: 'action_repair_atlas',
        equipment_policy: plan.equipment_policy,
        instruction: plan.instruction,
        accepted: false,
        requires_user_confirmation: true,
        actions: plan.actions,
        ...fixedRegionSourceRepairArtifactUrls(plan),
      })
      jobQueue.enqueue(
          async () => {
            loadLocalEnv()
            updateJob(job.id, { status: JOB_STATUS.GENERATING })
            const result = await runFixedRegionSourceRepairLoop({
              plan,
              sourceSheetBuffer: reviewed.sourceSheetBuffer,
              normalizedSheetBuffer: reviewed.normalizedSheetBuffer,
              motionTemplateBuffer: reviewed.motionTemplateBuffer,
              normalizedFrameMappings: repairNormalizedFrameMappings(
                fixedContext.debugReport,
                plan.source_layout,
              ),
              env: currentProviderEnv(),
              referenceBundle: reviewed.referenceBundle,
              onProviderDispatch: () => {
                providerCallBudget.providerBudget.used = 1
                updateJob(job.id, {
                  provider_call_budget: publicProviderCallBudget(providerCallBudget),
                })
              },
              onProviderCandidate: ({ generation, referenceImages }) => (
                writeFixedRegionSourceRepairProviderCandidateArtifacts(plan, { generation, referenceImages })
              ),
            })
            providerCallBudget.providerBudget.used = result.summary?.provider_calls_used ?? 0
            await writeFixedRegionSourceRepairLoopArtifacts(plan, result)
            if (result.status === 'quality_blocked') {
              updateJob(job.id, {
                status: JOB_STATUS.FAILED_POST_PROCESSING,
                repair_status: result.status,
                quality_status: 'blocked',
                reason: result.error?.code ?? 'equipment_quality_blocked',
                retry_hint: 'manual_review_no_retry',
                provider_call_budget: publicProviderCallBudget(providerCallBudget),
                equipment_policy: plan.equipment_policy,
                accepted: false,
                requires_user_confirmation: true,
                source_scope_status: result.scope_validation?.status ?? null,
                outside_selected_changed_pixels: result.scope_validation?.outside_selected_changed_pixels ?? null,
                source_action_layout: plan.source_layout,
                ...fixedRegionSourceRepairArtifactUrls(plan, result),
              })
              return
            }
            if (result.status === 'failed_post_processing') {
              updateJob(job.id, {
                status: JOB_STATUS.FAILED_POST_PROCESSING,
                repair_status: result.status,
                quality_status: result.summary?.quality_status ?? 'unknown',
                reason: result.error?.code ?? 'local_post_processing_failed',
                retry_hint: result.error?.retry_hint ?? 'manual_review_no_retry',
                provider_call_budget: publicProviderCallBudget(providerCallBudget),
                equipment_policy: plan.equipment_policy,
                accepted: false,
                requires_user_confirmation: true,
                source_scope_status: result.scope_validation?.status ?? null,
                outside_selected_changed_pixels: result.scope_validation?.outside_selected_changed_pixels ?? null,
                source_action_layout: plan.source_layout,
                ...fixedRegionSourceRepairArtifactUrls(plan, result),
              })
              return
            }
            if (!result.generation || !result.apply_result) {
              updateJob(job.id, {
                status: JOB_STATUS.FAILED_MODEL_ERROR,
                repair_status: result.status,
                reason: result.error?.message ?? 'provider repair did not return an applicable action-repair source sheet',
                retry_hint: result.error?.retry_hint ?? 'manual_inspect',
                provider_call_budget: publicProviderCallBudget(providerCallBudget),
                source_action_layout: plan.source_layout,
                ...fixedRegionSourceRepairArtifactUrls(plan, result),
              })
              return
            }
            updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
            const processed = await processSheetBuffer(result.apply_result.repaired_source_sheet_png, {
              name: body.name ?? 'repaired_character',
              description: body.description ?? 'three-atlas action repair result',
              sourceType: 'provider_source_region_repair',
              sourceFileName: 'repaired_source_sheet.png',
              sourceLayout: plan.source_layout,
              backgroundMode: 'passthrough',
              autoCorrect: false,
              motionStabilize: false,
              componentCleanup: false,
              styleReport: true,
            })
            const written = await writeCharacterPackArtifacts({
              jobId: job.id,
              outputDir: generatedDir,
              result: processed,
              allowExistingJobDir: true,
            })
            let acceptance = null
            if (written.status === JOB_STATUS.DONE) {
              acceptance = await writeFixedRegionActionRepairAcceptanceManifest({
                jobId: job.id,
                plan,
                reviewContract: reviewed.reviewContract,
                result,
                processed,
              })
            }
            const resultWithAcceptance = acceptance
              ? { ...result, acceptance_manifest: acceptance.manifest }
              : result
            updateJob(job.id, {
              status: written.status,
              repair_status: result.status,
              repair_summary: result.summary,
              quality_status: result.summary?.quality_status ?? null,
              atlas_extraction_status: result.summary?.atlas_extraction_status ?? null,
              provider: result.generation.provider,
              provider_preset_id: result.generation.provider_preset_id,
              model: result.generation.model,
              provider_call_budget: publicProviderCallBudget(providerCallBudget),
              selected_animation: plan.actions[0] ?? null,
              selected_source_action: plan.actions[0] ?? null,
              selected_source_actions: plan.actions,
              selected_region_keys: plan.region_keys,
              selected_frames: plan.region_keys,
              source_action_layout: plan.source_layout,
              equipment_policy: plan.equipment_policy,
              accepted: false,
              requires_user_confirmation: true,
              source_scope_status: result.scope_validation?.status ?? null,
              outside_selected_changed_pixels: result.scope_validation?.outside_selected_changed_pixels ?? null,
              repair_mode: 'action_repair_atlas',
              action_repair_manifest_sha256: acceptance?.sha256 ?? null,
              actions: plan.actions,
              ...written.urls,
              ...fixedRegionSourceRepairArtifactUrls(plan, resultWithAcceptance),
              reason: written.reason,
              retry_hint: written.retry_hint,
              claim_boundary: result.claim_boundary,
            })
          },
          (error) => {
            updateJob(job.id, generationFailurePatch(error, providerCallBudget, {
              jobStatus: getJob(job.id)?.status ?? null,
            }))
          }
      )
    } catch (error) {
      updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'manual_inspect' })
    }
    return sendJson(res, 202, getJob(job.id))
  } catch (error) {
    return sendJson(res, 400, { error: 'repair_plan_failed', reason: String(error.message || error) })
  }
}

async function handleProviderConfig(req, res) {
  loadLocalEnv()
  let body
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'))
  } catch (error) {
    return sendJson(res, 400, { error: 'invalid_json', reason: String(error.message || error) })
  }

  try {
    if (body.clear) {
      runtimeProviderEnv = {}
      return sendJson(res, 200, { ok: true, provider_state: publicProviderState() })
    }

    const nextRuntimeEnv = runtimeProviderConfigFromBody(body)
    const nextState = getGeminiProviderState({ ...process.env, ...nextRuntimeEnv })
    if (!nextState.available || nextState.status === 'configuration_error') {
      return sendJson(res, 400, {
        error: 'provider_config_invalid',
        reason: nextState.error || 'provider config is not available',
        provider_state: {
          ...nextState,
          runtime_configured: false,
        },
      })
    }

    runtimeProviderEnv = nextRuntimeEnv
    return sendJson(res, 200, { ok: true, provider_state: publicProviderState() })
  } catch (error) {
    return sendJson(res, 400, { error: 'provider_config_invalid', reason: String(error.message || error) })
  }
}

function sceneStyleCorrectionOptions(options = {}) {
  if (!options.styleSnap && !options.style_snap) return undefined
  return {
    mode: 'palette_snap',
    maxColors: Number(options.styleMaxColors ?? options.style_max_colors ?? 16),
  }
}

function sceneEdgeConditioningOptions(options = {}) {
  if (!options.edgeCondition && !options.edge_condition) return undefined
  return {
    enabled: true,
    band: Number(options.edgeBand ?? options.edge_band ?? 3),
    mode: options.edgeConditionMode ?? options.edge_condition_mode ?? 'edge-aware-v1',
  }
}

function sceneTileGatePolicyOptions(options = {}, fallback = 'warn') {
  const rawTileQuality = String(
    options.rawTilePolicy ??
    options.raw_tile_policy ??
    options.rawTileQualityPolicy ??
    options.raw_tile_quality_policy ??
    options.gatePolicy?.raw_tile_quality ??
    options.gatePolicy?.rawTileQuality ??
    options.gate_policy?.raw_tile_quality ??
    options.gate_policy?.rawTileQuality ??
    fallback
  ).trim().toLowerCase()
  return {
    raw_tile_quality: rawTileQuality === 'strict' ? 'strict' : 'warn',
  }
}

function sceneTileCandidateCount(options = {}) {
  const count = Number(options.candidateCount ?? options.candidate_count ?? 1)
  return Number.isInteger(count) && count > 0 ? count : 1
}

function optionalNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function optionalPositiveInt(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function normalizeEditorOperations(value) {
  if (!Array.isArray(value)) return []
  return value.map((operation) => ({
    ...operation,
    x: Number(operation.x),
    y: Number(operation.y),
    ...(operation.w === undefined ? {} : { w: Number(operation.w) }),
    ...(operation.h === undefined ? {} : { h: Number(operation.h) }),
  }))
}

function twoPointFiveDMapOptions(options = {}) {
  return {
    solver: String(options.mapSolver ?? options.map_solver ?? options.solver ?? 'constraint'),
    width: optionalPositiveInt(options.mapWidth ?? options.map_width ?? options.width, 8),
    height: optionalPositiveInt(options.mapHeight ?? options.map_height ?? options.height, 6),
    seed: options.mapSeed ?? options.map_seed ?? options.seed,
    density: optionalNumber(options.mapDensity ?? options.map_density ?? options.density, 0.55),
    border: String(options.mapBorder ?? options.map_border ?? options.border ?? 'empty'),
    fixedMasks: Array.isArray(options.fixedMasks ?? options.fixed_masks) ? (options.fixedMasks ?? options.fixed_masks) : [],
    allowedMasks: Array.isArray(options.allowedMasks ?? options.allowed_masks) ? (options.allowedMasks ?? options.allowed_masks).map(Number) : undefined,
    editorOperations: normalizeEditorOperations(options.editorOperations ?? options.editor_operations),
  }
}

function twoPointFiveDMaterialSourcePromptFromBody(body = {}) {
  return String(
    body.generateSource ??
    body.generate_source ??
    body.materialSourcePrompt ??
    body.material_source_prompt ??
    body.sourcePrompt ??
    body.source_prompt ??
    body.options?.generateSource ??
    body.options?.generate_source ??
    body.options?.materialSourcePrompt ??
    body.options?.material_source_prompt ??
    ''
  ).trim()
}

function twoPointFiveDMaterialSourcePromptFieldsFromBody(body = {}) {
  const options = body.options ?? {}
  return {
    ...(body.materialSourcePromptFields ?? body.material_source_prompt_fields ?? {}),
    ...(options.materialSourcePromptFields ?? options.material_source_prompt_fields ?? {}),
    ...(body.terrain ?? options.terrain ? { terrain: body.terrain ?? options.terrain } : {}),
    ...(body.style ?? options.style ? { style: body.style ?? options.style } : {}),
    ...(body.palette ?? options.palette ? { palette: body.palette ?? options.palette } : {}),
    ...(body.lighting ?? options.lighting ? { lighting: body.lighting ?? options.lighting } : {}),
    ...(body.notes ?? options.notes ? { notes: body.notes ?? options.notes } : {}),
    ...(body.negative ?? options.negative ? { negative: body.negative ?? options.negative } : {}),
  }
}

function twoPointFiveDMaterialSourceImageConfigFromBody(body = {}) {
  const options = body.options ?? {}
  const input = body.imageConfig ?? body.image_config ?? options.imageConfig ?? options.image_config ?? {}
  const imageSize = input.image_size ?? input.imageSize ?? body.imageSize ?? body.image_size ?? options.imageSize ?? options.image_size
  const aspectRatio = input.aspect_ratio ?? input.aspectRatio ?? body.aspectRatio ?? body.aspect_ratio ?? options.aspectRatio ?? options.aspect_ratio
  return {
    ...(imageSize ? { image_size: imageSize } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
  }
}

function twoPointFiveDMaterialSourceGenerationOptionsFromBody(body = {}) {
  const options = { ...(body.generationOptions ?? body.generation_options ?? {}) }
  const sourceSeed = body.sourceSeed ?? body.source_seed ?? body.options?.sourceSeed ?? body.options?.source_seed
  const seed = sourceSeed ?? body.seed ?? body.options?.seed
  const temperature = body.temperature ?? body.options?.temperature
  const topP = body.topP ?? body.top_p ?? body.options?.topP ?? body.options?.top_p
  const topK = body.topK ?? body.top_k ?? body.options?.topK ?? body.options?.top_k
  const qualityTier = body.qualityTier ?? body.quality_tier ?? body.options?.qualityTier
  options.candidateCount = 1
  if (seed !== undefined) options.seed = seed
  if (temperature !== undefined) options.temperature = temperature
  if (topP !== undefined) options.topP = topP
  if (topK !== undefined) options.topK = topK
  if (qualityTier !== undefined) options.qualityTier = qualityTier
  return normalizeGenerationOptions(options)
}

function safeRunId(value, fallback) {
  const id = String(value || fallback || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!id || id.includes('..')) throw new Error('runId must contain a safe file name segment')
  return id
}

function twoPointFiveDMaterialSourceBenchmarkCaseIds(body = {}) {
  const input = body.caseIds ?? body.case_ids ?? body.options?.caseIds ?? body.options?.case_ids
  if (Array.isArray(input)) return input.map(String).filter(Boolean)
  if (typeof input === 'string' && input.trim()) return input.split(',').map((item) => item.trim()).filter(Boolean)
  return []
}

function twoPointFiveDMaterialSourceBenchmarkDescription(body = {}) {
  return String(
    body.description ??
    body.generateSource ??
    body.generate_source ??
    body.materialSourcePrompt ??
    body.material_source_prompt ??
    body.options?.description ??
    body.options?.generateSource ??
    body.options?.generate_source ??
    body.options?.materialSourcePrompt ??
    body.options?.material_source_prompt ??
    ''
  ).trim()
}

function twoPointFiveDMaterialSourceBenchmarkProviderPresetId(body = {}) {
  return String(
    body.providerPresetId ??
    body.provider_preset_id ??
    body.provider_preset ??
    body.options?.providerPresetId ??
    body.options?.provider_preset_id ??
    body.options?.provider_preset ??
    ''
  ).trim()
}

function twoPointFiveDMaterialSourceBenchmarkCandidateCount(body = {}) {
  return body.candidateCount ?? body.candidate_count ?? body.options?.candidateCount ?? body.options?.candidate_count ?? 3
}

function twoPointFiveDMaterialSourceBenchmarkPlanFromBody(body = {}, { runId }) {
  return buildTwoPointFiveDMaterialSourceBenchmarkPlan({
    runId,
    outputDir: path.join(generatedDir, 'two-point-five-d-material-source-benchmarks'),
    description: twoPointFiveDMaterialSourceBenchmarkDescription(body),
    caseIds: twoPointFiveDMaterialSourceBenchmarkCaseIds(body),
    sampleSize: body.sampleSize ?? body.sample_size ?? body.options?.sampleSize ?? body.options?.sample_size,
    providerPresetId: twoPointFiveDMaterialSourceBenchmarkProviderPresetId(body),
    candidateCount: twoPointFiveDMaterialSourceBenchmarkCandidateCount(body),
    imageConfig: twoPointFiveDMaterialSourceImageConfigFromBody(body),
    generationOptions: twoPointFiveDMaterialSourceGenerationOptionsFromBody(body),
    contract: body.contract ?? body.options?.contract,
    materialSampleLayout: body.material_sample_layout ?? body.materialSampleLayout ?? body.options?.materialSampleLayout,
    mapOptions: twoPointFiveDMapOptions(body.options ?? body),
  })
}

function hasProviderCallBudgetLimit(body = {}) {
  return body.maxProviderCalls !== undefined ||
    body.max_provider_calls !== undefined ||
    body.providerBudget?.max !== undefined ||
    body.provider_budget?.max !== undefined ||
    body.options?.maxProviderCalls !== undefined ||
    body.options?.max_provider_calls !== undefined
}

function benchmarkArtifactUrls(outputDir) {
  return {
    material_source_benchmark_plan_url: generatedUrlForFile(path.join(outputDir, 'material_source_benchmark_plan.json')),
    material_source_benchmark_url: generatedUrlForFile(path.join(outputDir, 'material_source_benchmark.json')),
    material_source_benchmark_md_url: generatedUrlForFile(path.join(outputDir, 'material_source_benchmark.md')),
  }
}

function benchmarkPlanArtifactUrl(outputDir) {
  return generatedUrlForFile(path.join(outputDir, 'material_source_benchmark_plan.json'))
}

function base64Buffer(value) {
  if (!value) return null
  const text = String(value)
  const separator = text.indexOf(',')
  if (separator >= 0 && !/^data:[^,]*;base64$/i.test(text.slice(0, separator))) {
    throw motionRequestError('invalid_base64', 'Motion source data URL must use base64 encoding.')
  }
  const payload = (separator >= 0 ? text.slice(separator + 1) : text).trim()
  if (
    payload.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
  ) {
    throw motionRequestError('invalid_base64', 'Motion source payload is not valid base64.')
  }
  return Buffer.from(payload, 'base64')
}

function motionSourceKindFromExtractor(kind) {
  if (kind === 'zip') return 'frame_sequence_zip'
  if (kind === 'gif') return 'gif'
  if (kind === 'image') return 'single_image'
  if (kind === 'video') return 'video_file'
  throw new Error(`unsupported motion source kind: ${kind}`)
}

function motionSourceNameFromBody(body = {}, fallback = 'motion_source') {
  return String(body.sourceName ?? body.source_name ?? body.name ?? body.options?.sourceName ?? body.options?.source_name ?? fallback)
}

function motionSourceBufferFromBody(body = {}) {
  return base64Buffer(body.source_base64 ?? body.sourceBase64 ?? body.source)
}

function motionSourceBuildOptions(body = {}) {
  return body.options ?? {}
}

function motionSourceSelectionFields(body = {}, options = {}) {
  return {
    selectionMode: body.selection_mode ?? body.selectionMode ?? options.selection_mode ?? options.selectionMode,
    selectedFrameIndexes: body.selected_frame_indexes ?? body.selectedFrameIndexes ?? options.selected_frame_indexes ?? options.selectedFrameIndexes,
  }
}

function aliasedMotionSelectionValue(options, keys, label) {
  const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(options, key))
  if (!present.length) return undefined
  const first = options[present[0]]
  for (const key of present.slice(1)) {
    if (JSON.stringify(options[key]) !== JSON.stringify(first)) {
      throw motionRequestError(
        'conflicting_motion_selection_option',
        `Conflicting Motion Selection aliases for ${label}`
      )
    }
  }
  return first
}

function rejectUnknownMotionSelectionFields(options) {
  const known = new Set([
    'motion_selection',
    'motionSelection',
    'motion_selection_recipe',
    'motionSelectionRecipe',
    'selection_recipe',
    'selectionRecipe',
    'loop_expectation',
    'loopExpectation',
    'temporal_matte',
    'temporalMatte',
  ])
  const protectedPrefixes = [
    'motion_selection',
    'motionSelection',
    'selection_recipe',
    'selectionRecipe',
    'loop_expectation',
    'loopExpectation',
    'temporal_matte',
    'temporalMatte',
  ]
  const unknown = Object.keys(options).find((key) => (
    !known.has(key) &&
    protectedPrefixes.some((prefix) => key.startsWith(prefix))
  ))
  if (unknown) {
    throw motionRequestError(
      'unknown_motion_selection_option',
      `Unknown Motion Selection option: ${unknown}`,
      { details: { option: unknown } }
    )
  }
}

function motionSelectionRecipeFields(options = {}) {
  rejectUnknownMotionSelectionFields(options)
  const nested = aliasedMotionSelectionValue(
    options,
    ['motion_selection', 'motionSelection'],
    'motion_selection'
  )
  const flatRecipe = aliasedMotionSelectionValue(
    options,
    [
      'motion_selection_recipe',
      'motionSelectionRecipe',
      'selection_recipe',
      'selectionRecipe',
    ],
    'recipe'
  )
  const flatLoopExpectation = aliasedMotionSelectionValue(
    options,
    ['loop_expectation', 'loopExpectation'],
    'loop_expectation'
  )
  const flatTemporalMatte = aliasedMotionSelectionValue(
    options,
    ['temporal_matte', 'temporalMatte'],
    'temporal_matte'
  )
  const hasFlat =
    flatRecipe !== undefined ||
    flatLoopExpectation !== undefined ||
    flatTemporalMatte !== undefined
  if (nested !== undefined && hasFlat) {
    throw motionRequestError(
      'conflicting_motion_selection_option',
      'nested and flat Motion Selection options cannot be combined'
    )
  }
  if (nested !== undefined) return normalizeMotionSelectionOptions(nested)
  if (!hasFlat) return normalizeMotionSelectionOptions(false)
  return normalizeMotionSelectionOptions({
    recipe: flatRecipe,
    ...(flatLoopExpectation !== undefined
      ? { loop_expectation: flatLoopExpectation }
      : {}),
    ...(flatTemporalMatte !== undefined
      ? { temporal_matte: flatTemporalMatte }
      : {}),
  })
}

function motionSourceOperationOptions(body = {}, operationType) {
  const topLevelOptions = { ...body }
  for (const key of [
    'source_base64', 'sourceBase64', 'source',
    'source_name', 'sourceName', 'name',
    'source_upload_id', 'sourceUploadId',
    'source_identity', 'sourceIdentity',
    'operation_id', 'operationId',
    'options',
  ]) {
    delete topLevelOptions[key]
  }
  const options = { ...topLevelOptions, ...motionSourceBuildOptions(body) }
  if (operationType === 'build') {
    const selection = motionSourceSelectionFields(body, options)
    if (selection.selectionMode !== undefined) options.selection_mode = selection.selectionMode
    if (selection.selectedFrameIndexes !== undefined) options.selected_frame_indexes = selection.selectedFrameIndexes
    delete options.selectionMode
    delete options.selectedFrameIndexes
    const motionSelection = motionSelectionRecipeFields(options)
    for (const key of [
      'motion_selection',
      'motionSelection',
      'motion_selection_recipe',
      'motionSelectionRecipe',
      'selection_recipe',
      'selectionRecipe',
      'loop_expectation',
      'loopExpectation',
      'temporal_matte',
      'temporalMatte',
    ]) {
      delete options[key]
    }
    if (motionSelection.recipe !== MOTION_SELECTION_RECIPE_IDS.V1_COMPAT) {
      options.motion_selection = motionSelection
    }
    const pixelGridRefinement = Object.prototype.hasOwnProperty.call(
      options,
      'pixel_grid_refinement'
    )
      ? options.pixel_grid_refinement
      : options.pixelGridRefinement
    if (pixelGridRefinement !== undefined) {
      const normalizedPixelGridRefinement =
        normalizePixelGridRefinementOptions(pixelGridRefinement)
      if (normalizedPixelGridRefinement) {
        options.pixel_grid_refinement = normalizedPixelGridRefinement
      } else {
        delete options.pixel_grid_refinement
      }
      delete options.pixelGridRefinement
    }
  }
  return options
}

function motionSourceOperationId(body = {}, operationType, { legacy = false } = {}) {
  const value = body.operation_id ?? body.operationId
  if (!value && !legacy) {
    throw motionRequestError('invalid_operation_id', 'operation_id is required for uploaded Motion sources')
  }
  const operationId = value
    ? String(value).trim()
    : `legacy_motion_${operationType}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  if (
    !operationId ||
    operationId.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(operationId)
  ) {
    throw motionRequestError(
      'invalid_operation_id',
      'operation_id must be a safe identifier no longer than 160 characters'
    )
  }
  return operationId
}

function motionContentTypeForName(sourceName) {
  const ext = path.extname(String(sourceName).toLowerCase())
  if (ext === '.gif') return 'image/gif'
  if (ext === '.zip') return 'application/zip'
  if (ext === '.png') return 'image/png'
  if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mkv') return 'video/x-matroska'
  if (ext === '.avi') return 'video/x-msvideo'
  return 'video/mp4'
}

function legacyUploadOperationId(operationId) {
  const digest = createHash('sha256').update(String(operationId)).digest('hex')
  return `legacy_upload_${digest}`
}

async function resolveMotionSourceRequest(body = {}, {
  uploadOperationId = null,
  allowReleasedReplay = false,
} = {}) {
  const uploadId = body.source_upload_id ?? body.sourceUploadId
  if (uploadId) {
    const expectedIdentity = body.source_identity ?? body.sourceIdentity
    if (!expectedIdentity) {
      throw motionRequestError('invalid_source_identity', 'source_identity is required with source_upload_id')
    }
    return {
      descriptor: motionSourceUploadStore.resolve(uploadId, { expectedIdentity }),
      legacy: false,
    }
  }

  const sourceBuffer = motionSourceBufferFromBody(body)
  if (!sourceBuffer?.length) {
    throw motionRequestError(
      'motion_source_upload_required',
      'Upload a Motion source or provide a legacy source_base64 payload below 16 MiB.',
      { retryHint: 'use_motion_source_upload' }
    )
  }
  const sourceName = motionSourceNameFromBody(body)
  const descriptor = await motionSourceUploadStore.upload({
    stream: Readable.from(sourceBuffer),
    sourceName,
    contentType: motionContentTypeForName(sourceName),
    contentLength: sourceBuffer.length,
    operationId: uploadOperationId ?? `legacy_upload_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    allowReleasedReplay,
  })
  const liveDescriptor = motionSourceUploadStore.descriptor(descriptor.upload_id)
  return {
    descriptor: liveDescriptor
      ? motionSourceUploadStore.resolve(descriptor.upload_id, {
          expectedIdentity: descriptor.source_identity,
        })
      : descriptor,
    legacy: true,
    released: !liveDescriptor,
  }
}

function motionSourceTimingOptions(options = {}) {
  return {
    stride: optionalPositiveInt(options.stride, 1),
    maxFrames: optionalPositiveInt(options.max_frames ?? options.maxFrames, 64),
    fps: optionalNumber(options.fps, 12),
    startSec: optionalNumber(options.start_sec ?? options.startSec, 0),
    endSec: options.end_sec ?? options.endSec,
  }
}

function motionExtractorKind(mediaKind) {
  if (mediaKind === 'frame_sequence_zip') return 'zip'
  if (mediaKind === 'gif') return 'gif'
  if (mediaKind === 'single_image') return 'image'
  if (mediaKind === 'video') return 'video'
  throw motionRequestError('unsupported_motion_source_type', `Unsupported Motion source kind: ${mediaKind}`, {
    httpStatus: 415,
  })
}

async function motionVideoExtractionOptions({ jobId, source }) {
  if (source.media_kind !== 'video') return {}
  const jobDir = safeGeneratedJobDir(jobId)
  await mkdir(jobDir, { recursive: true })
  return {
    kind: 'video',
    inputPath: source.source_path,
    videoOutputDir: path.join(jobDir, 'video_frames'),
  }
}

function motionBackgroundMethod(options = {}) {
  const background = options.background ?? {}
  return String(background.method ?? background.background_method ?? options.background_method ?? options.backgroundMethod ?? 'key_color')
}

function motionBackgroundOptions(options = {}) {
  const background = options.background ?? {}
  const method = motionBackgroundMethod(options)
  return {
    key_color: background.key_color ?? background.keyColor ?? options.background_key ?? options.backgroundKey ?? options.key_color ?? options.keyColor ?? [255, 255, 255],
    tolerance: optionalNumber(background.tolerance ?? options.background_tolerance ?? options.backgroundTolerance, 24),
    defringe: background.defringe ?? options.defringe ?? (options.disable_defringe || options.disableDefringe ? false : true),
    source_requirement: method === 'external_rembg'
      ? 'transparent_alpha'
      : background.source_requirement ?? background.sourceRequirement ?? options.background_source_requirement,
  }
}

async function maybeApplyExternalMotionMatting({ jobId, frames, options = {}, signal }) {
  if (motionBackgroundMethod(options) !== 'external_rembg') return { frames, report: null }
  return applyExternalMattingToFrames(frames, {
    outputDir: path.join(safeGeneratedJobDir(jobId), 'external_matting'),
    rembgPath: resolveRembgPath(process.env),
    signal,
  })
}

async function probeCommand(binary, args) {
  try {
    const result = await runGuardedTool(binary, args, {
      tool: 'motion_tool_probe',
      maxRssMiB: 1536,
      timeoutMs: 2500,
      pollIntervalMs: 1000,
      maxOutputBytes: 4096,
    })
    const output = `${result.stdout_tail ?? ''}${result.stderr_tail ?? ''}`.split(/\r?\n/).find(Boolean) ?? ''
    return { path: binary, available: true, checked: true, summary: output.slice(0, 160) }
  } catch (error) {
    return { path: binary, available: false, checked: true, reason: String(error?.message || error) }
  }
}

async function motionSourceToolStatus() {
  const ffmpegPath = resolveFfmpegPath(process.env)
  const rembgPath = resolveRembgPath(process.env)
  return {
    ffmpeg: {
      kind: 'ffmpeg',
      ...(await probeCommand(ffmpegPath, ['-version'])),
    },
    rembg: {
      kind: 'rembg',
      ...(await probeCommand(rembgPath, ['--version'])),
    },
  }
}

function motionAnchorOptions(options = {}) {
  const anchor = options.anchor_policy ?? options.anchorPolicy ?? {}
  return {
    padding_px: optionalPositiveInt(anchor.padding_px ?? anchor.paddingPx ?? options.padding_px ?? options.padding, 6),
    static_offset_y: optionalNumber(anchor.static_offset_y ?? anchor.staticOffsetY ?? options.static_offset_y ?? options.staticOffsetY, 0),
  }
}

function motionFrameSizeOptions(options = {}) {
  const frameSize = options.frame_size ?? options.frameSize ?? {}
  return {
    normalized_cell: [
      optionalPositiveInt(frameSize.normalized_cell?.[0] ?? frameSize.normalizedCell?.[0] ?? options.cell_width ?? options.cellWidth, 96),
      optionalPositiveInt(frameSize.normalized_cell?.[1] ?? frameSize.normalizedCell?.[1] ?? options.cell_height ?? options.cellHeight, 96),
    ],
  }
}

function motionResampleStrategyFromBody(body = {}) {
  const options = body.options ?? {}
  return String(
    body.resample_strategy ??
    body.resampleStrategy ??
    options.output_profile?.resample_strategy ??
    options.outputProfile?.resampleStrategy ??
    options.resample_strategy ??
    options.resampleStrategy ??
    'reject_mismatch'
  )
}

function motionBindingEvidence(binding) {
  return {
    source_upload_id: binding.source_upload_id,
    source_identity: binding.source_identity,
    operation_id: binding.operation_id,
    options_hash: binding.options_hash,
    session_scope: binding.session_scope,
  }
}

function motionJobBindingPatch(binding, lifecycle = binding.motion_source_lifecycle) {
  return {
    ...motionBindingEvidence(binding),
    operation_type: binding.operation_type,
    motion_source_lifecycle: lifecycle,
  }
}

function updateMotionBoundJob(binding, patch = {}) {
  const currentBinding = motionSourceLifecycle.getJobBinding(binding.job_id)
  const targetLifecycle = patch.motion_source_lifecycle ?? currentBinding?.motion_source_lifecycle
  motionSourceLifecycle.assertProjection(binding.job_id, targetLifecycle)
  const job = updateJob(binding.job_id, {
    ...motionJobBindingPatch(binding, targetLifecycle),
    ...patch,
  })
  motionSourceLifecycle.updateJobSnapshot(binding.job_id, job)
  return job
}

function completeMotionBoundJob(binding, patch = {}) {
  motionSourceLifecycle.throwIfCancelled(binding.job_id)
  const job = updateMotionBoundJob(binding, {
    ...patch,
    motion_source_lifecycle: 'completed',
  })
  motionSourceLifecycle.markTerminal(binding.job_id, { lifecycle: 'completed', job })
  return job
}

function finishMotionBoundJobFailure(binding, patch = {}) {
  motionSourceLifecycle.throwIfCancelled(binding.job_id)
  const job = updateMotionBoundJob(binding, {
    ...patch,
    status: JOB_STATUS.FAILED_POST_PROCESSING,
    motion_source_lifecycle: 'failed',
  })
  motionSourceLifecycle.markTerminal(binding.job_id, { lifecycle: 'failed', job })
  return job
}

function failMotionBoundJob(binding, error, retryHint) {
  let cancelled = binding.signal.aborted ||
    error?.code === 'cancelled' ||
    error?.code === 'external_tool_cancelled'
  if (!cancelled) {
    try {
      motionSourceLifecycle.throwIfCancelled(binding.job_id)
    } catch (cancelError) {
      if (cancelError?.code !== 'cancelled') throw cancelError
      cancelled = true
    }
  }
  const patch = cancelled
    ? motionSourceCancellationPatch()
    : {
        status: JOB_STATUS.FAILED_POST_PROCESSING,
        failure_status: error?.failure_status ?? error?.code ?? JOB_STATUS.FAILED_POST_PROCESSING,
        motion_source_lifecycle: 'failed',
        reason: String(error?.reason ?? error?.message ?? error),
        retry_hint: error?.retry_hint ?? retryHint,
        ...(error?.budget ? {
          decode_budget: {
            budget: error.budget,
            actual: error.actual,
            limit: error.limit,
          },
        } : {}),
      }
  const job = updateMotionBoundJob(binding, patch)
  if (!cancelled) motionSourceLifecycle.markTerminal(binding.job_id, { lifecycle: 'failed', job })
  return job
}

async function writeMotionSourceFiles(jobId, files, binding = null) {
  const jobDir = safeGeneratedJobDir(jobId)
  await mkdir(jobDir, { recursive: true })
  const urls = {}
  for (const [name, value] of Object.entries(files)) {
    const filePath = path.join(jobDir, name)
    await mkdir(path.dirname(filePath), { recursive: true })
    const artifact = !binding || Buffer.isBuffer(value)
      ? value
      : { ...value, ...motionBindingEvidence(binding) }
    const body = Buffer.isBuffer(artifact) ? artifact : JSON.stringify(artifact, null, 2)
    await writeFile(filePath, body)
    const key = name.replace(/\.(png|json)$/i, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    urls[`${key}_url`] = generatedUrlForFile(filePath)
  }
  return urls
}

function promptFieldsFromBody(body = {}) {
  return normalizePromptFields({
    ...(body.promptFields ?? body.prompt_fields ?? {}),
    identity: body.identity ?? body.options?.identity,
    body: body.body ?? body.options?.body,
    outfit: body.outfit ?? body.clothing ?? body.options?.outfit ?? body.options?.clothing,
    colors: body.colors ?? body.palette ?? body.options?.colors ?? body.options?.palette,
    equipment: body.equipment ?? body.weapon ?? body.options?.equipment ?? body.options?.weapon,
    style: body.style ?? body.options?.style,
    background: body.promptBackground ?? body.prompt_background ?? body.options?.promptBackground,
    outputType: body.outputType ?? body.output_type ?? body.options?.outputType,
  })
}

function generationOptionsFromBody(body = {}) {
  const options = { ...(body.generationOptions ?? body.generation_options ?? {}) }
  const candidateCount = body.candidateCount ?? body.candidate_count ?? body.options?.candidateCount ?? body.options?.candidate_count
  const seed = body.seed ?? body.options?.seed
  const temperature = body.temperature ?? body.options?.temperature
  const topP = body.topP ?? body.top_p ?? body.options?.topP ?? body.options?.top_p
  const topK = body.topK ?? body.top_k ?? body.options?.topK ?? body.options?.top_k
  const qualityTier = body.qualityTier ?? body.quality_tier ?? body.options?.qualityTier
  if (candidateCount !== undefined) options.candidateCount = candidateCount
  if (seed !== undefined) options.seed = seed
  if (temperature !== undefined) options.temperature = temperature
  if (topP !== undefined) options.topP = topP
  if (topK !== undefined) options.topK = topK
  if (qualityTier !== undefined) options.qualityTier = qualityTier
  return normalizeGenerationOptions(options)
}

function positiveIntFromValue(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function providerCallBudgetFromBody(body = {}, { plannedProviderCalls }) {
  const planned = positiveIntFromValue(plannedProviderCalls, 'planned provider calls')
  const rawMax =
    body.maxProviderCalls ??
    body.max_provider_calls ??
    body.providerBudget?.max ??
    body.provider_budget?.max ??
    body.options?.maxProviderCalls ??
    body.options?.max_provider_calls
  const max = rawMax === undefined ? planned : positiveIntFromValue(rawMax, 'maxProviderCalls')
  if (planned > max) {
    throw Object.assign(new Error(`planned provider calls ${planned} exceed maxProviderCalls ${max}`), {
      status: JOB_STATUS.FAILED_MODEL_ERROR,
      failure_status: 'failed_budget_exhausted',
      retry_hint: 'increase_max_provider_calls',
      provider_call_budget: {
        planned_provider_calls: planned,
        max_provider_calls: max,
        used_provider_calls: 0,
      },
    })
  }
  return {
    planned_provider_calls: planned,
    max_provider_calls: max,
    providerBudget: { max, used: 0 },
  }
}

function publicProviderCallBudget(budget) {
  if (!budget) return null
  return {
    planned_provider_calls: budget.planned_provider_calls,
    max_provider_calls: budget.max_provider_calls,
    used_provider_calls: budget.providerBudget?.used ?? 0,
  }
}

function imageConfigFromBody(body = {}, { mode, characterPreset } = {}) {
  const input = body.imageConfig ?? body.image_config ?? {}
  const imageSize = input.image_size ?? input.imageSize ?? body.imageSize ?? body.image_size ?? '2K'
  const aspectInput = input.aspect_ratio ?? input.aspectRatio ?? body.aspectRatio ?? body.aspect_ratio
  return {
    image_size: imageSize,
    aspect_ratio: resolveTextToImageAspectRatio({
      mode,
      characterPreset,
      imageConfig: { aspect_ratio: aspectInput },
    }),
  }
}

function generationProfileIdFromBody(body = {}) {
  return String(body.generationProfileId ?? body.generation_profile_id ?? '').trim()
}

function backgroundModeFromGenerationBody(body = {}) {
  return body.options?.backgroundMode ?? body.backgroundMode ?? body.background_mode
}

function providerPresetIdFromGenerationBody(body = {}) {
  return String(body.providerPresetId ?? body.provider_preset_id ?? body.provider_preset ?? '').trim()
}

function maxProviderCallsFromBody(body = {}) {
  return body.maxProviderCalls ?? body.max_provider_calls ?? body.providerBudget?.max ??
    body.provider_budget?.max ?? body.options?.maxProviderCalls ?? body.options?.max_provider_calls
}

function hasGenerationOptionOverrides(body = {}) {
  const options = body.options ?? {}
  return Boolean(
    body.generationOptions || body.generation_options ||
    body.candidateCount !== undefined || body.candidate_count !== undefined ||
    body.seed !== undefined || body.temperature !== undefined || body.topP !== undefined ||
    body.top_p !== undefined || body.topK !== undefined || body.top_k !== undefined ||
    body.qualityTier !== undefined || body.quality_tier !== undefined ||
    options.candidateCount !== undefined || options.candidate_count !== undefined ||
    options.seed !== undefined || options.temperature !== undefined ||
    options.topP !== undefined || options.top_p !== undefined ||
    options.topK !== undefined || options.top_k !== undefined ||
    options.qualityTier !== undefined
  )
}

function generationImageConfigOverridesFromBody(body = {}) {
  const input = body.imageConfig ?? body.image_config ?? {}
  return {
    ...input,
    ...(body.imageSize !== undefined || body.image_size !== undefined
      ? { image_size: body.imageSize ?? body.image_size }
      : {}),
    ...(body.aspectRatio !== undefined || body.aspect_ratio !== undefined
      ? { aspect_ratio: body.aspectRatio ?? body.aspect_ratio }
      : {}),
  }
}

function hasPromptFieldOverrides(body = {}) {
  const options = body.options ?? {}
  return Boolean(
    body.promptFields !== undefined || body.prompt_fields !== undefined ||
    body.identity !== undefined || body.body !== undefined || body.outfit !== undefined ||
    body.clothing !== undefined || body.colors !== undefined || body.palette !== undefined ||
    body.equipment !== undefined || body.weapon !== undefined || body.style !== undefined ||
    body.promptBackground !== undefined || body.prompt_background !== undefined ||
    body.outputType !== undefined || body.output_type !== undefined ||
    options.identity !== undefined || options.body !== undefined || options.outfit !== undefined ||
    options.clothing !== undefined || options.colors !== undefined || options.palette !== undefined ||
    options.equipment !== undefined || options.weapon !== undefined || options.style !== undefined ||
    options.promptBackground !== undefined || options.outputType !== undefined
  )
}

function assertGenerationReviewBinding(body = {}) {
  const reviewId = String(body.reviewedRunId ?? body.reviewed_run_id ?? '').trim()
  const expectedPlanHash = String(body.expectedPlanHash ?? body.expected_plan_hash ?? '').trim()
  const expectedReferenceManifestSha256 = String(
    body.expectedReferenceManifestSha256 ?? body.expected_reference_manifest_sha256 ?? '',
  ).trim()
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(reviewId) || reviewId.includes('..')) {
    throw new Error('reviewedRunId is required for full-sheet live generation')
  }
  if (!/^[a-f0-9]{64}$/.test(expectedPlanHash)) {
    throw new Error('expectedPlanHash is required for full-sheet live generation')
  }
  if (!/^[a-f0-9]{64}$/.test(expectedReferenceManifestSha256)) {
    throw new Error('expectedReferenceManifestSha256 is required for full-sheet live generation')
  }
  if (body.confirmLiveGeneration !== true && body.confirm_live_generation !== true) {
    throw new Error('confirmLiveGeneration: true is required for full-sheet live generation')
  }
  if (Number(maxProviderCallsFromBody(body)) !== 1) {
    throw new Error('maxProviderCalls: 1 is required for full-sheet live generation')
  }
  return { reviewId, expectedPlanHash, expectedReferenceManifestSha256 }
}

function generationReviewArtifactUrls(reviewDir, references) {
  return {
    generation_review_url: generatedUrlForFile(path.join(reviewDir, GENERATION_REVIEW_FILE)),
    generation_request_manifest_url: generatedUrlForFile(path.join(reviewDir, GENERATION_REQUEST_MANIFEST_FILE)),
    generation_reference_manifest_url: generatedUrlForFile(path.join(reviewDir, GENERATION_REFERENCE_MANIFEST_FILE)),
    generation_prompt_url: generatedUrlForFile(path.join(reviewDir, GENERATION_PROMPT_FILE)),
    reference_urls: references.map((image) => ({
      name: image.name,
      role: image.role,
      url: generatedUrlForFile(path.join(reviewDir, image.name)),
    })),
  }
}

async function writeFullSheetGenerationReviewArtifacts(reviewDir, built) {
  await mkdir(generatedDir, { recursive: true })
  await mkdir(reviewDir)
  await writeFile(path.join(reviewDir, GENERATION_REVIEW_FILE), JSON.stringify(built.review, null, 2), { flag: 'wx' })
  await writeFile(path.join(reviewDir, GENERATION_REQUEST_MANIFEST_FILE), JSON.stringify(built.requestManifest, null, 2), { flag: 'wx' })
  await writeFile(path.join(reviewDir, GENERATION_REFERENCE_MANIFEST_FILE), JSON.stringify(built.referenceManifest, null, 2), { flag: 'wx' })
  await writeFile(path.join(reviewDir, GENERATION_PROMPT_FILE), built.promptText, { flag: 'wx' })
  for (const image of built.references) {
    await writeFile(path.join(reviewDir, image.name), image.buffer, { flag: 'wx' })
  }
}

async function buildFullSheetGenerationReviewFromBody(body = {}, { reviewId } = {}) {
  const profile = resolveFullSheetGenerationProfile(generationProfileIdFromBody(body), { required: true })
  const generationOptions = generationOptionsFromBody(body)
  const backgroundMode = backgroundModeFromGenerationBody(body)
  const characterPreset = body.characterPreset ?? body.character_preset ?? body.options?.characterPreset
  const modeInput = body.t2iMode ?? body.t2i_mode ?? body.mode
  assertFullSheetGenerationProfileRequest(profile, {
    preset: body.preset,
    mode: modeInput,
    imageConfig: generationImageConfigOverridesFromBody(body),
    generationOptions,
    maxProviderCalls: maxProviderCallsFromBody(body),
    backgroundMode,
  })
  const providerPreset = resolveProviderPreset(currentProviderEnv(), providerPresetIdFromGenerationBody(body))
  const templateImage = await loadAuthoritativeGenerationStructureImage(profile.source_layout, { rootDir: __dirname })
  if (!templateImage) {
    throw new Error(
      `authoritative generation Structure is unavailable for ${profile.id}; placeholder or cross-layout substitution is forbidden`,
    )
  }
  const identityInput = uploadedImageFromBody(body, 'reference', 'identity.png')
  const paletteInput = uploadedImageFromBody(body, 'palette', 'palette.png')
  const references = [
    await buildStructureReferenceBoard(templateImage, { sourceLayoutId: profile.source_layout }),
  ]
  const identity = await buildIdentityReferenceBoard(identityInput)
  if (identity) references.push(identity)
  const palette = await buildPaletteReferenceBoard(paletteInput)
  if (palette) references.push(palette)
  return buildFullSheetGenerationReview({
    reviewId,
    profile,
    providerPreset,
    description: body.description ?? '',
    promptFields: promptFieldsFromBody(body),
    characterPreset,
    backgroundMode,
    generationOptions,
    references,
  })
}

async function handleGenerateCharacterReview(req, res) {
  loadLocalEnv()
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'))
    const reviewId = safeRunId(
      body.runId ?? body.run_id,
      `generation_review_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    )
    const built = await buildFullSheetGenerationReviewFromBody(body, { reviewId })
    const reviewDir = safeGeneratedJobDir(reviewId)
    await writeFullSheetGenerationReviewArtifacts(reviewDir, built)
    return sendJson(res, 200, {
      mode: 'provider_free_generation_review',
      status: 'done',
      generation_profile_id: built.requestManifest.generation_profile.id,
      review_id: reviewId,
      reviewed_run_id: reviewId,
      plan_hash: built.requestManifest.plan_hash,
      reference_manifest_sha256: built.requestManifest.reference_manifest_sha256,
      provider: built.requestManifest.provider,
      model: built.requestManifest.provider.model,
      image_config: built.requestManifest.image_config,
      candidate_count: 1,
      estimated_provider_calls: 1,
      provider_calls_used: 0,
      max_provider_calls: 1,
      references: built.referenceManifest.items,
      ...generationReviewArtifactUrls(reviewDir, built.references),
    })
  } catch (error) {
    return sendJson(res, 400, {
      error: 'generation_review_failed',
      reason: String(error.message || error),
      estimated_provider_calls: 0,
      provider_calls_used: 0,
    })
  }
}

function assertOptionalReviewedOriginal(body, prefix, referenceItem) {
  const image = uploadedImageFromBody(body, prefix, `${prefix}.png`)
  if (!image) return
  if (!referenceItem?.original_input || sha256GenerationBytes(image.buffer) !== referenceItem.original_input.sha256) {
    throw new Error(`${prefix} image changed after generation Review`)
  }
}

async function verifyFullSheetGenerationReview(body = {}, { providerEnv = currentProviderEnv() } = {}) {
  const binding = assertGenerationReviewBinding(body)
  const profileId = generationProfileIdFromBody(body)
  const currentProfile = resolveFullSheetGenerationProfile(profileId, { required: true })
  const reviewDir = safeGeneratedJobDir(binding.reviewId)
  const [reviewValue, requestValue, referenceValue] = await Promise.all([
    readFile(path.join(reviewDir, GENERATION_REVIEW_FILE), 'utf8'),
    readFile(path.join(reviewDir, GENERATION_REQUEST_MANIFEST_FILE), 'utf8'),
    readFile(path.join(reviewDir, GENERATION_REFERENCE_MANIFEST_FILE), 'utf8'),
  ])
  const review = assertFullSheetGenerationReview(JSON.parse(reviewValue))
  const requestManifest = assertFullSheetGenerationRequestManifest(JSON.parse(requestValue))
  const referenceManifest = assertFullSheetGenerationReferenceManifest(
    JSON.parse(referenceValue),
    requestManifest.reference_manifest_sha256,
    currentProfile,
  )
  if (hashGenerationReviewValue(requestManifest.reference_order) !== hashGenerationReviewValue(
    referenceManifest.items.map((item) => ({ name: item.name, role: item.role })),
  )) {
    throw new Error('generation reference order changed after Review')
  }
  if (review.review_id !== binding.reviewId || requestManifest.review_id !== binding.reviewId ||
      review.plan_hash !== binding.expectedPlanHash || requestManifest.plan_hash !== binding.expectedPlanHash ||
      review.reference_manifest_sha256 !== binding.expectedReferenceManifestSha256 ||
      requestManifest.reference_manifest_sha256 !== binding.expectedReferenceManifestSha256) {
    throw new Error('generation Review binding is stale')
  }
  if (profileId !== review.generation_profile_id || profileId !== requestManifest.generation_profile.id) {
    throw new Error('generation Profile changed after Review')
  }
  if (hashGenerationReviewValue(currentProfile) !== hashGenerationReviewValue(requestManifest.generation_profile)) {
    throw new Error('generation Profile definition changed after Review')
  }
  const authoritativeStructure = await loadAuthoritativeGenerationStructureImage(currentProfile.source_layout, {
    rootDir: __dirname,
  })
  const reviewedStructure = referenceManifest.items.find((item) => item.role === 'structure')
  if (!authoritativeStructure || reviewedStructure?.sha256 !== authoritativeStructure.expectedStructureSha256) {
    throw new Error('reviewed generation Structure is not the current authoritative exact-outline reference')
  }
  assertFullSheetGenerationProfileRequest(currentProfile, {
    preset: body.preset,
    mode: body.t2iMode ?? body.t2i_mode ?? body.mode,
    imageConfig: generationImageConfigOverridesFromBody(body),
    generationOptions: generationOptionsFromBody(body),
    maxProviderCalls: maxProviderCallsFromBody(body),
    backgroundMode: backgroundModeFromGenerationBody(body),
  })
  const requestedPresetId = providerPresetIdFromGenerationBody(body)
  if (requestedPresetId && requestedPresetId !== requestManifest.provider.preset_id) {
    throw new Error('provider Preset changed after Review')
  }
  const providerPreset = resolveProviderPreset(providerEnv, requestManifest.provider.preset_id)
  const currentProvider = {
    preset_id: providerPreset.id,
    provider: providerPreset.provider,
    route_kind: providerPreset.routeKind,
    model: providerPreset.model,
    image_config: { ...providerPreset.imageConfig },
    supports_system_instruction: providerPreset.supportsSystemInstruction === true,
    supports_role_interleaving: providerPreset.supportsRoleInterleaving === true,
    supports_image_size: providerPreset.supportsImageSize === true,
    provider_endpoint_sha256: sha256GenerationBytes(Buffer.from(buildGeminiGenerateContentUrl(providerPreset), 'utf8')),
  }
  if (hashGenerationReviewValue(currentProvider) !== hashGenerationReviewValue(requestManifest.provider)) {
    throw new Error('provider Preset or model changed after Review')
  }
  if (hasGenerationOptionOverrides(body) &&
      hashGenerationReviewValue(generationOptionsFromBody(body)) !== hashGenerationReviewValue(requestManifest.generation_options)) {
    throw new Error('generation options changed after Review')
  }
  if (body.description !== undefined && String(body.description) !== requestManifest.request_input.description) {
    throw new Error('description changed after Review')
  }
  if (hasPromptFieldOverrides(body) &&
      hashGenerationReviewValue(promptFieldsFromBody(body)) !== hashGenerationReviewValue(requestManifest.request_input.prompt_fields)) {
    throw new Error('prompt fields changed after Review')
  }
  const suppliedCharacterPreset = body.characterPreset ?? body.character_preset ?? body.options?.characterPreset
  if (suppliedCharacterPreset !== undefined && suppliedCharacterPreset !== requestManifest.request_input.character_preset) {
    throw new Error('character Preset changed after Review')
  }
  const suppliedBackgroundMode = body.options?.backgroundMode ?? body.backgroundMode ?? body.background_mode
  if (suppliedBackgroundMode !== undefined && suppliedBackgroundMode !== requestManifest.request_input.background_mode) {
    throw new Error('background mode changed after Review')
  }
  assertOptionalReviewedOriginal(body, 'reference', referenceManifest.items.find((item) => item.role === 'identity'))
  assertOptionalReviewedOriginal(body, 'palette', referenceManifest.items.find((item) => item.role === 'palette'))
  const references = []
  for (const item of referenceManifest.items) {
    if (path.basename(item.name) !== item.name) throw new Error('generation reference file name is unsafe')
    const buffer = await readFile(path.join(reviewDir, item.name))
    if (buffer.byteLength !== item.byte_length || sha256GenerationBytes(buffer) !== item.sha256) {
      throw new Error(`reviewed ${item.role} reference changed after Review`)
    }
    references.push({
      name: item.name,
      role: item.role,
      mimeType: 'image/png',
      buffer,
    })
  }
  const promptBuffer = await readFile(path.join(reviewDir, GENERATION_PROMPT_FILE))
  if (sha256GenerationBytes(promptBuffer) !== requestManifest.prompt_text_sha256) {
    throw new Error('reviewed generation prompt changed after Review')
  }
  const byRole = Object.fromEntries(references.map((image) => [image.role, image]))
  return {
    profile: currentProfile,
    providerPreset,
    requestManifest,
    referenceManifest,
    references: byRole,
    reviewedRequest: {
      provider_preset_id: providerPreset.id,
      model: providerPreset.model,
      prompt_contract: requestManifest.prompt_contract,
      prompt_sections: requestManifest.prompt_sections,
      review_binding: {
        reviewed_run_id: binding.reviewId,
        plan_hash: binding.expectedPlanHash,
        reference_manifest_sha256: binding.expectedReferenceManifestSha256,
      },
    },
  }
}

function generationFailurePatch(error, providerCallBudget, { jobStatus = null } = {}) {
  const failedDuringPostProcessing =
    jobStatus === JOB_STATUS.POST_PROCESSING ||
    error?.failure_stage === 'post_processing' ||
    error?.failure_status === JOB_STATUS.FAILED_POST_PROCESSING ||
    error?.status === JOB_STATUS.FAILED_POST_PROCESSING
  return {
    status: failedDuringPostProcessing ? JOB_STATUS.FAILED_POST_PROCESSING : JOB_STATUS.FAILED_MODEL_ERROR,
    failure_status: error.failure_status ?? error.status ?? (failedDuringPostProcessing ? JOB_STATUS.FAILED_POST_PROCESSING : null),
    reason: String(error.message || error),
    retry_hint: error.retry_hint ?? (failedDuringPostProcessing ? 'manual_inspect' : 'regenerate'),
    provider_call_budget: publicProviderCallBudget(providerCallBudget) ?? error.provider_call_budget ?? null,
    ...(error.candidate_selection || error.candidateSelection ? {
      candidate_selection: error.candidate_selection ?? error.candidateSelection,
    } : {}),
  }
}

async function attachTileConditioningReview(result, conditioned) {
  if (!conditioned?.report?.enabled) return result
  const review = buildTileConditioningReview({
    rawTiles: conditioned.rawTiles,
    conditionedTiles: conditioned.tiles,
    edgeConditioning: conditioned.report,
    qualityGate: result.qualityGate,
  })
  return {
    ...result,
    tileConditioningReview: review,
    files: {
      ...(result.files ?? {}),
      tileConditioningReviewPng: await encodeRgbaPng(renderTileConditioningContactSheet({
        rawTiles: conditioned.rawTiles,
        conditionedTiles: conditioned.tiles,
      })),
    },
  }
}

async function prepareMotionSourceOperation(req, { operationType, jobType }) {
  const body = await parseMotionSourceJson(req)
  rejectMotionClientPaths(body)
  const options = motionSourceOperationOptions(body, operationType)
  if (operationType === 'build') {
    const selection = motionSourceSelectionFields(body, options)
    normalizeMotionSelectionRequest({
      selectionMode: selection.selectionMode,
      selectedFrameIndexes: selection.selectedFrameIndexes,
      frameCount: null,
    })
  }
  const legacy = !(body.source_upload_id ?? body.sourceUploadId)
  const operationId = motionSourceOperationId(body, operationType, { legacy })
  const existingBinding = motionSourceLifecycle.getOperation(operationId)
  let resolved
  if (existingBinding && !legacy) {
    const sourceUploadId = body.source_upload_id ?? body.sourceUploadId
    const sourceIdentity = body.source_identity ?? body.sourceIdentity
    if (!sourceIdentity) {
      throw motionRequestError('invalid_source_identity', 'source_identity is required with source_upload_id')
    }
    resolved = {
      descriptor: {
        upload_id: String(sourceUploadId),
        source_identity: String(sourceIdentity),
      },
      legacy: false,
      released: motionSourceUploadStore.descriptor(sourceUploadId) === null,
    }
  } else {
    resolved = await resolveMotionSourceRequest(body, {
      uploadOperationId: legacy ? legacyUploadOperationId(operationId) : null,
      allowReleasedReplay: Boolean(existingBinding),
    })
  }
  let binding
  try {
    binding = motionSourceLifecycle.claimOperation({
      operationId,
      operationType: `motion_source_${operationType}`,
      sourceUploadId: resolved.descriptor.upload_id,
      sourceIdentity: resolved.descriptor.source_identity,
      options,
      createJob: () => createJob({ status: JOB_STATUS.QUEUED, type: jobType }),
    })
  } catch (error) {
    if (resolved.legacy && !existingBinding && !resolved.released) {
      await motionSourceUploadStore.release(resolved.descriptor.upload_id)
    }
    throw error
  }
  if (resolved.released && !binding.reused) {
    throw motionRequestError(
      'upload_released',
      'released Motion source data cannot start a new operation',
      { httpStatus: 410, retryHint: 'upload_with_new_operation' }
    )
  }
  if (!binding.reused) updateMotionBoundJob(binding, { status: JOB_STATUS.QUEUED })
  return {
    body,
    options,
    source: resolved.descriptor,
    binding,
    releaseUploadId: resolved.legacy ? resolved.descriptor.upload_id : null,
  }
}

function retainMotionSourceUpload(uploadId) {
  const key = String(uploadId || '')
  motionSourceWorkerReferences.set(
    key,
    (motionSourceWorkerReferences.get(key) ?? 0) + 1
  )
}

function releaseMotionSourceWorkerReference(uploadId) {
  const key = String(uploadId || '')
  const next = Math.max(0, (motionSourceWorkerReferences.get(key) ?? 0) - 1)
  if (next) motionSourceWorkerReferences.set(key, next)
  else motionSourceWorkerReferences.delete(key)
}

function clearMotionSourceReleaseRetry(uploadId) {
  const key = String(uploadId || '')
  const timer = motionSourceReleaseRetryTimers.get(key)
  if (timer) clearTimeout(timer)
  motionSourceReleaseRetryTimers.delete(key)
  motionSourceReleaseRetryAttempts.delete(key)
}

function scheduleMotionSourceReleaseRetry(uploadId) {
  const key = String(uploadId || '')
  if (
    !key ||
    !motionSourcePendingReleases.has(key) ||
    motionSourceReleaseRetryTimers.has(key)
  ) return false
  const attempt = motionSourceReleaseRetryAttempts.get(key) ?? 0
  if (attempt >= MOTION_SOURCE_RELEASE_RETRY_DELAYS_MS.length) return false
  motionSourceReleaseRetryAttempts.set(key, attempt + 1)
  const timer = setTimeout(() => {
    motionSourceReleaseRetryTimers.delete(key)
    void maybeReleaseMotionSourceUpload(key)
  }, MOTION_SOURCE_RELEASE_RETRY_DELAYS_MS[attempt])
  timer.unref()
  motionSourceReleaseRetryTimers.set(key, timer)
  return true
}

async function maybeReleaseMotionSourceUpload(uploadId) {
  const key = String(uploadId || '')
  if (!key || !motionSourcePendingReleases.has(key)) {
    clearMotionSourceReleaseRetry(key)
    return { upload_id: key || null, released: false, pending: false }
  }
  if (
    (motionSourceWorkerReferences.get(key) ?? 0) > 0 ||
    motionSourceLifecycle.hasNonTerminalUploadReferences(key)
  ) {
    return { upload_id: key, released: false, pending: true }
  }
  try {
    const result = await motionSourceUploadStore.release(key)
    motionSourcePendingReleases.delete(key)
    clearMotionSourceReleaseRetry(key)
    return { ...result, pending: false }
  } catch (error) {
    console.warn(`Motion upload cleanup failed for ${key}: ${String(error?.message || error)}`)
    return {
      upload_id: key,
      released: false,
      pending: true,
      retry_scheduled: scheduleMotionSourceReleaseRetry(key),
    }
  }
}

async function requestMotionSourceUploadRelease(uploadId) {
  const key = String(uploadId || '')
  if (!/^motion_upload_[A-Za-z0-9_-]+$/.test(key)) {
    throw motionRequestError(
      'invalid_upload_id',
      'motion source upload id must be a safe server-issued identifier'
    )
  }
  motionSourcePendingReleases.add(key)
  return maybeReleaseMotionSourceUpload(key)
}

async function requestMotionSourceUploadOperationRelease(operationId) {
  const key = String(operationId || '').trim()
  if (
    !key ||
    key.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)
  ) {
    throw motionRequestError(
      'invalid_operation_id',
      'upload operation id must be a safe identifier no longer than 160 characters'
    )
  }
  const descriptor = motionSourceUploadStore.descriptorForOperation(key)
  if (descriptor) {
    motionSourcePendingUploadOperationReleases.delete(key)
    return {
      operation_id: key,
      ...(await requestMotionSourceUploadRelease(descriptor.upload_id)),
    }
  }
  if (
    !motionSourcePendingUploadOperationReleases.has(key) &&
    motionSourcePendingUploadOperationReleases.size >= MOTION_SOURCE_PENDING_RELEASE_OPERATION_LIMIT
  ) {
    throw motionRequestError(
      'motion_release_capacity_exceeded',
      'pending Motion upload release capacity is exhausted for this server session',
      { httpStatus: 507, retryHint: 'restart_server_session' }
    )
  }
  motionSourcePendingUploadOperationReleases.add(key)
  return {
    operation_id: key,
    upload_id: null,
    released: false,
    pending: true,
  }
}

function enqueueMotionSourceOperation(binding, worker, retryHint, { releaseUploadId = null } = {}) {
  retainMotionSourceUpload(binding.source_upload_id)
  motionMediaQueue.enqueue(
    async () => {
      try {
        const active = motionSourceLifecycle.markActive(binding.job_id)
        updateMotionBoundJob(active, {
          status: JOB_STATUS.POST_PROCESSING,
          motion_source_lifecycle: 'active',
        })
        await worker(active)
      } finally {
        releaseMotionSourceWorkerReference(binding.source_upload_id)
        if (releaseUploadId) motionSourcePendingReleases.add(releaseUploadId)
        await maybeReleaseMotionSourceUpload(binding.source_upload_id).catch(() => {})
      }
    },
    async (error) => {
      try {
        failMotionBoundJob(binding, error, retryHint)
      } finally {
        await maybeReleaseMotionSourceUpload(binding.source_upload_id).catch(() => {})
      }
    }
  )
}

async function motionSourceBufferForDecode(source, binding) {
  motionSourceLifecycle.throwIfCancelled(binding.job_id)
  if (source.media_kind === 'video') return Buffer.alloc(0)
  const buffer = await readFile(source.source_path, { signal: binding.signal })
  motionSourceLifecycle.throwIfCancelled(binding.job_id)
  return buffer
}

async function analyzeUploadedMotionSource(source, binding) {
  motionSourceLifecycle.throwIfCancelled(binding.job_id)
  const report = await analyzeMotionSource({
    name: source.source_name,
    mediaKind: source.media_kind,
    byteLength: source.byte_length,
    ffmpegPath: resolveFfmpegPath(process.env),
    env: process.env,
    signal: binding.signal,
  })
  motionSourceLifecycle.throwIfCancelled(binding.job_id)
  return report
}

function assertMotionVideoToolAvailable(analysis) {
  if (!analysis.requires_external_binary || analysis.external_binary?.available) return
  const failureStatus = analysis.external_binary?.failure_status ?? 'external_tool_spawn_failed'
  throw motionRequestError(
    failureStatus,
    'FFmpeg is unavailable or its guarded availability probe failed; extraction was not retried.',
    { retryHint: 'configure_ffmpeg_and_start_new_operation' }
  )
}

async function handleAnalyzeMotionSource(req, res) {
  let prepared
  try {
    prepared = await prepareMotionSourceOperation(req, {
      operationType: 'analyze',
      jobType: 'motion_source_analysis',
    })
  } catch (error) {
    return sendMotionError(res, error, 'motion_source_analysis_request_failed')
  }
  const { source, binding, releaseUploadId } = prepared
  if (!binding.reused) {
    enqueueMotionSourceOperation(binding, async (active) => {
      const report = await analyzeUploadedMotionSource(source, active)
      const urls = await writeMotionSourceFiles(active.job_id, {
        'motion_source_analysis.json': report,
      }, active)
      const failed = report.status === 'fail'
      const patch = {
        analysis_status: report.status,
        source_kind: report.source_kind,
        requires_external_binary: report.requires_external_binary,
        warnings: report.warnings,
        blocking_errors: report.blocking_errors,
        ...urls,
        reason: failed ? report.blocking_errors.join(',') : null,
        retry_hint: failed ? 'choose_gif_zip_image_or_valid_video' : null,
      }
      if (failed) finishMotionBoundJobFailure(active, patch)
      else completeMotionBoundJob(active, { ...patch, status: JOB_STATUS.DONE })
    }, 'inspect_motion_source', { releaseUploadId })
  }
  sendJson(res, 202, getJob(binding.job_id))
}

async function handleMotionSourceToolStatus(req, res) {
  try {
    sendJson(res, 200, await motionSourceToolStatus())
  } catch (error) {
    sendJson(res, 500, { reason: String(error.message || error) })
  }
}

async function handleMotionSourceUpload(req, res, url) {
  const controller = new AbortController()
  const onAborted = () => controller.abort()
  const operationId = url.searchParams.get('operation_id')
  req.once('aborted', onAborted)
  try {
    const descriptor = await motionSourceUploadStore.upload({
      stream: req,
      sourceName: url.searchParams.get('source_name'),
      operationId,
      contentType: req.headers['content-type'] ?? 'application/octet-stream',
      contentLength: req.headers['content-length'],
      signal: controller.signal,
    })
    const releaseRequested = motionSourcePendingUploadOperationReleases.delete(
      String(operationId || '')
    )
    const release = releaseRequested
      ? await requestMotionSourceUploadRelease(descriptor.upload_id)
      : null
    sendJson(res, 201, {
      ...descriptor,
      ...(release ? {
        release_requested: true,
        release_pending: release.pending,
      } : {}),
    })
  } catch (error) {
    if (!req.complete && !req.destroyed) req.resume()
    if (!res.headersSent && !res.destroyed) sendMotionError(res, error, 'motion_source_upload_failed')
  } finally {
    req.removeListener('aborted', onAborted)
  }
}

async function handleReleaseMotionSourceUpload(req, res, uploadId) {
  try {
    const result = await requestMotionSourceUploadRelease(decodeURIComponent(uploadId))
    sendJson(res, 200, result)
  } catch (error) {
    sendMotionError(res, error, 'motion_source_release_failed')
  }
}

async function handleReleaseMotionSourceUploadOperation(req, res, operationId) {
  try {
    const result = await requestMotionSourceUploadOperationRelease(
      decodeURIComponent(operationId)
    )
    sendJson(res, 200, result)
  } catch (error) {
    sendMotionError(res, error, 'motion_source_operation_release_failed')
  }
}

async function handleCancelMotionSourceJob(req, res, jobId) {
  try {
    const body = await parseMotionSourceJson(req)
    rejectMotionClientPaths(body)
    const cancellation = motionSourceLifecycle.cancelJob(jobId)
    const current = getJob(cancellation.job_id)
    if (cancellation.patch && current?.failure_status !== 'cancelled') {
      updateMotionBoundJob(cancellation, cancellation.patch)
    }
    sendJson(res, 200, getJob(cancellation.job_id))
  } catch (error) {
    sendMotionError(res, error, 'motion_source_cancel_failed')
  }
}

async function handlePreviewMotionFrames(req, res) {
  let prepared
  try {
    prepared = await prepareMotionSourceOperation(req, {
      operationType: 'preview',
      jobType: 'motion_source_frame_preview',
    })
  } catch (error) {
    return sendMotionError(res, error, 'motion_frame_preview_request_failed')
  }
  const { options, source, binding, releaseUploadId } = prepared
  if (!binding.reused) {
    enqueueMotionSourceOperation(binding, async (active) => {
      const analysis = await analyzeUploadedMotionSource(source, active)
      assertMotionVideoToolAvailable(analysis)
      if (analysis.status === 'fail') {
        const urls = await writeMotionSourceFiles(active.job_id, {
          'motion_source_analysis.json': analysis,
        }, active)
        finishMotionBoundJobFailure(active, {
          analysis_status: analysis.status,
          source_kind: analysis.source_kind,
          blocking_errors: analysis.blocking_errors,
          warnings: analysis.warnings,
          ...urls,
          reason: analysis.blocking_errors.join(','),
          retry_hint: 'choose_gif_zip_image_or_valid_video',
        })
        return
      }

      const timing = motionSourceTimingOptions(options)
      const sourceBuffer = await motionSourceBufferForDecode(source, active)
      const videoOptions = await motionVideoExtractionOptions({ jobId: active.job_id, source })
      const extracted = await extractFrames(sourceBuffer, {
        ...videoOptions,
        kind: motionExtractorKind(source.media_kind),
        name: source.source_name,
        stride: timing.stride,
        maxFrames: timing.maxFrames,
        fps: timing.fps,
        startSec: timing.startSec,
        endSec: timing.endSec,
        ffmpegPath: resolveFfmpegPath(process.env),
        signal: active.signal,
      })
      motionSourceLifecycle.throwIfCancelled(active.job_id)
      const preview = await buildMotionFramePreviewArtifacts(extracted.frames, {
        sourceKind: motionSourceKindFromExtractor(extracted.kind),
        sourceName: source.source_name,
        sampling: {
          stride: timing.stride,
          max_frames: timing.maxFrames,
          fps: timing.fps,
          start_sec: timing.startSec,
          end_sec: timing.endSec ?? null,
        },
        ffmpeg: extracted.ffmpeg ?? null,
        frameProvenance: extracted.frame_provenance,
      })
      motionSourceLifecycle.throwIfCancelled(active.job_id)
      const urls = await writeMotionSourceFiles(active.job_id, {
        'motion_source_analysis.json': analysis,
        ...preview.files,
      }, active)
      motionSourceLifecycle.throwIfCancelled(active.job_id)
      completeMotionBoundJob(active, {
        status: JOB_STATUS.DONE,
        source_kind: motionSourceKindFromExtractor(extracted.kind),
        frame_count: preview.index.frame_count,
        input_frame_count: extracted.frame_count_raw,
        sampled_frame_count: extracted.frame_count,
        ...urls,
        reason: null,
        retry_hint: null,
      })
    }, 'inspect_motion_frame_preview', { releaseUploadId })
  }
  sendJson(res, 202, getJob(binding.job_id))
}

async function handleBuildMotionStrip(req, res) {
  let prepared
  try {
    prepared = await prepareMotionSourceOperation(req, {
      operationType: 'build',
      jobType: 'motion_source_build_strip',
    })
  } catch (error) {
    return sendMotionError(res, error, 'motion_strip_request_failed')
  }
  const { body, options, source, binding, releaseUploadId } = prepared
  if (!binding.reused) {
    enqueueMotionSourceOperation(binding, async (active) => {
      const analysis = await analyzeUploadedMotionSource(source, active)
      assertMotionVideoToolAvailable(analysis)
      if (analysis.status === 'fail') {
        const urls = await writeMotionSourceFiles(active.job_id, {
          'motion_source_analysis.json': analysis,
        }, active)
        finishMotionBoundJobFailure(active, {
          analysis_status: analysis.status,
          source_kind: analysis.source_kind,
          blocking_errors: analysis.blocking_errors,
          warnings: analysis.warnings,
          ...urls,
          reason: analysis.blocking_errors.join(','),
          retry_hint: 'choose_gif_zip_image_or_valid_video',
        })
        return
      }

      const timing = motionSourceTimingOptions(options)
      const selection = motionSourceSelectionFields(body, options)
      const sourceBuffer = await motionSourceBufferForDecode(source, active)
      const videoOptions = await motionVideoExtractionOptions({ jobId: active.job_id, source })
      const extracted = await extractFrames(sourceBuffer, {
        ...videoOptions,
        kind: motionExtractorKind(source.media_kind),
        name: source.source_name,
        stride: timing.stride,
        maxFrames: timing.maxFrames,
        fps: timing.fps,
        startSec: timing.startSec,
        endSec: timing.endSec,
        ffmpegPath: resolveFfmpegPath(process.env),
        signal: active.signal,
      })
      motionSourceLifecycle.throwIfCancelled(active.job_id)
      const validatedSelection = normalizeMotionSelectionRequest({
        selectionMode: selection.selectionMode,
        selectedFrameIndexes: selection.selectedFrameIndexes,
        frameCount: extracted.frames.length,
      })
      const matted = await maybeApplyExternalMotionMatting({
        jobId: active.job_id,
        frames: extracted.frames,
        options,
        signal: active.signal,
      })
      motionSourceLifecycle.throwIfCancelled(active.job_id)
      const contract = createMotionSourceContract({
        source_kind: motionSourceKindFromExtractor(extracted.kind),
        runtime_action: options.action ?? options.runtime_action ?? options.runtimeAction ?? body.action ?? 'walk_down',
        target_frame_count: optionalPositiveInt(
          options.target_frame_count ??
          options.targetFrameCount ??
          options.frames ??
          body.frames,
          validatedSelection.selectedFrameIndexes?.length || 8
        ),
        sampling: {
          stride: timing.stride,
          max_frames: timing.maxFrames,
          fps: timing.fps,
          start_sec: timing.startSec,
          end_sec: timing.endSec ?? null,
        },
        frame_size: motionFrameSizeOptions(options),
        anchor_policy: motionAnchorOptions(options),
        background: motionBackgroundOptions(options),
        motion_selection: options.motion_selection ?? false,
      })
      const result = await buildMotionStrip({
        frames: matted.frames,
        frameProvenance: extracted.frame_provenance,
        contract,
        selectionMode: selection.selectionMode,
        selectedFrameIndexes: selection.selectedFrameIndexes,
        pixelGridRefinement: options.pixel_grid_refinement ?? false,
        artifactBinding: motionBindingEvidence(active),
        signal: active.signal,
      })
      if (extracted.ffmpeg) result.report.ffmpeg = extracted.ffmpeg
      if (matted.report) result.report.external_matting = matted.report
      motionSourceLifecycle.throwIfCancelled(active.job_id)
      const urls = await writeMotionSourceFiles(active.job_id, {
        'motion_source_analysis.json': analysis,
        'normalized_motion_strip.png': result.normalizedMotionStripPng,
        'motion_contact_sheet.png': result.motionContactSheetPng,
        'motion_source_report.json': result.report,
        'selected_frames.json': result.selectedFrames,
        'video_frames_sheet.png': result.videoFramesSheetPng,
        'frames_index.json': result.framesIndex,
        'frames.zip': result.framesZip,
      }, active)
      motionSourceLifecycle.throwIfCancelled(active.job_id)
      completeMotionBoundJob(active, {
        status: JOB_STATUS.DONE,
        source_kind: contract.source_kind,
        action: contract.runtime_action,
        selected_frame_count: result.report.selected_frame_count,
        input_frame_count: result.report.input_frame_count,
        motion_source_status: result.report.status,
        frame_selection_mode: result.selectedFrames.selection_mode,
        requested_selection_mode: result.selectedFrames.requested_selection_mode,
        effective_selection_mode: result.selectedFrames.effective_selection_mode,
        external_matting_status: matted.report ? 'done' : 'skipped',
        warnings: result.report.warnings ?? result.report.source_warnings,
        ...urls,
        reason: null,
        retry_hint: null,
      })
    }, 'inspect_motion_strip', { releaseUploadId })
  }
  sendJson(res, 202, getJob(binding.job_id))
}

async function handleApplyMotionStrip(req, res) {
  let body
  try {
    body = await parseMotionSourceJson(req)
    rejectMotionClientPaths(body)
  } catch (error) {
    return sendMotionError(res, error, 'motion_strip_apply_request_failed')
  }
  const job = createJob({ status: JOB_STATUS.QUEUED, type: 'motion_source_apply_strip' })
  try {
    const sheetBuffer = base64Buffer(body.sheet_base64 ?? body.sheetBase64)
    const stripBuffer = base64Buffer(body.strip_base64 ?? body.stripBase64)
    const options = body.options ?? {}
    motionMediaQueue.enqueue(
      async () => {
        updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
        if (!sheetBuffer) throw new Error('apply-motion-strip requires sheet_base64')
        if (!stripBuffer) throw new Error('apply-motion-strip requires strip_base64')
        const result = await applyMotionStrip({
          sheet: await loadRgba(sheetBuffer),
          strip: await loadRgba(stripBuffer),
          action: options.action ?? body.action ?? 'walk_down',
          resampleStrategy: motionResampleStrategyFromBody(body),
        })
        const urls = await writeMotionSourceFiles(job.id, {
          'applied_normalized_sheet.png': result.appliedNormalizedSheetPng,
          'apply_motion_strip_report.json': result.report,
        })
        updateJob(job.id, {
          status: JOB_STATUS.DONE,
          action: result.report.action,
          resample_strategy: result.report.resample_strategy,
          source_strip_frame_count: result.report.source_strip_frame_count,
          target_frame_count: result.report.target_frame_count,
          validation_status: result.report.validation?.status ?? null,
          ...urls,
          reason: null,
          retry_hint: null,
        })
      },
      (error) => {
        updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_motion_strip_apply' })
      }
    )
  } catch (error) {
    updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_motion_strip_apply' })
  }
  sendJson(res, 202, getJob(job.id))
}

function motionSourceSetManifestFromBody(body = {}) {
  if (body.manifest) return body.manifest
  return {
    contract_version: body.contract_version,
    identity_anchor: body.identity_anchor ?? body.identityAnchor,
    background: body.background,
    sources: body.sources,
    output_profile: body.output_profile ?? body.outputProfile,
  }
}

function stripSourceEntriesFromBody(body = {}) {
  const entries = body.strips ?? body.strip_sources ?? body.stripSources ?? []
  return Array.isArray(entries) ? entries : []
}

function sourceStripBase64For(source, entries) {
  const match = entries.find((entry) => (
    entry.id === source.id ||
    entry.runtime_action === source.runtime_action ||
    entry.runtimeAction === source.runtime_action ||
    entry.source === source.source ||
    entry.source_name === source.source ||
    entry.sourceName === source.source
  ))
  return match?.source_base64 ?? match?.sourceBase64 ?? match?.strip_base64 ?? match?.stripBase64 ?? null
}

async function handleApplyMotionSourceSet(req, res) {
  let body
  try {
    body = await parseMotionSourceJson(req)
    rejectMotionClientPaths(body)
  } catch (error) {
    return sendMotionError(res, error, 'motion_source_set_apply_request_failed')
  }
  const job = createJob({ status: JOB_STATUS.QUEUED, type: 'motion_source_set_apply' })
  try {
    const sheetBuffer = base64Buffer(body.sheet_base64 ?? body.sheetBase64)
    const manifest = motionSourceSetManifestFromBody(body)
    const stripSources = stripSourceEntriesFromBody(body)
    motionMediaQueue.enqueue(
      async () => {
        updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
        if (!sheetBuffer) throw new Error('apply-motion-source-set requires sheet_base64')

        const setReport = validateMotionSourceSetManifest(manifest)
        const strips = []
        if (setReport.normalized_manifest) {
          for (const source of setReport.normalized_manifest.sources) {
            const sourceBase64 = sourceStripBase64For(source, stripSources)
            if (!sourceBase64) continue
            strips.push({
              id: source.id,
              runtime_action: source.runtime_action,
              target_frame_count: source.target_frame_count,
              facing_direction: source.facing_direction,
              image: await loadRgba(base64Buffer(sourceBase64)),
            })
          }
        }

        const result = await applyMotionSourceSet({
          sheet: await loadRgba(sheetBuffer),
          manifest,
          strips,
          resampleStrategy: motionResampleStrategyFromBody(body),
          identityThresholds: manifest?.identity_thresholds ?? manifest?.identityThresholds ?? body.identity_thresholds ?? body.identityThresholds,
        })
        const identityReport = result.identityReport ?? {
          schema_version: 1,
          mode: 'identity_consistency_report_v1',
          status: 'skipped',
          can_apply_multi_strip: false,
          warnings: ['identity_gate_not_run'],
          blocking_errors: result.report.blocking_errors,
        }
        const files = {
          'motion_source_set_apply_report.json': result.report,
          'motion_source_set_report.json': result.setReport,
          'identity_consistency_report.json': identityReport,
        }
        if (result.appliedNormalizedSheetPng) files['applied_normalized_sheet.png'] = result.appliedNormalizedSheetPng
        const urls = await writeMotionSourceFiles(job.id, files)
        const failed = result.report.status === 'fail'
        updateJob(job.id, {
          status: failed ? JOB_STATUS.FAILED_POST_PROCESSING : JOB_STATUS.DONE,
          source_set_apply_status: result.report.status,
          source_set_status: result.report.source_set_status,
          identity_status: result.report.identity_status,
          can_apply_multi_strip: result.report.can_apply_multi_strip,
          applied_actions: result.report.applied_actions,
          warnings: result.report.warnings,
          blocking_errors: result.report.blocking_errors,
          validation_status: result.report.validation?.status ?? null,
          ...urls,
          reason: failed ? result.report.blocking_errors.join(',') : null,
          retry_hint: failed ? 'inspect_motion_source_set_apply' : null,
        })
      },
      (error) => {
        updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_motion_source_set_apply' })
      }
    )
  } catch (error) {
    updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_motion_source_set_apply' })
  }
  sendJson(res, 202, getJob(job.id))
}

async function handleAnalyzeMotionSourceSet(req, res) {
  let body
  try {
    body = await parseMotionSourceJson(req)
    rejectMotionClientPaths(body)
  } catch (error) {
    return sendMotionError(res, error, 'motion_source_set_request_failed')
  }
  const job = createJob({ status: JOB_STATUS.QUEUED, type: 'motion_source_set_analysis' })
  try {
    const manifest = motionSourceSetManifestFromBody(body)
    const stripSources = stripSourceEntriesFromBody(body)
    motionMediaQueue.enqueue(
      async () => {
        updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
        const setReport = validateMotionSourceSetManifest(manifest)
        let identityReport = {
          schema_version: 1,
          mode: 'identity_consistency_report_v1',
          status: 'skipped',
          can_apply_multi_strip: false,
          warnings: ['source_set_validation_failed'],
          blocking_errors: setReport.blocking_errors,
        }

        if (setReport.normalized_manifest) {
          const normalized = setReport.normalized_manifest
          const strips = await Promise.all(normalized.sources.map(async (source) => {
            const sourceBase64 = sourceStripBase64For(source, stripSources)
            if (!sourceBase64) throw new Error(`missing_source_strip:${source.id}`)
            return {
              id: source.id,
              runtime_action: source.runtime_action,
              target_frame_count: source.target_frame_count,
              facing_direction: source.facing_direction,
              image: await loadRgba(base64Buffer(sourceBase64)),
            }
          }))
          const anchorSource = normalized.sources.find((source) => (
            source.id === normalized.identity_anchor.source_id ||
            source.runtime_action === normalized.identity_anchor.source_id
          ))
          identityReport = evaluateIdentityConsistency(strips, {
            identityAnchor: {
              ...normalized.identity_anchor,
              facing_direction: normalized.identity_anchor.facing_direction ?? anchorSource?.facing_direction,
            },
            thresholds: manifest.identity_thresholds ?? manifest.identityThresholds ?? body.identity_thresholds ?? body.identityThresholds,
          })
        }

        const urls = await writeMotionSourceFiles(job.id, {
          'motion_source_set_report.json': setReport,
          'identity_consistency_report.json': identityReport,
        })
        const failed = setReport.status === 'fail' || identityReport.status === 'fail'
        updateJob(job.id, {
          status: failed ? JOB_STATUS.FAILED_POST_PROCESSING : JOB_STATUS.DONE,
          source_set_status: setReport.status,
          identity_status: identityReport.status,
          can_apply_multi_strip: identityReport.can_apply_multi_strip,
          warnings: [...new Set([...(setReport.warnings ?? []), ...(identityReport.warnings ?? [])])],
          blocking_errors: [...new Set([...(setReport.blocking_errors ?? []), ...(identityReport.blocking_errors ?? [])])],
          ...urls,
          reason: failed ? [...new Set([...(setReport.blocking_errors ?? []), ...(identityReport.blocking_errors ?? [])])].join(',') : null,
          retry_hint: failed ? 'inspect_motion_source_set' : null,
        })
      },
      (error) => {
        updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_motion_source_set' })
      }
    )
  } catch (error) {
    updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_motion_source_set' })
  }
  sendJson(res, 202, getJob(job.id))
}

async function handleProcessSheet(req, res) {
  const job = createJob({ status: JOB_STATUS.QUEUED })
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'))
    const source = Buffer.from(body.source_base64, 'base64')
    const options = {
      ...(body.options ?? {}),
      blackSourceBuffer: body.source_black_base64 ? Buffer.from(body.source_black_base64, 'base64') : undefined,
    }
    jobQueue.enqueue(
      async () => {
        updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
        const result = await processSheetBuffer(source, options)
        await writeJobArtifacts(job, result)
      },
      (error) => {
        updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'manual_inspect' })
      }
    )
  } catch (error) {
    updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'manual_inspect' })
  }
  sendJson(res, 202, getJob(job.id))
}

async function handleGenerateCharacter(req, res) {
  loadLocalEnv()
  const job = createJob({ status: JOB_STATUS.QUEUED })
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'))
    const generationProfileId = generationProfileIdFromBody(body)
    const generationProfile = generationProfileId
      ? resolveFullSheetGenerationProfile(generationProfileId, { required: true })
      : null
    resolveBackgroundMode(backgroundModeFromGenerationBody(body) ?? 'auto', {
      allowDeterministicV2:
        generationProfile?.background_recipe_id ===
        BACKGROUND_RECIPE_IDS.DETERMINISTIC_PIXEL_MATTE_V2,
    })
    const initialReviewedGeneration = generationProfileId
      ? await verifyFullSheetGenerationReview(body)
      : null
    let providerCallBudget = null
    let prewrittenRawProviderOutputFileName = null
    jobQueue.enqueue(
      async () => {
        loadLocalEnv()
        updateJob(job.id, { status: JOB_STATUS.GENERATING })
        const providerEnv = Object.freeze(currentProviderEnv())
        const reviewedGeneration = initialReviewedGeneration
          ? await verifyFullSheetGenerationReview(body, { providerEnv })
          : null
        const reviewedInput = reviewedGeneration?.requestManifest.request_input
        const preset = reviewedGeneration?.profile.source_layout ?? body.preset ?? DEFAULT_GENERATION_PRESET
        const t2iMode = reviewedGeneration?.profile.generation_mode ??
          normalizeTextToImageMode(body.t2iMode ?? body.t2i_mode ?? body.mode)
        const characterPreset = reviewedInput?.character_preset ??
          body.characterPreset ?? body.character_preset ?? body.options?.characterPreset
        const promptFields = reviewedInput?.prompt_fields ?? promptFieldsFromBody(body)
        const backgroundMode = reviewedInput?.background_mode ??
          body.options?.backgroundMode ?? body.backgroundMode ?? body.background_mode ?? 'auto'
        const imageConfig = reviewedGeneration?.requestManifest.image_config ??
          imageConfigFromBody(body, { mode: t2iMode, characterPreset })
        const generationOptions = reviewedGeneration?.requestManifest.generation_options ??
          generationOptionsFromBody(body)
        providerCallBudget = providerCallBudgetFromBody(body, {
          plannedProviderCalls: generationOptions.candidateCount,
        })
        const templateImage = reviewedGeneration?.references.structure ??
          (t2iMode === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER || body.disable_template
            ? null
            : await loadTemplateImage(preset, { rootDir: __dirname }))
        const referenceImage = reviewedGeneration?.references.identity ?? uploadedImageFromBody(body, 'reference', 'reference.png')
        const paletteImage = reviewedGeneration?.references.palette ?? uploadedImageFromBody(body, 'palette', 'palette.png')
        if (t2iMode === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER) {
          const result = await runQualityCharacterTextToImage({
            description: body.description,
            providerPresetId: body.providerPresetId ?? body.provider_preset_id ?? body.provider_preset,
            imageConfig,
            generationOptions,
            promptFields,
            characterPreset,
            backgroundMode,
            referenceImage,
            paletteImage,
            pixelFinishing: body.pixelFinishing ?? body.pixel_finishing ?? body.options?.pixelFinishing ?? {},
            providerBudget: providerCallBudget.providerBudget,
            env: providerEnv,
          })
          updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
          await writeTextToImageJobArtifacts(job, result)
          updateJob(job.id, {
            provider_call_budget: publicProviderCallBudget(providerCallBudget),
            candidate_selection: result.report.candidate_selection,
            quality_spec: result.report.pixel_finishing?.quality_spec ?? null,
          })
          return
        }
        const production = await runProductionSheetTextToImage({
          description: reviewedInput?.description ?? body.description,
          name: body.name ?? body.options?.name ?? 'generated_character',
          preset,
          providerPresetId: reviewedGeneration?.providerPreset.id ??
            body.providerPresetId ?? body.provider_preset_id ?? body.provider_preset,
          imageConfig,
          generationOptions,
          promptFields,
          characterPreset,
          backgroundMode,
          templateImage,
          referenceImage,
          paletteImage,
          reviewedRequest: reviewedGeneration?.reviewedRequest ?? null,
          generationProfileId: reviewedGeneration?.profile.id ?? null,
          providerBudget: providerCallBudget.providerBudget,
          processOptions: reviewedGeneration
            ? {
                subjectCountGate: true,
                generationProfile: reviewedGeneration.profile,
              }
            : body.options ?? {},
          onRawProviderOutput: reviewedGeneration
            ? async ({ buffer, fileName, metadata, candidateIndex }) => {
                if (candidateIndex !== 1 || !/^raw_provider_output\.(?:png|jpg|webp|gif|bin)$/.test(fileName)) {
                  throw new Error('strict full-sheet raw Provider artifact contract changed')
                }
                const jobDir = safeGeneratedJobDir(job.id)
                await mkdir(jobDir, { recursive: true })
                const outputPath = path.join(jobDir, fileName)
                await writeFile(outputPath, buffer, { flag: 'wx' })
                prewrittenRawProviderOutputFileName = fileName
                updateJob(job.id, {
                  raw_provider_output_url: generatedUrlForFile(outputPath),
                  raw_provider_output_sha256: metadata.sha256,
                  raw_provider_output_mime_type: metadata.mime_type,
                  raw_provider_output_byte_length: metadata.byte_length,
                })
              }
            : null,
          backgroundMatteV2ArtifactUrlPrefix: reviewedGeneration?.profile.background_recipe_id ===
            BACKGROUND_RECIPE_IDS.DETERMINISTIC_PIXEL_MATTE_V2
            ? `/generated/${job.id}`
            : null,
          env: providerEnv,
        })
        updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
        await writeJobArtifacts(job, production.result, prewrittenRawProviderOutputFileName
          ? {
              allowExistingJobDir: true,
              verifiedExistingFiles: [prewrittenRawProviderOutputFileName],
            }
          : {})
        updateJob(job.id, {
          provider_call_budget: publicProviderCallBudget(providerCallBudget),
          candidate_selection: production.candidateSelection,
        })
      },
      (error) => {
        updateJob(job.id, generationFailurePatch(error, providerCallBudget, {
          jobStatus: getJob(job.id)?.status,
        }))
      }
    )
  } catch (error) {
    updateJob(job.id, generationFailurePatch(error, null))
  }
  sendJson(res, 202, getJob(job.id))
}

async function handleAcceptGeneratedCharacter(req, res, sourceJobId) {
  try {
    const raw = await readBodyBounded(req, 32 * 1024)
    let body
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      throw Object.assign(new Error('manual acceptance request must be valid JSON'), {
        code: 'invalid_acceptance_request',
        http_status: 400,
      })
    }
    const accepted = await acceptFullSheetGeneration({
      sourceJobId,
      request: body,
      generatedDir,
    })
    return sendJson(res, 200, accepted)
  } catch (error) {
    return sendJson(res, Number(error?.http_status) || 400, {
      error: error?.code ?? 'full_sheet_manual_acceptance_failed',
      reason: String(error?.reason ?? error?.message ?? error),
      provider_calls_used: 0,
    })
  }
}

async function handleProcessSceneTiles(req, res) {
  const job = createJob({ status: JOB_STATUS.QUEUED })
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'))
    const sourceBuffer = Buffer.from(body.source_base64, 'base64')
    jobQueue.enqueue(
      async () => {
        updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
        const source = await loadRgba(sourceBuffer)
        const styleCorrection = sceneStyleCorrectionOptions(body.options)
        const corrected = styleCorrection ? applyPixelStyleCorrection(source, styleCorrection) : null
        const edgeConditioning = sceneEdgeConditioningOptions(body.options)
        const sourceBeforeEdgeConditioning = corrected?.image ?? source
        const conditioned = edgeConditioning ? conditionTileSheetEdges(sourceBeforeEdgeConditioning, edgeConditioning) : null
        const sourceForIngestion = conditioned?.source ?? sourceBeforeEdgeConditioning
        const tilesetPngForIngestion = corrected || conditioned?.report?.enabled ? await encodeRgbaPng(sourceForIngestion) : sourceBuffer
        const result = await attachTileConditioningReview(buildScenePackFromTileSheet({
          source: sourceForIngestion,
          tilesetPng: tilesetPngForIngestion,
          projectId: body.options?.projectId ?? body.options?.project_id ?? 'uploaded_scene_project',
          identifier: body.options?.identifier ?? 'uploaded_scene',
          width: body.options?.width ?? 6,
          height: body.options?.height ?? 4,
          pattern: body.options?.pattern ?? 'island',
          seed: body.options?.seed ?? 1,
          density: body.options?.density ?? 0.5,
          tilesetRelPath: body.options?.tilesetRelPath ?? body.options?.tileset_rel_path ?? 'tileset.png',
          palette: body.options?.palette,
          thresholds: body.options?.thresholds,
          gatePolicy: sceneTileGatePolicyOptions(body.options),
          styleCorrectionReport: corrected?.report,
          edgeConditioningReport: conditioned?.report,
        }), conditioned)
        await writeSceneJobArtifacts(job, result)
      },
      (error) => {
        updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_scene_tiles' })
      }
    )
  } catch (error) {
    updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_scene_tiles' })
  }
  sendJson(res, 202, getJob(job.id))
}

async function handleGenerateSceneTiles(req, res) {
  loadLocalEnv()
  let body
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'))
  } catch (error) {
    return sendJson(res, 400, { error: 'invalid_json', reason: String(error.message || error) })
  }
  if (!body.confirm_live_generation && !body.yes) {
    return sendJson(res, 400, {
      error: 'missing_live_generation_confirmation',
      reason: 'scene tile generation uses live provider quota; pass confirm_live_generation: true',
    })
  }

  const job = createJob({ status: JOB_STATUS.QUEUED, type: 'scene_tile_generation' })
  jobQueue.enqueue(
    async () => {
      loadLocalEnv()
      updateJob(job.id, { status: JOB_STATUS.GENERATING })
      const options = body.options ?? {}
      const result = await generateSceneTilePack({
        description: body.description ?? options.description ?? '',
        providerPresetId: body.providerPresetId ?? body.provider_preset_id ?? body.provider_preset ?? options.providerPresetId ?? options.provider_preset_id,
        imageConfig: body.imageConfig ?? body.image_config ?? options.imageConfig ?? options.image_config ?? {},
        candidateCount: sceneTileCandidateCount(options),
        projectId: options.projectId ?? options.project_id ?? 'generated_scene_project',
        identifier: options.identifier ?? 'generated_scene',
        width: options.width ?? 6,
        height: options.height ?? 4,
        pattern: options.pattern ?? 'island',
        seed: options.seed ?? 1,
        density: options.density ?? 0.5,
        tilesetRelPath: options.tilesetRelPath ?? options.tileset_rel_path ?? 'tileset.png',
        palette: options.palette,
        thresholds: options.thresholds,
        gatePolicy: sceneTileGatePolicyOptions(options),
        styleCorrection: sceneStyleCorrectionOptions(options),
        edgeConditioning: sceneEdgeConditioningOptions(options),
        env: currentProviderEnv(),
      })
      await writeSceneJobArtifacts(job, result)
    },
    (error) => {
      updateJob(job.id, {
        status: error.status ?? JOB_STATUS.FAILED_MODEL_ERROR,
        reason: String(error.message || error),
        retry_hint: error.retry_hint ?? 'regenerate_scene_tiles',
      })
    }
  )
  sendJson(res, 202, getJob(job.id))
}

async function handleProjectPack(req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'))
  } catch (error) {
    return sendJson(res, 400, { error: 'invalid_json', reason: String(error.message || error) })
  }

  const characterJobId = body.character_job_id ?? body.characterJobId
  const sceneJobId = body.scene_job_id ?? body.sceneJobId
  if (!characterJobId) return sendJson(res, 400, { error: 'missing_character_job_id', reason: 'project pack requires character_job_id' })
  if (!sceneJobId) return sendJson(res, 400, { error: 'missing_scene_job_id', reason: 'project pack requires scene_job_id' })

  const projectId = body.projectId ?? body.project_id ?? body.options?.projectId ?? body.options?.project_id
  const createdAt = body.createdAt ?? body.created_at ?? body.options?.createdAt ?? body.options?.created_at
  const styleContract = body.styleContract ?? body.style_contract ?? body.options?.styleContract ?? body.options?.style_contract
  const strictStyleContract = body.strictStyleContract ?? body.strict_style_contract ?? body.options?.strictStyleContract ?? body.options?.strict_style_contract
  const stylePolicy = body.stylePolicy ?? body.style_policy ?? body.options?.stylePolicy ?? body.options?.style_policy ?? (strictStyleContract ? 'strict' : 'warn')
  const job = createJob({
    status: JOB_STATUS.QUEUED,
    type: 'project_pack',
    project_id: projectId ?? null,
    character_job_id: characterJobId,
    scene_job_id: sceneJobId,
  })
  jobQueue.enqueue(
    async () => {
      updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
      const result = buildProjectPack({
        projectId: projectId ?? job.id,
        createdAt,
        characterResult: await loadCharacterPackResultFromDir(safeGeneratedJobDir(characterJobId)),
        sceneResult: await loadScenePackResultFromDir(safeGeneratedJobDir(sceneJobId)),
        styleContract,
        stylePolicy,
      })
      await writeProjectJobArtifacts(job, result)
    },
    (error) => {
      updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_project_pack' })
    }
  )
  sendJson(res, 202, getJob(job.id))
}

async function handleBuildTwoPointFiveDTileset(req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'))
  } catch (error) {
    return sendJson(res, 400, { error: 'invalid_json', reason: String(error.message || error) })
  }
  const materialSourcePrompt = twoPointFiveDMaterialSourcePromptFromBody(body)
  if (materialSourcePrompt && !body.confirm_live_generation && !body.yes) {
    return sendJson(res, 400, {
      error: 'missing_live_generation_confirmation',
      reason: '2.5D material source generation uses live provider quota; pass confirm_live_generation: true',
    })
  }

  const job = createJob({ status: JOB_STATUS.QUEUED, type: 'two_point_five_d_tileset' })
  try {
    const materialSourceBuffer = base64Buffer(body.material_source_base64 ?? body.materialSourceBase64)
    const uploadedMaterialSource = materialSourceBuffer
      ? {
          id: body.material_source_name ?? body.materialSourceName ?? 'browser_material_source.png',
          path: body.material_source_name ?? body.materialSourceName,
          buffer: materialSourceBuffer,
        }
      : null
    if (uploadedMaterialSource && materialSourcePrompt) {
      throw new Error('2.5D tileset build accepts either uploaded material_source_base64 or material_source_prompt, not both')
    }
    let jobProviderCallBudget = null
    jobQueue.enqueue(
      async () => {
        let materialSource = uploadedMaterialSource
        let aiMaterialSourceBridge = null
        if (materialSourcePrompt) {
          loadLocalEnv()
          updateJob(job.id, { status: JOB_STATUS.GENERATING })
          const providerCallBudget = providerCallBudgetFromBody(body, { plannedProviderCalls: 1 })
          jobProviderCallBudget = providerCallBudget
          const generatedMaterialSource = await generateTwoPointFiveDMaterialSource({
            description: materialSourcePrompt,
            promptFields: twoPointFiveDMaterialSourcePromptFieldsFromBody(body),
            contract: body.contract ?? body.options?.contract ?? {},
            providerPresetId: body.providerPresetId ?? body.provider_preset_id ?? body.provider_preset ?? body.options?.providerPresetId ?? body.options?.provider_preset_id,
            imageConfig: twoPointFiveDMaterialSourceImageConfigFromBody(body),
            generationOptions: twoPointFiveDMaterialSourceGenerationOptionsFromBody(body),
            providerBudget: providerCallBudget.providerBudget,
            env: currentProviderEnv(),
          })
          aiMaterialSourceBridge = generatedMaterialSource.report
          materialSource = {
            id: `${job.id}_provider_material_source.png`,
            path: `${job.id}_provider_material_source.png`,
            buffer: generatedMaterialSource.buffer,
          }
          updateJob(job.id, {
            status: JOB_STATUS.POST_PROCESSING,
            provider_call_budget: publicProviderCallBudget(providerCallBudget),
            ai_material_source_bridge_status: aiMaterialSourceBridge.status,
            ai_material_source_provider: aiMaterialSourceBridge.provider,
            ai_material_source_provider_preset_id: aiMaterialSourceBridge.provider_preset_id,
            ai_material_source_model: aiMaterialSourceBridge.model,
          })
        } else {
          updateJob(job.id, { status: JOB_STATUS.POST_PROCESSING })
        }
        const result = await writeTwoPointFiveDTilesetArtifacts({
          contract: body.contract ?? body.options?.contract ?? {},
          materialSource,
          materialSourceBridge: aiMaterialSourceBridge,
          materialSampleLayout: body.material_sample_layout ?? body.materialSampleLayout ?? body.options?.materialSampleLayout,
          mapOptions: twoPointFiveDMapOptions(body.options ?? body),
          outputDir: generatedDir,
          runId: job.id,
        })
        await writeTwoPointFiveDJobArtifacts(job, result)
      },
      (error) => {
        if (error.status || error.failure_status) {
          updateJob(job.id, generationFailurePatch(error, jobProviderCallBudget))
        } else {
          updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_two_point_five_d_tileset' })
        }
      }
    )
  } catch (error) {
    updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_two_point_five_d_tileset' })
  }
  sendJson(res, 202, getJob(job.id))
}

async function handleTwoPointFiveDMaterialSourceBenchmark(req, res) {
  loadLocalEnv()
  let body
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'))
  } catch (error) {
    return sendJson(res, 400, { error: 'invalid_json', reason: String(error.message || error) })
  }

  const dryRunPlan = Boolean(body.dryRunPlan ?? body.dry_run_plan)
  const liveConfirmed = Boolean(body.confirm_live_generation ?? body.yes)
  if (!dryRunPlan && !liveConfirmed) {
    return sendJson(res, 400, {
      error: 'missing_live_generation_confirmation',
      reason: '2.5D material source benchmark uses live provider quota; pass dryRunPlan: true to inspect or confirm_live_generation: true',
    })
  }
  if (!dryRunPlan && !hasProviderCallBudgetLimit(body)) {
    return sendJson(res, 400, {
      error: 'missing_provider_call_budget',
      reason: '2.5D material source benchmark requires maxProviderCalls before live provider generation',
    })
  }

  let plan
  let planEvidence
  try {
    const fallbackRunId = dryRunPlan ? `material_source_benchmark_plan_${Date.now().toString(36)}` : undefined
    const runId = dryRunPlan
      ? safeRunId(body.runId ?? body.run_id, fallbackRunId)
      : null
    plan = dryRunPlan
      ? twoPointFiveDMaterialSourceBenchmarkPlanFromBody(body, { runId })
      : null
    if (dryRunPlan) {
      planEvidence = {
        ...plan,
        provider_config: publicTwoPointFiveDMaterialSourceProviderConfig(plan.provider_preset_id),
      }
      await mkdir(plan.output_dir, { recursive: true })
      await writeFile(path.join(plan.output_dir, 'material_source_benchmark_plan.json'), JSON.stringify(planEvidence, null, 2))
      return sendJson(res, 200, {
        mode: 'dry_run_plan',
        status: 'done',
        run_id: plan.run_id,
        output_dir: plan.output_dir,
        estimated_provider_calls: plan.estimated_provider_calls,
        candidate_count: plan.candidate_count,
        case_ids: plan.cases.map((item) => item.id),
        provider_config: planEvidence.provider_config,
        plan_url: benchmarkPlanArtifactUrl(plan.output_dir),
        claim_boundary: plan.claim_boundary,
      })
    }
  } catch (error) {
    return sendJson(res, 400, { error: 'benchmark_plan_failed', reason: String(error.message || error) })
  }

  const expectedProviderConfig = body.expectedProviderConfig ?? body.expected_provider_config
  let sealedProviderEnv = null
  if (expectedProviderConfig !== undefined) {
    let expectedBinding
    let currentBinding
    try {
      expectedBinding = twoPointFiveDMaterialSourceProviderBinding(expectedProviderConfig)
      if (!expectedBinding.selected_available) throw new Error('expectedProviderConfig must seal an available Provider')
      currentBinding = twoPointFiveDMaterialSourceProviderBinding(
        publicTwoPointFiveDMaterialSourceProviderConfig(
          twoPointFiveDMaterialSourceBenchmarkProviderPresetId(body),
        ),
      )
    } catch (error) {
      return sendJson(res, 400, {
        error: 'benchmark_provider_binding_invalid',
        reason: String(error.message || error),
      })
    }
    if (!twoPointFiveDMaterialSourceProviderBindingMatches(expectedBinding, currentBinding)) {
      return sendJson(res, 409, {
        error: 'benchmark_provider_binding_stale',
        reason: 'The selected Provider model or route changed after the zero-call plan was sealed',
        expected_provider_config: expectedBinding,
        current_provider_config: currentBinding,
      })
    }
    sealedProviderEnv = currentProviderEnv()
  }

  const job = createJob({ status: JOB_STATUS.QUEUED, type: 'two_point_five_d_material_source_benchmark' })
  try {
    plan = twoPointFiveDMaterialSourceBenchmarkPlanFromBody(body, { runId: safeRunId(body.runId ?? body.run_id, job.id) })
    planEvidence = {
      ...plan,
      provider_config: publicTwoPointFiveDMaterialSourceProviderConfig(plan.provider_preset_id),
    }
    const providerCallBudget = providerCallBudgetFromBody(body, { plannedProviderCalls: plan.estimated_provider_calls })
    updateJob(job.id, {
      estimated_provider_calls: plan.estimated_provider_calls,
      candidate_count: plan.candidate_count,
      case_ids: plan.cases.map((item) => item.id),
      provider_config: planEvidence.provider_config,
      provider_call_budget: publicProviderCallBudget(providerCallBudget),
    })
    jobQueue.enqueue(
      async () => {
        loadLocalEnv()
        updateJob(job.id, { status: JOB_STATUS.GENERATING })
        const report = await runTwoPointFiveDMaterialSourceBenchmark({
          plan: planEvidence,
          providerBudget: providerCallBudget.providerBudget,
          env: sealedProviderEnv ?? currentProviderEnv(),
        })
        updateJob(job.id, {
          status: JOB_STATUS.DONE,
          benchmark_status: report.status,
          material_source_benchmark_status: report.status,
          run_id: report.run_id,
          output_dir: report.output_dir,
          estimated_provider_calls: report.plan.estimated_provider_calls,
          candidate_count: report.plan.candidate_count,
          case_count: report.summary.case_count,
          selected_usable_rate: report.summary.selected_usable_rate,
          selected_pass_rate: report.summary.selected_pass_rate,
          selected_validation: report.summary.selected_validation,
          candidate_validation: report.summary.candidate_validation,
          failure_taxonomy: report.summary.failure_taxonomy,
          provider_call_budget: report.summary.provider_call_budget,
          claim_boundary: report.claim_boundary,
          ...benchmarkArtifactUrls(report.output_dir),
          reason: null,
          retry_hint: null,
        })
      },
      (error) => {
        if (error.status || error.failure_status) {
          updateJob(job.id, generationFailurePatch(error, providerCallBudget))
        } else {
          updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'inspect_two_point_five_d_material_source_benchmark' })
        }
      }
    )
  } catch (error) {
    updateJob(job.id, { status: JOB_STATUS.FAILED_MODEL_ERROR, reason: String(error.message || error), retry_hint: 'inspect_two_point_five_d_material_source_benchmark' })
  }
  sendJson(res, 202, getJob(job.id))
}

async function handleBuildFrameGif(req, res) {
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'))
    const frames = Array.isArray(body.frames_base64) ? body.frames_base64 : []
    const buffers = frames.map((frame) => Buffer.from(frame, 'base64'))
    const gif = await buildFrameGifFromImages(buffers, body.options ?? {})
    res.writeHead(200, { 'content-type': 'image/gif' })
    res.end(gif)
  } catch (error) {
    sendJson(res, 400, { error: 'gif_build_failed', reason: String(error.message || error) })
  }
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function serveStatic(req, res) {
  if (req.method !== 'GET') return sendJson(res, 404, { error: 'not_found' })
  let requestUrl
  let pathname
  try {
    requestUrl = new URL(req.url, `http://127.0.0.1:${port}`)
    pathname = decodeURIComponent(requestUrl.pathname)
  } catch {
    return sendJson(res, 404, { error: 'not_found' })
  }
  if (pathname === '/' || pathname === '/index.html') {
    res.statusCode = 302
    res.setHeader('location', '/src/ui/studio/studio.html#character')
    res.setHeader('cache-control', 'no-store')
    return res.end()
  }
  if (pathname === '/legacy' || pathname === '/legacy/' || pathname === '/legacy.html') {
    const studioLocation = legacyStudioRedirectLocation(requestUrl.search)
    res.statusCode = 302
    res.setHeader('location', studioLocation)
    res.setHeader('cache-control', 'no-store')
    return res.end()
  }
  let rootPath
  let relativePath
  if (pathname === '/editor' || pathname === '/editor/' || pathname === '/editor.html') {
    rootPath = __dirname
    relativePath = 'editor.html'
  } else if (pathname.startsWith('/src/')) {
    rootPath = path.join(__dirname, 'src')
    relativePath = pathname.slice('/src/'.length)
  } else if (pathname.startsWith('/generated/')) {
    rootPath = generatedDir
    relativePath = pathname.slice('/generated/'.length)
  } else {
    return sendJson(res, 404, { error: 'not_found' })
  }
  const lexicalRoot = path.resolve(rootPath)
  const lexicalFile = path.resolve(lexicalRoot, relativePath)
  if (!relativePath || !containedPath(lexicalRoot, lexicalFile)) {
    return sendJson(res, 404, { error: 'not_found' })
  }
  let realRoot
  let realFile
  let fileStat
  try {
    ;[realRoot, realFile] = await Promise.all([realpath(lexicalRoot), realpath(lexicalFile)])
    fileStat = await stat(realFile)
  } catch {
    return sendJson(res, 404, { error: 'not_found' })
  }
  if (!containedPath(realRoot, realFile) || !fileStat.isFile()) {
    return sendJson(res, 404, { error: 'not_found' })
  }
  const contentType = CONTENT_TYPES[path.extname(realFile)] ?? 'application/octet-stream'
  res.setHeader('content-type', contentType)
  createReadStream(realFile)
    .on('error', () => {
      if (!res.headersSent) sendJson(res, 404, { error: 'not_found' })
      else res.destroy()
    })
    .pipe(res)
}

const apiRouteHandlers = {
  editor: (req, res) => handleEditorProjectApi(req, res, {
    projectRoot: __dirname,
    workspaceRoot: editorWorkspaceDir,
    generatedDir: editorGeneratedDir,
    specializedGeneratedDir: generatedDir,
    artifactAccessRegistry: editorArtifactAccessRegistry,
    getGeneratedJob: getJob,
    updateGeneratedJob: updateJob,
  }),
  job: (req, res, jobId) => sendJson(
    res,
    200,
    getJob(jobId) ?? { status: 'not_found' },
  ),
  geminiState: (req, res) => {
    loadLocalEnv()
    return sendJson(res, 200, publicProviderState())
  },
  benchmarkGallery: async (req, res) => sendJson(
    res,
    200,
    await buildBenchmarkGallery({ generatedDir }),
  ),
  providerConfig: handleProviderConfig,
  repairCharacterAction: handleRepairCharacterAction,
  processSheet: handleProcessSheet,
  generateCharacterReview: handleGenerateCharacterReview,
  generateCharacter: handleGenerateCharacter,
  acceptGeneratedCharacter: handleAcceptGeneratedCharacter,
  buildFrameGif: handleBuildFrameGif,
  motionSourceToolStatus: handleMotionSourceToolStatus,
  motionSourceUpload: handleMotionSourceUpload,
  releaseMotionSourceUploadOperation: handleReleaseMotionSourceUploadOperation,
  releaseMotionSourceUpload: handleReleaseMotionSourceUpload,
  cancelMotionSourceJob: handleCancelMotionSourceJob,
  analyzeMotionSource: handleAnalyzeMotionSource,
  previewMotionFrames: handlePreviewMotionFrames,
  buildMotionStrip: handleBuildMotionStrip,
  applyMotionStrip: handleApplyMotionStrip,
  analyzeMotionSourceSet: handleAnalyzeMotionSourceSet,
  applyMotionSourceSet: handleApplyMotionSourceSet,
  processSceneTiles: handleProcessSceneTiles,
  generateSceneTiles: handleGenerateSceneTiles,
  buildTwoPointFiveDTileset: handleBuildTwoPointFiveDTileset,
  twoPointFiveDMaterialSourceBenchmark: handleTwoPointFiveDMaterialSourceBenchmark,
  projectPack: handleProjectPack,
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)
  if (await routeApi({ req, res, url, handlers: apiRouteHandlers })) return
  return serveStatic(req, res)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Character tool running at http://127.0.0.1:${port}/`)
})
