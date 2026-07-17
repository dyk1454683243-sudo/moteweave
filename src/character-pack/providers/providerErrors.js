const ROUTE_BLOCKED_PATTERNS = [
  /request is prohibited/i,
  /provider terms of service/i,
  /terms of service/i,
  /violation of provider/i,
  /policy violation/i,
]

export const PROVIDER_ROUTE_BLOCKED_STATUS = 'provider_route_blocked'
export const PROVIDER_ROUTE_BLOCKED_RETRY_HINT = 'switch_provider_preset'

function routeBlockedMessage(message) {
  const text = String(message || '')
  return ROUTE_BLOCKED_PATTERNS.some((pattern) => pattern.test(text))
}

export function classifyProviderError(message, { statusCode } = {}) {
  if (routeBlockedMessage(message)) {
    return {
      status: PROVIDER_ROUTE_BLOCKED_STATUS,
      failure_status: PROVIDER_ROUTE_BLOCKED_STATUS,
      retry_hint: PROVIDER_ROUTE_BLOCKED_RETRY_HINT,
      non_retryable: true,
    }
  }
  if (Number(statusCode) === 403) {
    return {
      status: PROVIDER_ROUTE_BLOCKED_STATUS,
      failure_status: PROVIDER_ROUTE_BLOCKED_STATUS,
      retry_hint: PROVIDER_ROUTE_BLOCKED_RETRY_HINT,
      non_retryable: true,
    }
  }
  return {
    status: 'failed_model_error',
    failure_status: null,
    retry_hint: 'regenerate',
    non_retryable: false,
  }
}

export function providerRequestError(message, { statusCode } = {}) {
  const classification = classifyProviderError(message, { statusCode })
  return Object.assign(new Error(message), {
    ...classification,
    http_status: statusCode ?? null,
  })
}

export function providerErrorFailureStatus(error) {
  return error?.failure_status ?? (
    error?.status && error.status !== 'failed_model_error' ? error.status : null
  )
}

export function isNonRetryableProviderError(error) {
  return Boolean(error?.non_retryable) ||
    [PROVIDER_ROUTE_BLOCKED_STATUS, 'failed_budget_exhausted'].includes(providerErrorFailureStatus(error))
}
