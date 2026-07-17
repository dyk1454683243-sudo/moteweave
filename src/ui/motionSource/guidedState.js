import { TOPDOWN_RPG_V0 } from '../../character-pack/profile.js'

export const MOTION_SELECTION_RECIPE_IDS = Object.freeze({
  V1: 'motion_selection_v1_compat',
  V2: 'motion_selection_recipe_v2',
})

export const MOTION_LOOP_EXPECTATIONS = Object.freeze([
  'auto',
  'loop',
  'once',
])

export const MOTION_TEMPORAL_MATTE_MODES = Object.freeze([
  'disabled',
  'evidence_only',
])

export const MOTION_PIXEL_GRID_RECIPES = Object.freeze([
  'pixel_grid_v2_balanced',
  'pixel_grid_v2_detail_safe',
  'pixel_grid_v2_oklab',
])

const LOOP_EXPECTATIONS = new Set(MOTION_LOOP_EXPECTATIONS)
const TEMPORAL_MATTE_MODES = new Set(MOTION_TEMPORAL_MATTE_MODES)
const PIXEL_GRID_RECIPES = new Set(MOTION_PIXEL_GRID_RECIPES)
const RESAMPLE_STRATEGIES = new Set(['reject_mismatch', 'nearest_keyframes'])

function guidedStateError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details })
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function readAlias(source, keys, label) {
  const present = keys.filter((key) => hasOwn(source, key))
  if (!present.length) return undefined
  const first = source[present[0]]
  for (const key of present.slice(1)) {
    if (!equalJson(first, source[key])) {
      throw guidedStateError(
        'conflicting_motion_ui_option',
        `Conflicting Motion UI aliases for ${label}`,
        { option: label }
      )
    }
  }
  return first
}

function finiteNumber(value, label, {
  fallback,
  min = -Infinity,
  integer = false,
  nullable = false,
} = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null
  const candidate = value === undefined ? fallback : value
  const number = Number(candidate)
  if (
    !Number.isFinite(number) ||
    number < min ||
    (integer && !Number.isInteger(number))
  ) {
    throw guidedStateError(
      'invalid_motion_ui_number',
      `Invalid Motion UI number: ${label}`,
      { option: label, value }
    )
  }
  return Object.is(number, -0) ? 0 : number
}

function nonEmptyString(value, label, fallback) {
  const candidate = value === undefined ? fallback : value
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw guidedStateError(
      'invalid_motion_ui_string',
      `Invalid Motion UI string: ${label}`,
      { option: label, value }
    )
  }
  return candidate.trim()
}

function booleanValue(value, label, fallback) {
  const candidate = value === undefined ? fallback : value
  if (typeof candidate !== 'boolean') {
    throw guidedStateError(
      'invalid_motion_ui_boolean',
      `Invalid Motion UI boolean: ${label}`,
      { option: label, value }
    )
  }
  return candidate
}

function canonicalFingerprint(kind, value) {
  return `${kind}:${JSON.stringify(value)}`
}

function cloneJsonValue(value) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value
  }
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (!isPlainObject(value)) {
    throw guidedStateError(
      'invalid_motion_preview_provenance',
      'Preview provenance must contain JSON-compatible values'
    )
  }
  const clone = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue
    clone[key] = cloneJsonValue(item)
  }
  return clone
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const item of Object.values(value)) deepFreeze(item)
  return Object.freeze(value)
}

function normalizeOptionalMilliseconds(value, label) {
  if (value === null || value === undefined || value === '') return null
  return finiteNumber(value, label, { min: 0 })
}

function normalizeNonNegativeInteger(value, label) {
  return finiteNumber(value, label, { min: 0, integer: true })
}

function normalizeWarnings(...values) {
  return [...new Set(values.flatMap((value) => (
    Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
  )))].sort()
}

function normalizeErrors(...values) {
  return [...new Set(values.flatMap((value) => (
    Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
  )))].sort()
}

function finiteEvidenceNumber(value) {
  if (value === null || value === undefined || value === '') return null
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function stringEvidence(value) {
  return typeof value === 'string' && value ? value : null
}

function booleanEvidence(value) {
  return typeof value === 'boolean' ? value : null
}

export function serializeMotionSelectionOptions(value = false) {
  if (value === undefined || value === null || value === false) {
    return {
      recipe: MOTION_SELECTION_RECIPE_IDS.V1,
      loop_expectation: 'auto',
      temporal_matte: 'disabled',
    }
  }
  if (!isPlainObject(value)) {
    throw guidedStateError(
      'invalid_motion_selection_options',
      'Motion Selection UI options must be an object, null, or false'
    )
  }
  const allowedKeys = new Set([
    'recipe',
    'loop_expectation',
    'loopExpectation',
    'temporal_matte',
    'temporalMatte',
  ])
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw guidedStateError(
        'unknown_motion_selection_option',
        `Unknown Motion Selection UI option: ${key}`,
        { option: key }
      )
    }
  }
  const recipe = value.recipe
  if (![MOTION_SELECTION_RECIPE_IDS.V1, MOTION_SELECTION_RECIPE_IDS.V2].includes(recipe)) {
    throw guidedStateError(
      'invalid_motion_selection_recipe',
      `Unsupported Motion Selection recipe: ${String(recipe)}`,
      { recipe }
    )
  }
  const loopExpectation =
    readAlias(value, ['loop_expectation', 'loopExpectation'], 'loop_expectation') ??
    'auto'
  const temporalMatte =
    readAlias(value, ['temporal_matte', 'temporalMatte'], 'temporal_matte') ??
    'disabled'
  if (!LOOP_EXPECTATIONS.has(loopExpectation)) {
    throw guidedStateError(
      'invalid_motion_loop_expectation',
      `Unsupported loop expectation: ${String(loopExpectation)}`,
      { value: loopExpectation }
    )
  }
  if (!TEMPORAL_MATTE_MODES.has(temporalMatte)) {
    throw guidedStateError(
      'invalid_motion_temporal_matte',
      `Unsupported temporal matte mode: ${String(temporalMatte)}`,
      { value: temporalMatte }
    )
  }
  if (
    recipe === MOTION_SELECTION_RECIPE_IDS.V1 &&
    (loopExpectation !== 'auto' || temporalMatte !== 'disabled')
  ) {
    throw guidedStateError(
      'motion_selection_v1_dependency_violation',
      'Motion Selection v1 requires loop Auto and temporal matte Disabled',
      {
        recipe,
        loop_expectation: loopExpectation,
        temporal_matte: temporalMatte,
      }
    )
  }
  return {
    recipe,
    loop_expectation: loopExpectation,
    temporal_matte: temporalMatte,
  }
}

function canonicalSampling(options = {}) {
  if (!isPlainObject(options)) {
    throw guidedStateError(
      'invalid_motion_sampling_options',
      'Motion sampling options must be an object'
    )
  }
  const sampling = isPlainObject(options.sampling) ? options.sampling : {}
  const stride = readAlias(options, ['stride'], 'stride') ?? sampling.stride
  const fps = readAlias(options, ['fps'], 'fps') ?? sampling.fps
  const maxFrames =
    readAlias(options, ['maxFrames', 'max_frames'], 'max_frames') ??
    readAlias(sampling, ['maxFrames', 'max_frames'], 'sampling.max_frames')
  const startSec =
    readAlias(options, ['startSec', 'start_sec'], 'start_sec') ??
    readAlias(sampling, ['startSec', 'start_sec'], 'sampling.start_sec')
  const endSec =
    readAlias(options, ['endSec', 'end_sec'], 'end_sec') ??
    readAlias(sampling, ['endSec', 'end_sec'], 'sampling.end_sec')
  const normalized = {
    stride: finiteNumber(stride, 'stride', { fallback: 1, min: 1, integer: true }),
    fps: finiteNumber(fps, 'fps', { fallback: 12, min: 1 }),
    max_frames: finiteNumber(maxFrames, 'max_frames', {
      fallback: 64,
      min: 1,
      integer: true,
    }),
    start_sec: finiteNumber(startSec, 'start_sec', { fallback: 0, min: 0 }),
    end_sec: finiteNumber(endSec, 'end_sec', { nullable: true, min: 0 }),
  }
  if (normalized.end_sec !== null && normalized.end_sec < normalized.start_sec) {
    throw guidedStateError(
      'invalid_motion_sampling_range',
      'Motion sampling end must not precede its start',
      { start_sec: normalized.start_sec, end_sec: normalized.end_sec }
    )
  }
  return normalized
}

export function motionCandidateFingerprint(options = {}) {
  return canonicalFingerprint('motion_candidate_v1', canonicalSampling(options))
}

function normalizeManualIndexes(value, selectionMode) {
  if (value === undefined || value === null || (Array.isArray(value) && !value.length)) {
    if (selectionMode === 'manual') {
      throw guidedStateError(
        'manual_selection_requires_frame_indexes',
        'Manual Motion selection requires frame indexes'
      )
    }
    return null
  }
  if (!Array.isArray(value)) {
    throw guidedStateError(
      'invalid_selected_frame_indexes',
      'Motion selected frame indexes must be an array'
    )
  }
  const seen = new Set()
  const indexes = value.map((item, position) => {
    const index = normalizeNonNegativeInteger(item, `selected_frame_indexes[${position}]`)
    if (seen.has(index)) {
      throw guidedStateError(
        'duplicate_selected_frame_index',
        `Duplicate selected frame index: ${index}`,
        { index }
      )
    }
    seen.add(index)
    return index
  })
  if (selectionMode === 'auto') {
    throw guidedStateError(
      'auto_selection_conflicts_with_frame_indexes',
      'Auto Motion selection cannot include manual frame indexes'
    )
  }
  return indexes
}

function canonicalBackground(options = {}) {
  const background = isPlainObject(options.background) ? options.background : {}
  const method =
    readAlias(background, ['method', 'background_method'], 'background.method') ??
    readAlias(options, ['backgroundMethod', 'background_method'], 'background_method') ??
    'key_color'
  if (!['key_color', 'external_rembg'].includes(method)) {
    throw guidedStateError(
      'invalid_motion_background_method',
      `Unsupported Motion background method: ${String(method)}`,
      { value: method }
    )
  }
  const keyColor =
    readAlias(background, ['key_color', 'keyColor'], 'background.key_color') ??
    readAlias(options, ['key_color', 'keyColor'], 'key_color') ??
    [255, 255, 255]
  if (
    !Array.isArray(keyColor) ||
    keyColor.length !== 3 ||
    !keyColor.every((channel) => (
      Number.isInteger(channel) && channel >= 0 && channel <= 255
    ))
  ) {
    throw guidedStateError(
      'invalid_motion_background_key_color',
      'Motion background key color must contain three byte channels'
    )
  }
  const tolerance =
    readAlias(background, ['tolerance'], 'background.tolerance') ??
    readAlias(options, ['backgroundTolerance', 'background_tolerance'], 'background_tolerance')
  const defringe =
    readAlias(background, ['defringe'], 'background.defringe') ??
    readAlias(options, ['defringe'], 'defringe')
  return {
    method,
    key_color: keyColor.slice(),
    tolerance: finiteNumber(tolerance, 'background.tolerance', {
      fallback: 24,
      min: 0,
    }),
    defringe: booleanValue(defringe, 'background.defringe', true),
  }
}

function canonicalStaticOffset(options = {}) {
  const anchor = isPlainObject(options.anchor_policy)
    ? options.anchor_policy
    : isPlainObject(options.anchorPolicy)
      ? options.anchorPolicy
      : {}
  const value =
    readAlias(anchor, ['static_offset_y', 'staticOffsetY'], 'anchor.static_offset_y') ??
    readAlias(options, ['static_offset_y', 'staticOffsetY'], 'static_offset_y')
  return finiteNumber(value, 'static_offset_y', { fallback: 0 })
}

function canonicalPixelGrid(options = {}) {
  const value =
    readAlias(
      options,
      ['pixel_grid_refinement', 'pixelGridRefinement'],
      'pixel_grid_refinement'
    )
  if (value === undefined || value === null || value === false || value === 'disabled') {
    return { recipe: null }
  }
  const source = typeof value === 'string' ? { recipe: value } : value
  if (!isPlainObject(source)) {
    throw guidedStateError(
      'invalid_pixel_grid_options',
      'Motion Pixel Grid options must be a recipe object or Disabled'
    )
  }
  const keys = Object.keys(source)
  if (keys.some((key) => key !== 'recipe')) {
    const unknown = keys.find((key) => key !== 'recipe')
    throw guidedStateError(
      'unknown_pixel_grid_option',
      `Unknown Motion Pixel Grid UI option: ${unknown}`,
      { option: unknown }
    )
  }
  if (!PIXEL_GRID_RECIPES.has(source.recipe)) {
    throw guidedStateError(
      'invalid_pixel_grid_recipe',
      `Unsupported Motion Pixel Grid recipe: ${String(source.recipe)}`,
      { recipe: source.recipe }
    )
  }
  return { recipe: source.recipe }
}

export function motionBuildFingerprint(options = {}) {
  if (!isPlainObject(options)) {
    throw guidedStateError(
      'invalid_motion_build_options',
      'Motion Build options must be an object'
    )
  }
  const manualIndexesValue = readAlias(
    options,
    ['selected_frame_indexes', 'selectedFrameIndexes'],
    'selected_frame_indexes'
  )
  const explicitSelectionMode = readAlias(
    options,
    ['selection_mode', 'selectionMode'],
    'selection_mode'
  )
  const selectionMode = explicitSelectionMode ??
    (
      Array.isArray(manualIndexesValue) && manualIndexesValue.length
        ? 'manual'
        : 'auto'
    )
  if (!['auto', 'manual'].includes(selectionMode)) {
    throw guidedStateError(
      'invalid_motion_selection_mode',
      `Unsupported Motion selection mode: ${String(selectionMode)}`,
      { value: selectionMode }
    )
  }
  const manualIndexes = normalizeManualIndexes(manualIndexesValue, selectionMode)
  const motionSelectionValue = readAlias(
    options,
    ['motion_selection', 'motionSelection'],
    'motion_selection'
  )
  const action = nonEmptyString(
    readAlias(options, ['action', 'runtime_action', 'runtimeAction'], 'action'),
    'action',
    'walk_down'
  )
  const targetFrameCount = finiteNumber(
    readAlias(
      options,
      ['frames', 'target_frame_count', 'targetFrameCount'],
      'target_frame_count'
    ),
    'target_frame_count',
    { fallback: 8, min: 1, integer: true }
  )
  const canonical = {
    action,
    target_frame_count: targetFrameCount,
    selection: {
      mode: selectionMode,
      manual_indexes: selectionMode === 'manual' ? manualIndexes : null,
      motion_selection: serializeMotionSelectionOptions(motionSelectionValue),
    },
    sampling: canonicalSampling(options),
    background: canonicalBackground(options),
    static_offset_y: canonicalStaticOffset(options),
    pixel_grid: canonicalPixelGrid(options),
  }
  return canonicalFingerprint('motion_build_v1', canonical)
}

export function preservePreviewCandidates(preview) {
  const frames = Array.isArray(preview) ? preview : preview?.frames
  if (!Array.isArray(frames)) {
    throw guidedStateError(
      'invalid_motion_preview_candidates',
      'Motion Preview candidates must be an array'
    )
  }
  const seen = new Set()
  const candidates = frames.map((frame, index) => {
    if (!isPlainObject(frame)) {
      throw guidedStateError(
        'invalid_motion_preview_candidate',
        `Invalid Motion Preview candidate: ${index}`
      )
    }
    const candidateIndex = normalizeNonNegativeInteger(
      frame.candidate_index ?? frame.source_index,
      `candidate_index:${index}`
    )
    if (seen.has(candidateIndex)) {
      throw guidedStateError(
        'duplicate_motion_preview_candidate',
        `Duplicate Motion Preview candidate: ${candidateIndex}`
      )
    }
    seen.add(candidateIndex)
    const sourceIndex = normalizeNonNegativeInteger(
      frame.source_index ?? candidateIndex,
      `source_index:${index}`
    )
    const rawIndex = normalizeNonNegativeInteger(frame.raw_index, `raw_index:${index}`)
    const previewFile = nonEmptyString(
      frame.preview_file,
      `preview_file:${index}`
    )
    return {
      candidate_index: candidateIndex,
      source_index: sourceIndex,
      raw_index: rawIndex,
      timestamp_ms: normalizeOptionalMilliseconds(
        frame.timestamp_ms,
        `timestamp_ms:${index}`
      ),
      duration_ms: normalizeOptionalMilliseconds(
        frame.duration_ms,
        `duration_ms:${index}`
      ),
      timing_source: typeof frame.timing_source === 'string'
        ? frame.timing_source
        : null,
      source_entry: typeof frame.source_entry === 'string' && frame.source_entry
        ? frame.source_entry
        : null,
      provenance: frame.provenance === undefined
        ? null
        : cloneJsonValue(frame.provenance),
      preview_file: previewFile,
    }
  })
  candidates.sort((left, right) => left.candidate_index - right.candidate_index)
  return deepFreeze(candidates)
}

export function restoreAutoFrameSelection(previewCandidates) {
  if (!Array.isArray(previewCandidates)) {
    throw guidedStateError(
      'invalid_motion_preview_candidates',
      'Preserved Motion Preview candidates are required'
    )
  }
  return [...previewCandidates]
    .sort((left, right) => left.candidate_index - right.candidate_index)
    .map((candidate) => ({
      ...cloneJsonValue(candidate),
      selected: false,
    }))
}

function bindingEpoch(value) {
  const epoch = value?.source_epoch ?? value?.sourceEpoch
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null
}

function bindingIdentity(value) {
  const identity = value?.source_identity ?? value?.sourceIdentity
  return typeof identity === 'string' && identity ? identity : null
}

function previewFingerprint(value) {
  const existing =
    value?.sampling_fingerprint ??
    value?.candidate_fingerprint ??
    value?.candidateFingerprint
  if (typeof existing === 'string' && existing) return existing
  const options = value?.samplingOptions ?? value?.sampling_options ?? value?.options
  if (!options && value?.sourceEpoch !== undefined) return null
  try {
    return motionCandidateFingerprint(options ?? value)
  } catch {
    return null
  }
}

function buildFingerprint(value) {
  const existing =
    value?.build_fingerprint ??
    value?.client_options_fingerprint ??
    value?.buildFingerprint
  if (typeof existing === 'string' && existing) return existing
  const options = value?.buildOptions ?? value?.build_options ?? value?.options
  if (!options && value?.sourceEpoch !== undefined) return null
  try {
    return motionBuildFingerprint(options ?? value)
  } catch {
    return null
  }
}

export function isMotionPreviewBindingCurrent(binding, current) {
  const storedFingerprint = previewFingerprint(binding)
  const currentFingerprint = previewFingerprint(current)
  return bindingEpoch(binding) !== null &&
    bindingEpoch(binding) === bindingEpoch(current) &&
    bindingIdentity(binding) !== null &&
    bindingIdentity(binding) === bindingIdentity(current) &&
    storedFingerprint !== null &&
    storedFingerprint === currentFingerprint
}

export function isMotionBuildBindingCurrent(binding, current) {
  const storedFingerprint = buildFingerprint(binding)
  const currentFingerprint = buildFingerprint(current)
  return bindingEpoch(binding) !== null &&
    bindingEpoch(binding) === bindingEpoch(current) &&
    bindingIdentity(binding) !== null &&
    bindingIdentity(binding) === bindingIdentity(current) &&
    storedFingerprint !== null &&
    storedFingerprint === currentFingerprint
}

function profileAction(profile, action) {
  return profile?.animations?.find((item) => item.name === action) ?? null
}

export function motionApplyCompatibility({
  action,
  resampleStrategy = 'reject_mismatch',
  editedStripOverride = false,
  hasLatestBuild = false,
  latestBuildCurrent = false,
  latestBuildEvidenceStatus = 'complete',
  stripFrameCount = null,
  profile = TOPDOWN_RPG_V0,
} = {}) {
  const animation = profileAction(profile, action)
  const authority = editedStripOverride ? 'edited_override' : 'latest_build'
  const base = {
    authority,
    action: typeof action === 'string' ? action : null,
    resample_strategy: resampleStrategy,
    source_strip_frame_count: Number.isInteger(stripFrameCount)
      ? stripFrameCount
      : null,
    target_frame_count: animation?.count ?? null,
    resampling_required: false,
    server_validation_required: false,
  }
  if (!animation) {
    return {
      ...base,
      status: 'blocked',
      allowed: false,
      reason: 'unknown_runtime_action',
    }
  }
  if (!RESAMPLE_STRATEGIES.has(resampleStrategy)) {
    return {
      ...base,
      status: 'blocked',
      allowed: false,
      reason: 'unsupported_resample_strategy',
    }
  }
  if (!editedStripOverride && !hasLatestBuild) {
    return {
      ...base,
      status: 'blocked',
      allowed: false,
      reason: 'latest_build_missing',
    }
  }
  if (!editedStripOverride && !latestBuildCurrent) {
    return {
      ...base,
      status: 'blocked',
      allowed: false,
      reason: 'latest_build_stale',
    }
  }
  if (
    !editedStripOverride &&
    !['complete', 'needs_review'].includes(latestBuildEvidenceStatus)
  ) {
    return {
      ...base,
      status: 'blocked',
      allowed: false,
      reason: 'latest_build_evidence_blocked',
    }
  }
  if (
    stripFrameCount !== null &&
    (!Number.isInteger(stripFrameCount) || stripFrameCount <= 0)
  ) {
    return {
      ...base,
      status: 'blocked',
      allowed: false,
      reason: 'invalid_source_strip_frame_count',
    }
  }
  if (resampleStrategy === 'nearest_keyframes') {
    return {
      ...base,
      status: 'ready',
      allowed: true,
      reason: null,
      resampling_required:
        Number.isInteger(stripFrameCount) && stripFrameCount !== animation.count,
      server_validation_required: stripFrameCount === null,
    }
  }
  if (stripFrameCount === null) {
    if (editedStripOverride) {
      return {
        ...base,
        status: 'needs_review',
        allowed: true,
        reason: 'edited_strip_frame_count_unavailable',
        server_validation_required: true,
      }
    }
    return {
      ...base,
      status: 'blocked',
      allowed: false,
      reason: 'latest_build_frame_count_unavailable',
    }
  }
  if (stripFrameCount !== animation.count) {
    return {
      ...base,
      status: 'blocked',
      allowed: false,
      reason: 'target_frame_count_mismatch',
    }
  }
  return {
    ...base,
    status: 'ready',
    allowed: true,
    reason: null,
  }
}

function automaticStageEvidence(selection, authority) {
  if (authority === 'manual') {
    return {
      status: 'not_run',
      reason: 'manual_authority',
      registration: 'not_run',
      clustering: 'not_run',
      periodicity: 'not_run',
      phase_selection: 'not_run',
      temporal_matte: 'not_run',
    }
  }
  return {
    status: selection ? 'reported' : 'not_run',
    reason: null,
    registration: stringEvidence(selection?.registration?.status),
    clustering: stringEvidence(selection?.clusters?.status),
    periodicity: stringEvidence(selection?.periodicity?.status),
    phase_selection: stringEvidence(selection?.phase_selection?.status),
    temporal_matte: stringEvidence(selection?.temporal_matte?.status),
  }
}

function mapSourceEvidence(report) {
  const sourceKind = stringEvidence(report?.contract?.source_kind ?? report?.source_kind)
  const inputFrameCount = finiteEvidenceNumber(report?.input_frame_count)
  const warnings = normalizeWarnings(report?.source_warnings)
  return {
    status: sourceKind || inputFrameCount !== null ? (warnings.length ? 'needs_review' : 'complete') : 'not_run',
    source_kind: sourceKind,
    input_frame_count: inputFrameCount,
    selected_frame_count: finiteEvidenceNumber(report?.selected_frame_count),
    source_identity: stringEvidence(report?.source_identity),
    warnings,
  }
}

function mapSelectionEvidence(report) {
  const selection = report?.frame_selection
  if (!selection) {
    return {
      status: 'not_run',
      authority: stringEvidence(report?.effective_selection_mode),
      recipe: null,
      selected_frame_count: finiteEvidenceNumber(report?.selected_frame_count),
      target_frame_count: null,
      target_satisfied: null,
      shortfall_count: null,
      automatic_stages: automaticStageEvidence(null, report?.effective_selection_mode),
      warnings: [],
    }
  }
  const authority =
    stringEvidence(report?.effective_selection_mode) ??
    stringEvidence(selection.effective_selection_mode) ??
    stringEvidence(selection.selection_mode)
  const target = selection.target ?? {}
  const warnings = normalizeWarnings(
    selection.warnings,
    selection.temporal_matte?.warnings
  )
  const targetSatisfied = booleanEvidence(target.target_satisfied)
  return {
    status:
      targetSatisfied === false || warnings.length || selection.status === 'insufficient_target'
        ? 'needs_review'
        : 'complete',
    authority,
    recipe:
      stringEvidence(selection.recipe) ??
      stringEvidence(selection.settings?.recipe) ??
      stringEvidence(report?.contract?.motion_selection?.recipe),
    selected_frame_count:
      finiteEvidenceNumber(target.selected_frame_count) ??
      finiteEvidenceNumber(report?.selected_frame_count) ??
      (Array.isArray(selection.selected) ? selection.selected.length : null),
    target_frame_count:
      finiteEvidenceNumber(target.target_frame_count) ??
      finiteEvidenceNumber(selection.target_frame_count) ??
      finiteEvidenceNumber(report?.contract?.target_frame_count),
    target_satisfied: targetSatisfied,
    shortfall_count: finiteEvidenceNumber(target.shortfall_count),
    automatic_stages: automaticStageEvidence(selection, authority),
    warnings,
  }
}

function mapLoopEvidence(report, selectionEvidence) {
  const selection = report?.frame_selection
  if (!selection) {
    return {
      status: 'not_run',
      reason: null,
      expectation: null,
      static_status: null,
      periodicity_status: null,
      selected_period: null,
      phase_mode: null,
      endpoint_similarity: null,
      seamless: null,
      warnings: [],
    }
  }
  if (selectionEvidence.authority === 'manual') {
    return {
      status: 'not_run',
      reason: 'manual_authority',
      expectation:
        stringEvidence(selection.settings?.loop_expectation) ??
        stringEvidence(selection.loop?.expectation),
      static_status: 'not_run',
      periodicity_status: 'not_run',
      selected_period: null,
      phase_mode: 'manual',
      endpoint_similarity: null,
      seamless: null,
      warnings: normalizeWarnings(
        selection.warnings,
        selection.temporal_matte?.warnings
      ),
    }
  }
  const warnings = normalizeWarnings(
    selection.warnings,
    selection.temporal_matte?.warnings
  )
  const periodicityStatus = stringEvidence(
    selection.periodicity?.status ?? selection.loop?.periodicity_status
  )
  const ambiguous = periodicityStatus === 'ambiguous_harmonic'
  return {
    status: ambiguous || warnings.length ? 'needs_review' : 'complete',
    reason: ambiguous ? 'ambiguous_harmonic' : null,
    expectation:
      stringEvidence(selection.settings?.loop_expectation) ??
      stringEvidence(selection.loop?.expectation),
    static_status: stringEvidence(selection.static_gate?.status),
    periodicity_status: periodicityStatus,
    selected_period:
      finiteEvidenceNumber(selection.periodicity?.selected_period) ??
      finiteEvidenceNumber(selection.loop?.detected_period),
    phase_mode:
      stringEvidence(selection.phase_selection?.effective_mode) ??
      stringEvidence(selection.loop?.phase_mode),
    endpoint_similarity: finiteEvidenceNumber(selection.loop?.endpoint_evidence?.similarity),
    seamless: booleanEvidence(selection.loop?.seamless),
    warnings,
  }
}

function mapCleanupEvidence(report) {
  const background = report?.background
  if (!background) {
    return {
      status: 'not_run',
      halo_score_before: null,
      halo_score_after: null,
      external_matting_status: null,
      warnings: [],
    }
  }
  const warnings = normalizeWarnings(report?.source_warnings, background.warnings)
  return {
    status: warnings.length ? 'needs_review' : 'complete',
    halo_score_before: finiteEvidenceNumber(background.halo_score_before),
    halo_score_after: finiteEvidenceNumber(background.halo_score_after),
    external_matting_status: stringEvidence(report?.external_matting?.mode),
    warnings,
  }
}

function gridRecipeId(grid) {
  if (typeof grid?.recipe === 'string') return grid.recipe
  return stringEvidence(grid?.recipe?.id)
}

function mapGridEvidence(report) {
  const grid = report?.pixel_grid_refinement
  if (!grid) {
    return {
      status: 'not_run',
      evidence_status: null,
      source_refinement_status: null,
      applied: null,
      recipe: null,
      cell_size: null,
      confidence: null,
      method: null,
      support_ratio: null,
      phase_agreement: null,
      shared_palette: null,
      shared_grid: null,
      invariants: [],
      rejected_harmonics: [],
      warnings: [],
    }
  }
  const evidenceStatus = stringEvidence(grid.status)
  const warnings = normalizeWarnings(grid.warnings)
  let status
  let applied
  if (evidenceStatus === 'disabled') {
    status = 'disabled'
    applied = false
  } else if (evidenceStatus === 'refined') {
    status = warnings.length ? 'needs_review' : 'complete'
    applied = true
  } else if (evidenceStatus === 'passthrough_normalization_incompatible') {
    status = 'not_applied'
    applied = false
  } else if (evidenceStatus?.startsWith('passthrough_')) {
    status = 'needs_review'
    applied = false
  } else {
    status = evidenceStatus ? 'needs_review' : 'not_run'
    applied = null
  }
  return {
    status,
    evidence_status: evidenceStatus,
    source_refinement_status: stringEvidence(grid.source_refinement_status),
    applied,
    recipe: gridRecipeId(grid),
    cell_size: finiteEvidenceNumber(grid.grid?.cell_size),
    confidence: finiteEvidenceNumber(grid.grid?.confidence),
    method: stringEvidence(grid.grid?.method),
    support_ratio: finiteEvidenceNumber(grid.consensus?.support_ratio),
    phase_agreement: finiteEvidenceNumber(grid.consensus?.phase_agreement),
    shared_palette: booleanEvidence(grid.sequence?.shared_palette),
    shared_grid: booleanEvidence(grid.sequence?.shared_grid),
    invariants: Array.isArray(grid.sequence?.invariants)
      ? grid.sequence.invariants.filter((item) => typeof item === 'string')
      : [],
    rejected_harmonics: Array.isArray(grid.consensus?.rejected_harmonics)
      ? cloneJsonValue(grid.consensus.rejected_harmonics)
      : [],
    warnings,
  }
}

function mapBindingEvidence(report, bindingCurrent) {
  const sourceIdentity = stringEvidence(report?.source_identity)
  const operationId = stringEvidence(report?.operation_id)
  const optionsHash = stringEvidence(report?.options_hash)
  const complete = Boolean(sourceIdentity && operationId && optionsHash)
  return {
    status: bindingCurrent === false
      ? 'stale'
      : complete
        ? 'current'
        : 'unavailable',
    source_identity: sourceIdentity,
    operation_id: operationId,
    options_hash: optionsHash,
  }
}

function jobFailed(job) {
  return Boolean(
    job &&
    (
      String(job.status ?? '').startsWith('failed_') ||
      job.motion_source_lifecycle === 'failed' ||
      job.motion_source_lifecycle === 'cancelled'
    )
  )
}

function jobRunning(job) {
  return ['queued', 'generating', 'post_processing'].includes(job?.status)
}

export function mapMotionReportOutcome({
  job = null,
  report = null,
  artifactError = null,
} = {}) {
  const warnings = normalizeWarnings(
    report?.warnings,
    report?.source_warnings,
    report?.validation?.warnings,
    job?.warnings
  )
  const blockingErrors = normalizeErrors(
    report?.blocking_errors,
    report?.validation?.blocking_errors,
    job?.blocking_errors
  )
  const reportStatus = stringEvidence(report?.status)
  if (artifactError) {
    return {
      status: 'blocked',
      reason: 'artifact_error',
      warnings,
      blocking_errors: blockingErrors,
    }
  }
  if (
    jobFailed(job) ||
    ['fail', 'failed', 'error', 'blocked'].includes(reportStatus)
  ) {
    return {
      status: 'blocked',
      reason: stringEvidence(job?.failure_status) ?? 'job_or_report_failed',
      warnings,
      blocking_errors: blockingErrors,
    }
  }
  if (reportStatus === 'warning') {
    return {
      status: 'needs_review',
      reason: 'report_warning',
      warnings,
      blocking_errors: blockingErrors,
    }
  }
  if (blockingErrors.length) {
    return {
      status: 'blocked',
      reason: 'report_blocking_errors',
      warnings,
      blocking_errors: blockingErrors,
    }
  }
  if (jobRunning(job)) {
    return {
      status: 'running',
      reason: null,
      warnings,
      blocking_errors: blockingErrors,
    }
  }
  if (!report) {
    return {
      status: job?.status === 'done' ? 'blocked' : 'waiting',
      reason: job?.status === 'done' ? 'artifact_unavailable' : null,
      warnings,
      blocking_errors: blockingErrors,
    }
  }
  if (warnings.length) {
    return {
      status: 'needs_review',
      reason: 'report_warning',
      warnings,
      blocking_errors: blockingErrors,
    }
  }
  return {
    status: 'complete',
    reason: null,
    warnings,
    blocking_errors: blockingErrors,
  }
}

export function mapMotionEvidence({
  job = null,
  report = null,
  bindingCurrent = true,
  artifactError = null,
} = {}) {
  const artifactBlocked = Boolean(artifactError) || report?.status === 'artifact_error'
  const source = mapSourceEvidence(report)
  const selection = mapSelectionEvidence(report)
  const loop = mapLoopEvidence(report, selection)
  const cleanup = mapCleanupEvidence(report)
  const grid = mapGridEvidence(report)
  const binding = mapBindingEvidence(report, bindingCurrent)
  const warnings = normalizeWarnings(
    report?.warnings,
    report?.source_warnings,
    report?.frame_selection?.warnings,
    report?.frame_selection?.temporal_matte?.warnings,
    report?.pixel_grid_refinement?.warnings,
    job?.warnings
  )
  const blockingErrors = normalizeErrors(
    report?.blocking_errors,
    job?.blocking_errors
  )
  let status
  let reason = null
  if (artifactBlocked) {
    status = 'blocked'
    reason = 'artifact_error'
  } else if (bindingCurrent === false) {
    status = 'blocked'
    reason = 'stale_binding'
  } else if (report && binding.status === 'unavailable') {
    status = 'blocked'
    reason = 'binding_unavailable'
  } else if (jobFailed(job) || report?.status === 'fail' || blockingErrors.length) {
    status = 'blocked'
    reason = stringEvidence(job?.failure_status) ?? 'job_or_report_failed'
  } else if (!report) {
    if (job?.status === 'done') {
      status = 'blocked'
      reason = 'artifact_unavailable'
    } else if (jobRunning(job)) {
      status = 'running'
    } else {
      status = 'waiting'
    }
  } else if (
    report.status === 'warning' ||
    warnings.length ||
    selection.status === 'needs_review' ||
    loop.status === 'needs_review' ||
    cleanup.status === 'needs_review' ||
    ['needs_review', 'not_applied'].includes(grid.status)
  ) {
    status = 'needs_review'
    reason = 'report_warning'
  } else if (jobRunning(job)) {
    status = 'running'
  } else {
    status = 'complete'
  }
  return {
    status,
    reason,
    source,
    selection,
    loop,
    cleanup,
    grid,
    binding,
    warnings,
    blocking_errors: blockingErrors,
  }
}
