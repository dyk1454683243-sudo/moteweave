const DOMAIN_DIAGNOSTICS = Object.freeze({
  provider_safety_filter: Object.freeze({
    reason: 'provider_safety_filter', retryHint: null, jobStatus: 'failed_safety_filter',
  }),
  failed_safety_filter: Object.freeze({
    reason: 'provider_safety_filter', retryHint: null, jobStatus: 'failed_safety_filter',
  }),
  safety_filter: Object.freeze({
    reason: 'provider_safety_filter', retryHint: null, jobStatus: 'failed_safety_filter',
  }),
  provider_route_blocked: Object.freeze({
    reason: 'provider_route_blocked', retryHint: 'switch_provider_preset', jobStatus: 'failed_model_error',
  }),
  provider_unavailable: Object.freeze({
    reason: 'provider_unavailable', retryHint: 'configure_provider', jobStatus: 'failed_model_error',
  }),
  provider_configuration_error: Object.freeze({
    reason: 'provider_configuration_error', retryHint: 'check_provider_configuration', jobStatus: 'failed_model_error',
  }),
  provider_output_invalid: Object.freeze({
    reason: 'provider_output_invalid', retryHint: 'inspect_provider_output_contract', jobStatus: 'failed_model_error',
  }),
  provider_candidate_invalid: Object.freeze({
    reason: 'provider_candidate_invalid', retryHint: 'inspect_provider_output_contract', jobStatus: 'failed_model_error',
  }),
})

const TRANSPORT_NAMES = new Set(['AbortError', 'TimeoutError'])
const TRANSPORT_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
])
const SAFE_ERROR_NAMES = new Set(['AbortError', 'Error', 'TimeoutError', 'TypeError'])
const CONTROLLED_PROVIDER_REASONS = new Set([
  'provider_authentication_failed',
  'provider_candidate_invalid',
  'provider_configuration_error',
  'provider_failed',
  'provider_output_invalid',
  'provider_quota_or_payment_required',
  'provider_rate_limited',
  'provider_request_rejected',
  'provider_route_blocked',
  'provider_safety_filter',
  'provider_service_unavailable',
  'provider_unavailable',
  'transport_outcome_unknown',
])
const UNKNOWN_PROVIDER_REASONS = new Set(['provider_failed', 'transport_outcome_unknown'])
const PROVIDER_DIAGNOSTIC_KEYS = Object.freeze([
  'reason', 'provider_outcome', 'error_name', 'connection_code', 'http_status',
])
const MAX_ERROR_PROTOTYPE_DEPTH = 6
export const FRAME_REPAIR_PROVIDER_OUTPUT_RETRY_HINTS = Object.freeze({
  provider_output_invalid: 'inspect_provider_output_invalid',
  provider_output_full_sheet: 'inspect_provider_output_full_sheet',
  provider_output_empty: 'inspect_provider_output_empty',
  provider_output_multiple_subjects: 'inspect_provider_output_multiple_subjects',
})

function ownData(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  let descriptor
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return undefined
  }
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function ownString(value, key) {
  const result = ownData(value, key)
  return typeof result === 'string' ? result : null
}

function safeErrorName(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null
  const seen = new Set()
  let current = value
  for (let depth = 0; current && depth < MAX_ERROR_PROTOTYPE_DEPTH; depth += 1) {
    if (seen.has(current)) return null
    seen.add(current)
    let descriptor
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, 'name')
    } catch {
      return null
    }
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return null
      return SAFE_ERROR_NAMES.has(descriptor.value) ? descriptor.value : null
    }
    try {
      current = Object.getPrototypeOf(current)
    } catch {
      return null
    }
  }
  return null
}

function isStrictPlainObject(value) {
  try {
    return Boolean(value) && typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}

function safeConnectionCode(value) {
  return typeof value === 'string' && TRANSPORT_CODES.has(value) ? value : null
}

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null
}

function known({ reason, retryHint, jobStatus = 'failed_model_error' }) {
  return Object.freeze({
    jobStatus,
    reason,
    retryHint,
    providerOutcome: 'known',
    recoveryState: null,
  })
}

function unknown(reason) {
  return Object.freeze({
    jobStatus: 'failed_model_error',
    reason,
    retryHint: null,
    providerOutcome: 'unknown',
    recoveryState: 'outcome_unknown',
  })
}

function domainDiagnostic(value) {
  return typeof value === 'string' && Object.hasOwn(DOMAIN_DIAGNOSTICS, value)
    ? known(DOMAIN_DIAGNOSTICS[value])
    : null
}

function httpDiagnostic(status) {
  if (!Number.isInteger(status)) return null
  if (status === 401) return known({ reason: 'provider_authentication_failed', retryHint: 'check_provider_credentials' })
  if (status === 402) return known({ reason: 'provider_quota_or_payment_required', retryHint: 'check_provider_quota' })
  if (status === 403) return known({ reason: 'provider_route_blocked', retryHint: 'switch_provider_preset' })
  if (status === 429) return known({ reason: 'provider_rate_limited', retryHint: 'wait_before_new_call' })
  if (status >= 400 && status <= 499) return known({ reason: 'provider_request_rejected', retryHint: 'review_provider_preset' })
  if (status >= 500 && status <= 599) return known({ reason: 'provider_service_unavailable', retryHint: 'review_provider_status' })
  return null
}

export function isFrameRepairProviderOutputFailure(error) {
  return frameRepairProviderOutputCode(error) !== null
}

export function frameRepairProviderOutputCode(error) {
  const code = ownString(error, 'code')
  return code && Object.hasOwn(FRAME_REPAIR_PROVIDER_OUTPUT_RETRY_HINTS, code)
    ? code
    : null
}

export function frameRepairProviderOutputRetryHint(code) {
  return typeof code === 'string' && Object.hasOwn(FRAME_REPAIR_PROVIDER_OUTPUT_RETRY_HINTS, code)
    ? FRAME_REPAIR_PROVIDER_OUTPUT_RETRY_HINTS[code]
    : null
}

export function classifyFrameRepairProviderFailure(error, {
  unusableProviderOutput = false,
} = {}) {
  if (unusableProviderOutput === true) {
    const retryHint = frameRepairProviderOutputRetryHint(frameRepairProviderOutputCode(error))
    return known({
      ...DOMAIN_DIAGNOSTICS.provider_candidate_invalid,
      retryHint: retryHint ?? DOMAIN_DIAGNOSTICS.provider_candidate_invalid.retryHint,
    })
  }

  const code = ownString(error, 'code')
  const failureStatus = ownString(error, 'failure_status')
  const status = ownString(error, 'status')
  for (const value of [code, failureStatus, status]) {
    const classified = domainDiagnostic(value)
    if (classified) return classified
  }

  const classifiedHttp = httpDiagnostic(ownData(error, 'http_status'))
  if (classifiedHttp) return classifiedHttp

  if (status === 'failed_model_error' && ownString(error, 'retry_hint') === 'regenerate') {
    return known(DOMAIN_DIAGNOSTICS.provider_output_invalid)
  }

  const cause = ownData(error, 'cause')
  const causeCode = ownString(cause, 'code')
  if (ownData(error, 'outcomeUnknown') === true ||
      TRANSPORT_NAMES.has(safeErrorName(error)) ||
      TRANSPORT_CODES.has(code) || TRANSPORT_CODES.has(causeCode)) {
    return unknown('transport_outcome_unknown')
  }

  return unknown('provider_failed')
}

export function buildFrameRepairProviderDiagnostic(error, options = {}) {
  const classified = classifyFrameRepairProviderFailure(error, options)
  const name = safeErrorName(error)
  const code = safeConnectionCode(ownString(error, 'code'))
  const cause = ownData(error, 'cause')
  const causeCode = safeConnectionCode(ownString(cause, 'code'))
  const httpStatus = safeHttpStatus(ownData(error, 'http_status'))
  return Object.freeze({
    reason: classified.reason,
    provider_outcome: classified.providerOutcome,
    error_name: SAFE_ERROR_NAMES.has(name) ? name : null,
    connection_code: httpStatus === null ? code ?? causeCode : null,
    http_status: httpStatus,
  })
}

export function isFrameRepairProviderDiagnostic(value) {
  if (!isStrictPlainObject(value)) return false
  const enumerableKeys = Object.keys(value)
  const ownKeys = Reflect.ownKeys(value)
  return enumerableKeys.length === PROVIDER_DIAGNOSTIC_KEYS.length &&
    ownKeys.length === PROVIDER_DIAGNOSTIC_KEYS.length &&
    PROVIDER_DIAGNOSTIC_KEYS.every((key) => Object.hasOwn(value, key)) &&
    ownKeys.every((key) => typeof key === 'string') &&
    CONTROLLED_PROVIDER_REASONS.has(value.reason) &&
    value.provider_outcome === (UNKNOWN_PROVIDER_REASONS.has(value.reason) ? 'unknown' : 'known') &&
    (value.error_name === null || SAFE_ERROR_NAMES.has(value.error_name)) &&
    (value.connection_code === null || TRANSPORT_CODES.has(value.connection_code)) &&
    (value.http_status === null || safeHttpStatus(value.http_status) === value.http_status) &&
    !(value.connection_code !== null && value.http_status !== null) &&
    !(value.connection_code !== null && value.provider_outcome !== 'unknown') &&
    !(value.http_status !== null && value.provider_outcome !== 'known')
}
