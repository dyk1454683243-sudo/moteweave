import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFrameRepairProviderDiagnostic,
  classifyFrameRepairProviderFailure,
  isFrameRepairProviderDiagnostic,
  isFrameRepairProviderOutputFailure,
} from '../../src/editor-project/frameRepairProviderDiagnostics.js'

function known(reason, retryHint = null, jobStatus = 'failed_model_error') {
  return {
    jobStatus,
    reason,
    retryHint,
    providerOutcome: 'known',
    recoveryState: null,
  }
}

function unknown(reason) {
  return {
    jobStatus: 'failed_model_error',
    reason,
    retryHint: null,
    providerOutcome: 'unknown',
    recoveryState: 'outcome_unknown',
  }
}

test('classifier maps domain, HTTP, and structured no-image failures to controlled known outcomes', () => {
  const cases = [
    ['normalization invalid', { code: 'provider_output_invalid' }, { unusableProviderOutput: true }, known('provider_candidate_invalid', 'inspect_provider_output_invalid')],
    ['normalization full sheet', { code: 'provider_output_full_sheet' }, { unusableProviderOutput: true }, known('provider_candidate_invalid', 'inspect_provider_output_full_sheet')],
    ['normalization empty', { code: 'provider_output_empty' }, { unusableProviderOutput: true }, known('provider_candidate_invalid', 'inspect_provider_output_empty')],
    ['normalization multiple subjects', { code: 'provider_output_multiple_subjects' }, { unusableProviderOutput: true }, known('provider_candidate_invalid', 'inspect_provider_output_multiple_subjects')],
    ['safety', { code: 'safety_filter' }, {}, known('provider_safety_filter', null, 'failed_safety_filter')],
    ['route status', { failure_status: 'provider_route_blocked' }, {}, known('provider_route_blocked', 'switch_provider_preset')],
    ['provider unavailable', { code: 'provider_unavailable' }, {}, known('provider_unavailable', 'configure_provider')],
    ['configuration', { code: 'provider_configuration_error' }, {}, known('provider_configuration_error', 'check_provider_configuration')],
    ['output code', { code: 'provider_output_invalid' }, {}, known('provider_output_invalid', 'inspect_provider_output_contract')],
    ['HTTP 401', { http_status: 401 }, {}, known('provider_authentication_failed', 'check_provider_credentials')],
    ['HTTP 402', { http_status: 402 }, {}, known('provider_quota_or_payment_required', 'check_provider_quota')],
    ['HTTP 403', { http_status: 403 }, {}, known('provider_route_blocked', 'switch_provider_preset')],
    ['HTTP 429', { http_status: 429 }, {}, known('provider_rate_limited', 'wait_before_new_call')],
    ['other HTTP 4xx', { http_status: 418 }, {}, known('provider_request_rejected', 'review_provider_preset')],
    ['HTTP 5xx', { http_status: 503 }, {}, known('provider_service_unavailable', 'review_provider_status')],
    ['structured no-image response', { status: 'failed_model_error', retry_hint: 'regenerate' }, {}, known('provider_output_invalid', 'inspect_provider_output_contract')],
  ]

  for (const [name, error, options, expected] of cases) {
    const result = classifyFrameRepairProviderFailure(error, options)
    assert.deepEqual(result, expected, name)
    assert.equal(Object.isFrozen(result), true, name)
  }
  assert.equal(isFrameRepairProviderOutputFailure({ code: 'provider_output_invalid' }), true)
  assert.equal(isFrameRepairProviderOutputFailure({ code: 'provider_output_full_sheet' }), true)
  assert.equal(isFrameRepairProviderOutputFailure({ code: 'provider_output_empty' }), true)
  assert.equal(isFrameRepairProviderOutputFailure({ code: 'provider_output_multiple_subjects' }), true)
  assert.equal(isFrameRepairProviderOutputFailure({ code: 'provider_output_private_marker' }), false)
  assert.equal(isFrameRepairProviderOutputFailure({ code: 'normalization_failed' }), false)
})

test('classifier separates transport uncertainty from an unclassified provider failure', () => {
  for (const error of [
    { outcomeUnknown: true },
    { name: 'AbortError' },
    { name: 'TimeoutError' },
    { code: 'ETIMEDOUT' },
    { cause: { code: 'ECONNRESET' } },
  ]) {
    assert.deepEqual(
      classifyFrameRepairProviderFailure(error),
      unknown('transport_outcome_unknown'),
    )
  }

  assert.deepEqual(
    classifyFrameRepairProviderFailure(new Error('unclassified internal failure')),
    unknown('provider_failed'),
  )
})

test('provider diagnostics retain only controlled connection codes and HTTP status', () => {
  const transport = buildFrameRepairProviderDiagnostic({
    name: 'TypeError',
    cause: { code: 'ECONNRESET', message: 'Bearer private.token' },
    message: '/Users/private/provider-response.json',
  })
  assert.deepEqual(transport, {
    reason: 'transport_outcome_unknown',
    provider_outcome: 'unknown',
    error_name: 'TypeError',
    connection_code: 'ECONNRESET',
    http_status: null,
  })
  assert.equal(Object.isFrozen(transport), true)
  assert.equal(isFrameRepairProviderDiagnostic(transport), true)

  const http = buildFrameRepairProviderDiagnostic({
    name: 'Error',
    code: 'PRIVATE_PROVIDER_MARKER',
    http_status: 503,
    response_body: 'data:image/png;base64,AAAA',
  })
  assert.deepEqual(http, {
    reason: 'provider_service_unavailable',
    provider_outcome: 'known',
    error_name: 'Error',
    connection_code: null,
    http_status: 503,
  })
  assert.equal(isFrameRepairProviderDiagnostic(http), true)
  assert.equal(isFrameRepairProviderDiagnostic({
    ...transport,
    reason: 'private_provider_marker',
  }), false)
  assert.equal(isFrameRepairProviderDiagnostic({
    ...http,
    provider_outcome: 'unknown',
  }), false)
  assert.equal(isFrameRepairProviderDiagnostic({
    ...http,
    connection_code: 'ECONNRESET',
  }), false)
  assert.doesNotMatch(JSON.stringify({ transport, http }), /Bearer|private\.token|\/Users\/private|data:image|PRIVATE_PROVIDER_MARKER/)
})

test('provider diagnostics retain allowlisted native error names without persisting free text', () => {
  const nativeError = new TypeError('Bearer private.token /Users/private/provider-response.json')
  const diagnostic = buildFrameRepairProviderDiagnostic(nativeError)

  assert.deepEqual(diagnostic, {
    reason: 'provider_failed',
    provider_outcome: 'unknown',
    error_name: 'TypeError',
    connection_code: null,
    http_status: null,
  })
  assert.equal(isFrameRepairProviderDiagnostic(diagnostic), true)
  assert.doesNotMatch(JSON.stringify(diagnostic), /Bearer|private\.token|\/Users\/private/)
})

test('classifier ignores hostile free text, accessors, secrets, paths, and frozen inputs', () => {
  let messageReads = 0
  let codeReads = 0
  let nameReads = 0
  const hostilePrototype = {}
  Object.defineProperty(hostilePrototype, 'name', {
    get() {
      nameReads += 1
      throw new Error('prototype name must not be read')
    },
  })
  const hostile = Object.create(hostilePrototype)
  Object.defineProperties(hostile, {
    message: {
      enumerable: true,
      get() {
        messageReads += 1
        throw new Error('message must not be read')
      },
    },
    code: {
      enumerable: true,
      get() {
        codeReads += 1
        throw new Error('accessor code must not be read')
      },
    },
    cause: { enumerable: true, value: Object.freeze({ code: 'ECONNRESET' }) },
    response_body: { enumerable: true, value: 'Bearer private.token data:image/png;base64,AAAA' },
    private_path: { enumerable: true, value: '/Users/private/provider-response.json' },
    stack: { enumerable: true, value: 'private stack body' },
  })
  Object.freeze(hostile)

  const result = classifyFrameRepairProviderFailure(hostile)
  const diagnostic = buildFrameRepairProviderDiagnostic(hostile)
  const serialized = JSON.stringify({ result, diagnostic })

  assert.deepEqual(result, unknown('transport_outcome_unknown'))
  assert.deepEqual(diagnostic, {
    reason: 'transport_outcome_unknown',
    provider_outcome: 'unknown',
    error_name: null,
    connection_code: 'ECONNRESET',
    http_status: null,
  })
  assert.equal(isFrameRepairProviderDiagnostic(diagnostic), true)
  assert.equal(messageReads, 0)
  assert.equal(codeReads, 0)
  assert.equal(nameReads, 0)
  assert.equal(isFrameRepairProviderOutputFailure(hostile), false)
  assert.equal(codeReads, 0)
  assert.equal(Object.isFrozen(hostile), true)
  assert.doesNotMatch(serialized, /Bearer|private\.token|data:image|\/Users\/private|stack body/)
})
