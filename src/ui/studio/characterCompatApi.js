import {
  assertLocalCharacterAnimations,
  assertLocalCharacterDebugReport,
  encodeLocalCharacterFile,
  requestStudioCharacterJson,
  requestStudioCharacterText,
} from './characterLocalApi.js'
import { assertRelativeGeneratedUrl } from './characterApi.js'
import { validateAdvancedLocalSourceFile } from './characterAdvancedLocal.js'
import { buildQualityCharacterPrompt } from '../../character-pack/textToImagePrompt.js'
import { templateFileForSourceLayout } from '../../character-pack/sourceLayoutIds.js'

const SAFE_JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/
const COMPAT_ACTIVE_STATUSES = new Set(['queued', 'generating', 'post_processing'])
const COMPAT_TERMINAL_STATUSES = new Set([
  'done',
  'failed',
  'failed_quality_gate',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
])

const T2I_MODES = new Set(['production_sheet_v0', 'quality_character_v0'])
const CHARACTER_PRESETS = new Set([
  'rpg_humanoid_v0',
  'animal_companion_v0',
  'monster_creature_v0',
  'xianxia_hero_v0',
  'chibi_big_pixel_v0',
  'two_to_one_character_v0',
])
const GENERATION_LAYOUTS = new Set(['fixed_region_motion_v0', 'topdown_rpg_v0'])
const IMAGE_SIZES = new Set(['1K', '2K'])
const CANDIDATE_COUNTS = new Set([1, 2, 4, 6])
const BACKGROUND_MODES = new Set(['auto', 'flood', 'alpha'])
const OUTLINE_MODES = new Set(['outer', 'inner', 'both'])
const RELEASE_POLICIES = Object.freeze({
  production_sheet_v0: 'strict_live_generation_v1',
  quality_character_v0: 'golden_review_hard_thresholds_v1',
})

export const COMPAT_CHARACTER_TARGET_FRAME_SIZE = 96

export const COMPAT_CHARACTER_REQUEST_TIMEOUT_MS = 15_000
export const COMPAT_CHARACTER_POLL_INTERVAL_MS = 500
export const COMPAT_CHARACTER_POLL_LIMIT = 240

export const COMPAT_CHARACTER_DEFAULTS = Object.freeze({
  name: 'generated_character',
  description: '银发女剑士，深蓝披风，细长单手剑，金色护肩，小体型',
  t2iMode: 'production_sheet_v0',
  characterPreset: 'rpg_humanoid_v0',
  generationLayout: 'fixed_region_motion_v0',
  imageSize: '2K',
  candidateCount: 1,
  seed: null,
  backgroundMode: 'auto',
  backgroundTolerance: 24,
  componentCleanup: true,
  minAlpha: 18,
  minArea: 4,
  minAreaRatio: 0,
  autoCorrect: true,
  motionStabilize: true,
  motionMaxShift: 2,
  pixelFinishing: false,
  pixelFinishingMaxColors: 16,
  pixelFinishingOutline: true,
  pixelFinishingOutlineMode: 'outer',
  export1x: true,
  export2x: true,
  export3x: false,
  export4x: false,
})

export class StudioCharacterCompatApiError extends Error {
  constructor(code, message, { status = null, payload = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'StudioCharacterCompatApiError'
    this.code = code
    this.status = status
    this.payload = payload
  }
}

function compatError(code, message, options) {
  return new StudioCharacterCompatApiError(code, message, options)
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value, { name, min, max, integer = false }) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
    throw compatError('invalid_compat_input', `${name} is outside the supported range`)
  }
  return parsed
}

function enumValue(value, allowed, name) {
  const normalized = String(value ?? '')
  if (!allowed.has(normalized)) throw compatError('invalid_compat_input', `${name} is unsupported`)
  return normalized
}

function visibleText(value, { name, maxLength, required = true }) {
  const normalized = String(value ?? '').trim()
  if ((required && !normalized) || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw compatError('invalid_compat_input', `${name} must contain valid visible text`)
  }
  return normalized
}

export function normalizeCompatCharacterSettings(value = {}) {
  const source = { ...COMPAT_CHARACTER_DEFAULTS, ...value }
  const seed = source.seed === '' || source.seed == null
    ? null
    : finiteNumber(source.seed, { name: 'Seed', min: 0, max: 2_147_483_647, integer: true })
  const candidateCount = finiteNumber(source.candidateCount, {
    name: 'Candidate count', min: 1, max: 6, integer: true,
  })
  if (!CANDIDATE_COUNTS.has(candidateCount)) {
    throw compatError('invalid_compat_input', 'Candidate count must be 1, 2, 4, or 6')
  }
  const normalized = {
    name: visibleText(source.name, { name: 'Name', maxLength: 64 }),
    description: visibleText(source.description, { name: 'Description', maxLength: 2_000 }),
    t2iMode: enumValue(source.t2iMode, T2I_MODES, 'Generation mode'),
    characterPreset: enumValue(source.characterPreset, CHARACTER_PRESETS, 'Character preset'),
    generationLayout: enumValue(source.generationLayout, GENERATION_LAYOUTS, 'Generation layout'),
    imageSize: enumValue(source.imageSize, IMAGE_SIZES, 'Image size'),
    candidateCount,
    seed,
    backgroundMode: enumValue(source.backgroundMode, BACKGROUND_MODES, 'Background mode'),
    backgroundTolerance: finiteNumber(source.backgroundTolerance, { name: 'Background tolerance', min: 0, max: 80, integer: true }),
    componentCleanup: Boolean(source.componentCleanup),
    minAlpha: finiteNumber(source.minAlpha, { name: 'Minimum alpha', min: 0, max: 80, integer: true }),
    minArea: finiteNumber(source.minArea, { name: 'Minimum area', min: 1, max: 64, integer: true }),
    minAreaRatio: finiteNumber(source.minAreaRatio, { name: 'Minimum area ratio', min: 0, max: 0.25 }),
    autoCorrect: Boolean(source.autoCorrect),
    motionStabilize: Boolean(source.motionStabilize),
    motionMaxShift: finiteNumber(source.motionMaxShift, { name: 'Maximum motion shift', min: 0, max: 8, integer: true }),
    pixelFinishing: Boolean(source.pixelFinishing),
    pixelFinishingMaxColors: finiteNumber(source.pixelFinishingMaxColors, { name: 'Maximum colors', min: 2, max: 64, integer: true }),
    pixelFinishingOutline: Boolean(source.pixelFinishingOutline),
    pixelFinishingOutlineMode: enumValue(source.pixelFinishingOutlineMode, OUTLINE_MODES, 'Outline mode'),
    export1x: Boolean(source.export1x),
    export2x: Boolean(source.export2x),
    export3x: Boolean(source.export3x),
    export4x: Boolean(source.export4x),
  }
  if (
    normalized.t2iMode === 'production_sheet_v0' &&
    ![normalized.export1x, normalized.export2x, normalized.export3x, normalized.export4x].some(Boolean)
  ) {
    throw compatError('invalid_compat_input', 'Choose at least one export scale')
  }
  return Object.freeze(normalized)
}

export function validateCompatCharacterImageFile(file, { required = false, label = 'Image' } = {}) {
  if (!file) {
    if (required) throw compatError('compat_image_required', `${label} is required`)
    return null
  }
  try {
    return validateAdvancedLocalSourceFile(file, { label })
  } catch (error) {
    throw compatError('invalid_compat_image', String(error?.message || error), { cause: error })
  }
}

function fileBinding(file) {
  if (!file) return null
  return {
    name: String(file.name ?? ''),
    size: Number(file.size),
    type: String(file.type ?? ''),
    lastModified: Number(file.lastModified ?? 0),
  }
}

function selectedExportScales(settings) {
  return [1, 2, 3, 4].filter((scale) => settings[`export${scale}x`])
}

export function compatCharacterOutputFrameSizes(settings) {
  const normalized = normalizeCompatCharacterSettings(settings)
  if (normalized.t2iMode !== 'production_sheet_v0') return Object.freeze([])
  return Object.freeze(selectedExportScales(normalized).map((scale) => COMPAT_CHARACTER_TARGET_FRAME_SIZE * scale))
}

export function compatCharacterInputFingerprint({ settings, referenceFile = null, paletteFile = null, inputEpoch = 0 } = {}) {
  return JSON.stringify({
    inputEpoch: Number(inputEpoch),
    settings: normalizeCompatCharacterSettings(settings),
    reference: fileBinding(validateCompatCharacterImageFile(referenceFile)),
    palette: fileBinding(validateCompatCharacterImageFile(paletteFile)),
  })
}

export async function buildCompatCharacterRequest({
  settings,
  referenceFile = null,
  paletteFile = null,
}, { signal } = {}) {
  const normalized = normalizeCompatCharacterSettings(settings)
  validateCompatCharacterImageFile(referenceFile, { label: 'Reference image' })
  validateCompatCharacterImageFile(paletteFile, { label: 'Palette image' })
  const [referenceBase64, paletteBase64] = await Promise.all([
    referenceFile
      ? encodeLocalCharacterFile(referenceFile, {
          signal,
          validate: (file) => validateCompatCharacterImageFile(file, { required: true, label: 'Reference image' }),
        })
      : null,
    paletteFile
      ? encodeLocalCharacterFile(paletteFile, {
          signal,
          validate: (file) => validateCompatCharacterImageFile(file, { required: true, label: 'Palette image' }),
        })
      : null,
  ])
  const pixelFinishing = normalized.t2iMode === 'quality_character_v0'
    ? {
        maxColors: normalized.pixelFinishingMaxColors,
        outline: normalized.pixelFinishingOutline,
      }
    : normalized.pixelFinishing
      ? {
        maxColors: normalized.pixelFinishingMaxColors,
        outline: normalized.pixelFinishingOutline,
        outlineMode: normalized.pixelFinishingOutlineMode,
      }
      : {}
  const options = normalized.t2iMode === 'production_sheet_v0'
    ? {
        name: normalized.name,
        backgroundMode: normalized.backgroundMode,
        backgroundTolerance: normalized.backgroundTolerance,
        componentCleanup: normalized.componentCleanup,
        minAlpha: normalized.minAlpha,
        minArea: normalized.minArea,
        minAreaRatio: normalized.minAreaRatio,
        autoCorrect: normalized.autoCorrect,
        motionStabilize: normalized.motionStabilize,
        motionStabilizationMaxShift: normalized.motionMaxShift,
        motionMaxShift: normalized.motionMaxShift,
        pixelFinishing: normalized.pixelFinishing,
        pixelFinishingMaxColors: normalized.pixelFinishingMaxColors,
        pixelFinishingOutline: normalized.pixelFinishingOutline,
        pixelFinishingOutlineMode: normalized.pixelFinishingOutlineMode,
        export1x: normalized.export1x,
        export2x: normalized.export2x,
        export3x: normalized.export3x,
        export4x: normalized.export4x,
        outputFrameSizes: selectedExportScales(normalized).map((scale) => COMPAT_CHARACTER_TARGET_FRAME_SIZE * scale),
        sourceLayout: normalized.generationLayout,
      }
    : {
        backgroundMode: normalized.backgroundMode,
      }
  return Object.freeze({
    description: normalized.description,
    ...(normalized.t2iMode === 'production_sheet_v0' ? { name: normalized.name } : {}),
    t2iMode: normalized.t2iMode,
    characterPreset: normalized.characterPreset,
    ...(normalized.t2iMode === 'production_sheet_v0' ? { preset: normalized.generationLayout } : {}),
    maxProviderCalls: normalized.candidateCount,
    imageConfig: {
      aspect_ratio: normalized.t2iMode === 'quality_character_v0' && normalized.characterPreset === 'two_to_one_character_v0'
        ? '2:1'
        : '1:1',
      image_size: normalized.imageSize,
    },
    pixelFinishing,
    generationOptions: {
      candidateCount: normalized.candidateCount,
      ...(normalized.seed == null ? {} : { seed: normalized.seed }),
    },
    reference_image_base64: referenceBase64,
    reference_image_mime: referenceFile?.type || null,
    reference_image_name: referenceFile?.name || null,
    palette_image_base64: paletteBase64,
    palette_image_mime: paletteFile?.type || null,
    palette_image_name: paletteFile?.name || null,
    options,
  })
}

function safeJobId(value) {
  const jobId = String(value ?? '')
  if (!SAFE_JOB_ID_PATTERN.test(jobId) || jobId.includes('..')) {
    throw compatError('invalid_job_receipt', 'Compatibility Job id is invalid')
  }
  return jobId
}

function assertJobUrl(job, field, fileName, { required = false } = {}) {
  const value = job?.[field]
  if (value == null && !required) return null
  if (value == null) throw compatError('release_url_missing', `${field} is required for verified download`)
  try {
    return assertRelativeGeneratedUrl(value, { jobId: safeJobId(job.id), fileName })
  } catch (error) {
    throw compatError('release_url_binding_mismatch', `${field} is not bound to the current Job`, { cause: error })
  }
}

export function assertCompatCharacterJob(job, { terminal = false } = {}) {
  if (!isRecord(job)) throw compatError('invalid_job_receipt', 'Compatibility Job is missing')
  const id = safeJobId(job.id)
  const status = String(job.status ?? '')
  if (!COMPAT_ACTIVE_STATUSES.has(status) && !COMPAT_TERMINAL_STATUSES.has(status)) {
    throw compatError('invalid_job_receipt', `Unexpected Compatibility Job status: ${status}`)
  }
  if (terminal && !COMPAT_TERMINAL_STATUSES.has(status)) {
    throw compatError('job_not_terminal', 'Compatibility Job did not reach a terminal status')
  }
  if (String(job.id) !== id) throw compatError('invalid_job_receipt', 'Compatibility Job id changed')
  return job
}

export async function submitCompatCharacterJob(input, {
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const body = await buildCompatCharacterRequest(input, { signal })
  const job = await requestStudioCharacterJson('/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    maxBytes: 4 * 1024 * 1024,
  }, fetchImpl)
  return assertCompatCharacterJob(job)
}

export async function fetchCompatCharacterJob(jobId, {
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const id = safeJobId(jobId)
  const job = await requestStudioCharacterJson(`/api/jobs/${encodeURIComponent(id)}`, {
    signal,
    maxBytes: 4 * 1024 * 1024,
  }, fetchImpl)
  if (String(job?.id ?? '') !== id) {
    throw compatError('job_binding_mismatch', 'Observed Job does not match the submitted Compatibility Job')
  }
  return assertCompatCharacterJob(job)
}

function wait(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function pollCompatCharacterJob(initialJob, {
  signal,
  fetchImpl = globalThis.fetch,
  intervalMs = COMPAT_CHARACTER_POLL_INTERVAL_MS,
  pollLimit = COMPAT_CHARACTER_POLL_LIMIT,
  onUpdate = () => {},
} = {}) {
  let current = assertCompatCharacterJob(initialJob)
  onUpdate(current)
  for (let index = 0; !COMPAT_TERMINAL_STATUSES.has(current.status) && index < pollLimit; index += 1) {
    await wait(intervalMs, signal)
    current = await fetchCompatCharacterJob(current.id, { signal, fetchImpl })
    onUpdate(current)
  }
  if (!COMPAT_TERMINAL_STATUSES.has(current.status)) {
    throw compatError('poll_interrupted', 'Compatibility Job observation reached its fixed limit', { payload: current })
  }
  return assertCompatCharacterJob(current, { terminal: true })
}

function assertProviderBudget(job, expectedCandidateCount, { requireUsed = false } = {}) {
  const budget = job?.provider_call_budget
  if (!isRecord(budget)) throw compatError('provider_budget_missing', 'Job Provider budget is missing')
  const planned = Number(budget.planned_provider_calls)
  const max = Number(budget.max_provider_calls)
  const used = Number(budget.used_provider_calls)
  if (
    planned !== expectedCandidateCount ||
    max !== expectedCandidateCount ||
    !Number.isInteger(used) ||
    used < 0 ||
    used > max ||
    (requireUsed && used < 1)
  ) {
    throw compatError('provider_budget_binding_mismatch', 'Job Provider budget does not match the current candidate limit')
  }
  return budget
}

function assertCandidateSelection(job, expectedCandidateCount, { requireRelease = false } = {}) {
  const selection = job?.candidate_selection
  if (!isRecord(selection) || Number(selection.candidate_count) !== expectedCandidateCount) {
    throw compatError('candidate_binding_mismatch', 'Candidate selection does not match the current candidate limit')
  }
  if (requireRelease) {
    if (
      selection.release_ready !== true ||
      selection.artifact_disposition !== 'release' ||
      !Number.isInteger(Number(selection.release_selected_index)) ||
      Number(selection.release_selected_index) < 1 ||
      Number(selection.release_selected_index) > expectedCandidateCount
    ) {
      throw compatError('release_gate_blocked', 'Candidate selection is not ready for verified download', { payload: selection })
    }
  }
  return selection
}

function assertReleaseGate(gate, expectedMode) {
  if (
    !isRecord(gate) ||
    gate.schema_version !== 1 ||
    gate.mode !== 'generation_release_gate_v1' ||
    gate.generation_mode !== expectedMode ||
    gate.policy !== RELEASE_POLICIES[expectedMode] ||
    gate.status !== 'pass' ||
    gate.release_ready !== true ||
    !Array.isArray(gate.blocking_errors) ||
    gate.blocking_errors.length !== 0 ||
    !Array.isArray(gate.warnings) ||
    !isRecord(gate.evidence)
  ) {
    throw compatError('release_gate_blocked', 'Generation gate does not permit verified downloads', { payload: gate })
  }
  return gate
}

function assertGenerationInputBinding(generation, settings, { referenceFile = null, paletteFile = null } = {}) {
  const reference = fileBinding(validateCompatCharacterImageFile(referenceFile))
  const palette = fileBinding(validateCompatCharacterImageFile(paletteFile))
  const expectedTemplate = settings.t2iMode === 'production_sheet_v0'
  const expectedTemplateFile = expectedTemplate
    ? templateFileForSourceLayout(settings.generationLayout)
    : null
  const inputImages = generation?.input_images
  if (
    !isRecord(inputImages) ||
    Object.keys(inputImages).sort().join(',') !== 'palette,reference,template' ||
    inputImages.template !== expectedTemplate ||
    inputImages.reference !== Boolean(reference) ||
    inputImages.palette !== Boolean(palette) ||
    generation.template_file !== expectedTemplateFile ||
    generation.reference_file !== (reference?.name ?? null) ||
    generation.palette_file !== (palette?.name ?? null)
  ) {
    throw compatError('generation_input_binding_mismatch', 'Generation image evidence does not match the current compatible input')
  }
}

function assertGenerationBinding(generation, settings, files = {}) {
  const expectedAspectRatio = settings.t2iMode === 'quality_character_v0' && settings.characterPreset === 'two_to_one_character_v0'
    ? '2:1'
    : '1:1'
  const promptContract = generation?.prompt_contract
  const promptMatches = settings.t2iMode === 'quality_character_v0'
    ? promptContract?.mode === settings.t2iMode &&
      promptContract?.preset === settings.characterPreset &&
      promptContract?.background_mode === settings.backgroundMode &&
      isRecord(promptContract?.prompt_fields) &&
      Object.keys(promptContract.prompt_fields).length === 0
    : promptContract?.t2i_mode === settings.t2iMode &&
      promptContract?.preset === settings.generationLayout &&
      promptContract?.layout_id === settings.generationLayout &&
      promptContract?.character_preset?.id === settings.characterPreset &&
      promptContract?.background_mode === settings.backgroundMode &&
      promptContract?.subject === settings.description &&
      isRecord(promptContract?.prompt_fields) &&
      Object.keys(promptContract.prompt_fields).length === 0
  if (
    !isRecord(generation) ||
    generation.mode !== settings.t2iMode ||
    generation.generation_profile_id != null ||
    generation.image_config?.image_size !== settings.imageSize ||
    generation.image_config?.aspect_ratio !== expectedAspectRatio ||
    Number(generation.generation_options?.candidateCount) !== settings.candidateCount ||
    (settings.seed == null
      ? generation.generation_options?.seed != null
      : Number(generation.generation_options?.seed) !== settings.seed) ||
    Number(generation.candidate_selection?.candidate_count) !== settings.candidateCount ||
    !promptMatches
  ) {
    throw compatError('generation_binding_mismatch', 'Generation evidence does not match the current compatible input')
  }
  assertGenerationInputBinding(generation, settings, files)
  return generation
}

async function fetchBoundJson(job, field, fileName, options) {
  const url = assertJobUrl(job, field, fileName, { required: true })
  return requestStudioCharacterJson(url, { signal: options.signal }, options.fetchImpl)
}

async function fetchBoundText(job, field, fileName, options) {
  const url = assertJobUrl(job, field, fileName, { required: true })
  return requestStudioCharacterText(url, { signal: options.signal }, options.fetchImpl)
}

function assertProductionMetadata(metadata, settings, animations) {
  if (
    !isRecord(metadata) ||
    metadata.name !== settings.name ||
    metadata.description !== settings.description ||
    metadata.profile !== animations?.profile
  ) {
    throw compatError('metadata_binding_mismatch', 'Production metadata does not match the current compatible input')
  }
  return metadata
}

function assertQualityReport(report, expectedCandidateCount) {
  if (
    !isRecord(report) ||
    report.mode !== 'quality_character_v0' ||
    report.status !== 'done' ||
    report.release_ready !== true ||
    report.artifact_disposition !== 'release' ||
    Number(report.candidate_selection?.candidate_count) !== expectedCandidateCount ||
    report.candidate_selection?.release_ready !== true
  ) {
    throw compatError('invalid_quality_report', 'Quality Character report is not ready for verified download', { payload: report })
  }
  return report
}

function assertMultiResolutionUrls(job, expectedFrameSizes) {
  const entries = job?.multi_resolution_sheet_urls
  if (entries == null) {
    if (expectedFrameSizes.length) {
      throw compatError('release_url_binding_mismatch', 'Expected multi-resolution download URLs are missing')
    }
    return Object.freeze([])
  }
  if (!Array.isArray(entries)) {
    throw compatError('release_url_binding_mismatch', 'Multi-resolution download URLs are malformed')
  }
  const seen = new Set()
  for (const entry of entries) {
    const frameSize = Number(entry?.frame_size)
    if (!Number.isSafeInteger(frameSize) || frameSize <= 0 || seen.has(frameSize)) {
      throw compatError('release_url_binding_mismatch', 'Multi-resolution frame sizes are malformed')
    }
    seen.add(frameSize)
    try {
      assertRelativeGeneratedUrl(entry.url, {
        jobId: safeJobId(job.id),
        fileName: `normalized_sheet_${frameSize}.png`,
      })
    } catch (error) {
      throw compatError('release_url_binding_mismatch', 'A multi-resolution artifact is not bound to the current Job', { cause: error })
    }
  }
  const expected = [...expectedFrameSizes].sort((left, right) => left - right)
  const actual = [...seen].sort((left, right) => left - right)
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw compatError('release_url_binding_mismatch', 'Multi-resolution artifacts do not match the selected export scales')
  }
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })))
}

export async function verifyCompatCharacterRelease(job, {
  settings,
  referenceFile = null,
  paletteFile = null,
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalized = normalizeCompatCharacterSettings(settings)
  const terminal = assertCompatCharacterJob(job, { terminal: true })
  if (
    terminal.status !== 'done' ||
    terminal.release_ready !== true ||
    terminal.artifact_disposition !== 'release'
  ) {
    throw compatError('release_gate_blocked', 'Compatibility Job is diagnostic-only or not ready for verified download', { payload: terminal })
  }
  const budget = assertProviderBudget(terminal, normalized.candidateCount, { requireUsed: true })
  const selection = assertCandidateSelection(terminal, normalized.candidateCount, { requireRelease: true })
  const commonOptions = { signal, fetchImpl }
  const generationFile = 'generation.json'
  const gateFile = 'generation_release_gate.json'
  const [generation, gate, report, animations, metadata, promptText] = normalized.t2iMode === 'quality_character_v0'
    ? await Promise.all([
        fetchBoundJson(terminal, 'generation_url', generationFile, commonOptions),
        fetchBoundJson(terminal, 'generation_release_gate_url', gateFile, commonOptions),
        fetchBoundJson(terminal, 'result_url', 't2i_report.json', commonOptions),
        Promise.resolve(null),
        Promise.resolve(null),
        fetchBoundText(terminal, 'prompt_url', 'prompt.txt', commonOptions),
      ])
    : await Promise.all([
        fetchBoundJson(terminal, 'generation_url', generationFile, commonOptions),
        fetchBoundJson(terminal, 'generation_release_gate_url', gateFile, commonOptions),
        fetchBoundJson(terminal, 'debug_report_url', 'debug_report.json', commonOptions),
        fetchBoundJson(terminal, 'animations_url', 'animations.json', commonOptions),
        fetchBoundJson(terminal, 'metadata_url', 'metadata.json', commonOptions),
        Promise.resolve(null),
      ])
  assertJobUrl(terminal, 'source_url', 'source.png', { required: true })
  const zipFile = normalized.t2iMode === 'quality_character_v0' ? 't2i_pack.zip' : 'character_pack.zip'
  assertJobUrl(terminal, 'zip_url', zipFile, { required: true })
  if (normalized.t2iMode === 'quality_character_v0') {
    assertJobUrl(terminal, 't2i_result_url', 't2i_result.png', { required: true })
    assertQualityReport(report, normalized.candidateCount)
    const expectedPrompt = buildQualityCharacterPrompt({
      description: normalized.description,
      characterPreset: normalized.characterPreset,
      backgroundMode: normalized.backgroundMode,
    })
    if (promptText !== expectedPrompt) {
      throw compatError('generation_prompt_binding_mismatch', 'Quality Character prompt text does not match the current compatible input')
    }
  } else {
    assertJobUrl(terminal, 'normalized_sheet_url', 'normalized_sheet.png', { required: true })
    assertJobUrl(terminal, 'metadata_url', 'metadata.json', { required: true })
    assertLocalCharacterDebugReport(report, { requireRelease: true })
    assertLocalCharacterAnimations(animations, { expectedSourceLayout: normalized.generationLayout })
    assertProductionMetadata(metadata, normalized, animations)
  }
  const expectedFrameSizes = normalized.t2iMode === 'production_sheet_v0'
    ? selectedExportScales(normalized).map((scale) => COMPAT_CHARACTER_TARGET_FRAME_SIZE * scale)
    : []
  const multiResolutionSheetUrls = assertMultiResolutionUrls(terminal, expectedFrameSizes)
  return Object.freeze({
    job: terminal,
    settings: normalized,
    budget,
    selection,
    generation: assertGenerationBinding(generation, normalized, { referenceFile, paletteFile }),
    releaseGate: assertReleaseGate(gate, normalized.t2iMode),
    report,
    animations,
    metadata,
    multiResolutionSheetUrls,
  })
}

function diagnosticFileFor(job, field, settings) {
  if (!job?.[field]) return null
  if (field === 'generation_release_gate_url') return 'generation_release_gate.json'
  if (field === 'generation_url') return 'generation.json'
  if (field === 'debug_report_url') return 'debug_report.json'
  if (field === 'result_url') {
    return settings.t2iMode === 'quality_character_v0'
      ? 't2i_report.json'
      : job.result_url === job.generation_release_gate_url ? 'generation_release_gate.json' : 'metadata.json'
  }
  return null
}

export async function fetchCompatCharacterDiagnostics(job, {
  settings,
  referenceFile = null,
  paletteFile = null,
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalized = normalizeCompatCharacterSettings(settings)
  const terminal = assertCompatCharacterJob(job, { terminal: true })
  const fields = ['generation_release_gate_url', 'generation_url', 'debug_report_url', 'result_url']
  const diagnostics = {}
  for (const field of fields) {
    const fileName = diagnosticFileFor(terminal, field, normalized)
    if (!fileName || (field === 'result_url' && terminal[field] === terminal.generation_release_gate_url)) continue
    diagnostics[field] = await fetchBoundJson(terminal, field, fileName, { signal, fetchImpl })
  }
  if (terminal.provider_call_budget) assertProviderBudget(terminal, normalized.candidateCount)
  if (terminal.candidate_selection) assertCandidateSelection(terminal, normalized.candidateCount)
  if (diagnostics.generation_url) {
    assertGenerationBinding(diagnostics.generation_url, normalized, { referenceFile, paletteFile })
  }
  return Object.freeze({ job: terminal, diagnostics: Object.freeze(diagnostics) })
}

export function isRecoverableCompatObservationError(error) {
  if (['request_failed', 'request_timeout', 'poll_interrupted', 'fetch_unavailable'].includes(error?.code)) return true
  return error?.code === 'http_error' && Number(error?.status) >= 500
}
