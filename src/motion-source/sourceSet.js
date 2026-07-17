export const MOTION_SOURCE_SET_CONTRACT_VERSION = 'motion_source_set_v1'

const LOOP_EXPECTATIONS = new Set(['auto', 'loop', 'once'])
const BACKGROUND_REQUIREMENTS = new Set([
  'flat_solid_key_color_or_alpha',
  'transparent_alpha',
  'flat_solid_key_color',
])

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function validRgb(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)
}

function validateRecommendedDuration(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((item) => Number.isFinite(Number(item)) && Number(item) >= 0)
    && Number(value[0]) <= Number(value[1])
}

function normalizeBackground(background) {
  if (!isObject(background)) return null
  const normalized = {
    source_requirement: nonEmptyString(background.source_requirement) ? background.source_requirement.trim() : undefined,
  }
  if (validRgb(background.key_color)) normalized.key_color = background.key_color.slice()
  if (Number.isFinite(Number(background.tolerance))) normalized.tolerance = Number(background.tolerance)
  return normalized
}

function backgroundWarningsFor(source, globalBackground) {
  const sourceBackground = normalizeBackground(source.background)
  const effective = sourceBackground ?? globalBackground
  const action = source.runtime_action.trim()
  if (!effective?.source_requirement) return [`background_requirement_missing:${action}`]
  if (!BACKGROUND_REQUIREMENTS.has(effective.source_requirement)) return [`background_requirement_unsupported:${action}`]
  if (effective.source_requirement === 'flat_solid_key_color_or_alpha') return [`background_requirement_ambiguous:${action}`]
  return []
}

function normalizeSource(source, index, globalBackground, warnings, blockingErrors) {
  if (!isObject(source)) {
    blockingErrors.push(`source_invalid:${index}`)
    return null
  }
  if (!nonEmptyString(source.runtime_action)) blockingErrors.push(`source_runtime_action_required:${index}`)
  if (!nonEmptyString(source.source)) blockingErrors.push(`source_source_required:${index}`)
  if (!positiveInteger(source.target_frame_count)) blockingErrors.push(`source_target_frame_count_invalid:${index}`)
  if (source.recommended_duration_sec !== undefined && !validateRecommendedDuration(source.recommended_duration_sec)) {
    blockingErrors.push(`recommended_duration_invalid:${index}`)
  }
  if (source.loop_expected !== undefined && typeof source.loop_expected !== 'boolean') {
    blockingErrors.push(`loop_expected_invalid:${index}`)
  }
  if (
    source.loop_expectation !== undefined &&
    (!nonEmptyString(source.loop_expectation) || !LOOP_EXPECTATIONS.has(source.loop_expectation.trim()))
  ) {
    blockingErrors.push(`loop_expectation_invalid:${index}`)
  }
  const legacyLoopExpectation = source.loop_expected === true
    ? 'loop'
    : source.loop_expected === false
      ? 'once'
      : null
  const explicitLoopExpectation = nonEmptyString(source.loop_expectation)
    ? source.loop_expectation.trim()
    : null
  if (
    legacyLoopExpectation &&
    explicitLoopExpectation &&
    legacyLoopExpectation !== explicitLoopExpectation
  ) {
    blockingErrors.push(`loop_expectation_conflict:${index}`)
  }
  if (!nonEmptyString(source.runtime_action) || !nonEmptyString(source.source) || !positiveInteger(source.target_frame_count)) {
    return null
  }

  warnings.push(...backgroundWarningsFor(source, globalBackground))
  const normalized = {
    id: nonEmptyString(source.id) ? source.id.trim() : source.runtime_action.trim(),
    runtime_action: source.runtime_action.trim(),
    source: source.source.trim(),
    target_frame_count: source.target_frame_count,
    loop_expectation: explicitLoopExpectation ?? legacyLoopExpectation ?? 'auto',
  }
  if (typeof source.loop_expected === 'boolean') normalized.loop_expected = source.loop_expected
  if (source.recommended_duration_sec !== undefined) {
    normalized.recommended_duration_sec = source.recommended_duration_sec.map(Number)
  }
  if (nonEmptyString(source.facing_direction)) normalized.facing_direction = source.facing_direction.trim()
  const background = normalizeBackground(source.background)
  if (background) normalized.background = background
  return normalized
}

export function validateMotionSourceSetManifest(manifest) {
  const warnings = []
  const blockingErrors = []
  if (!isObject(manifest)) {
    return {
      status: 'fail',
      normalized_manifest: null,
      warnings,
      blocking_errors: ['invalid_motion_source_set_manifest'],
    }
  }
  if (manifest.contract_version !== MOTION_SOURCE_SET_CONTRACT_VERSION) {
    blockingErrors.push('unsupported_motion_source_set_contract_version')
  }
  if (!isObject(manifest.identity_anchor)) {
    blockingErrors.push('identity_anchor_required')
  } else if (!nonEmptyString(manifest.identity_anchor.source_id)) {
    blockingErrors.push('identity_anchor_source_id_required')
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length < 1) {
    blockingErrors.push('sources_required')
  }

  const globalBackground = normalizeBackground(manifest.background)
  if (manifest.background !== undefined && !globalBackground) blockingErrors.push('background_invalid')
  if (globalBackground?.source_requirement && !BACKGROUND_REQUIREMENTS.has(globalBackground.source_requirement)) {
    blockingErrors.push('background_source_requirement_unsupported')
  }

  const normalizedSources = []
  const runtimeActions = new Set()
  for (const [index, source] of (manifest.sources ?? []).entries()) {
    const normalized = normalizeSource(source, index, globalBackground, warnings, blockingErrors)
    if (!normalized) continue
    if (runtimeActions.has(normalized.runtime_action)) {
      blockingErrors.push(`duplicate_runtime_action:${normalized.runtime_action}`)
    }
    runtimeActions.add(normalized.runtime_action)
    normalizedSources.push(normalized)
  }

  const normalizedManifest = blockingErrors.length
    ? null
    : {
      contract_version: MOTION_SOURCE_SET_CONTRACT_VERSION,
      identity_anchor: jsonClone(manifest.identity_anchor),
      background: globalBackground,
      sources: normalizedSources,
    }
  if (normalizedManifest && manifest.output_profile !== undefined) normalizedManifest.output_profile = jsonClone(manifest.output_profile)

  return {
    status: blockingErrors.length ? 'fail' : (warnings.length ? 'warning' : 'pass'),
    normalized_manifest: normalizedManifest,
    warnings: [...new Set(warnings)].sort(),
    blocking_errors: [...new Set(blockingErrors)].sort(),
  }
}
