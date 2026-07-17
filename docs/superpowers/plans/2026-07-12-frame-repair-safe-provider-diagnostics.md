# Frame Repair Safe Provider Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve safe structured Frame Repair provider-failure categories and show them as read-only Processing diagnostics without exposing remote text or authorizing another provider call.

**Architecture:** Add one pure Editor-only classifier that converts allowlisted error metadata into the existing Frame Repair failure fields. Integrate it at the service's provider-phase boundary, then render only locally mapped reason/hint pairs in the existing Processing stage. Keep provider adapters, API shapes, ledger version, job states, project JSON, and one-call accounting unchanged.

**Tech Stack:** Node.js ES modules, `node:test`, existing Frame Repair service/ledger, DOM-based Editor UI, plain CSS, repository process-tree resource guard.

---

## Preconditions And Safety Boundary

- Work only in `<workspace>/.worktrees/frame-repair-safe-diagnostics` on branch `codex/frame-repair-safe-diagnostics`.
- Read and follow `AGENTS.md`, `docs/guardrails/ui-implementation-guardrails.md`, and `docs/guardrails/editor-workspace-guardrails.md` before implementation.
- The approved design is `docs/superpowers/specs/2026-07-12-frame-repair-safe-provider-diagnostics-design.md`.
- Do not modify `src/character-pack/providers/*`, `server.js`, project schemas, job status enums, package files, or `ATTRIBUTIONS.md`.
- Do not dispatch a real provider request. Every provider failure in this plan is an injected test object.
- Run only one test/build/smoke runner at a time. Use only the checked-in resource-guarded npm commands.
- The clean worktree baseline is 1185 passing tests. Its full-suite peak was 3,981,296 KiB, close to the 4,096 MiB guard, so do not repeat the full suite before Task 5.
- Never delete generated evidence or directories. This plan requires no deletion.

## File Responsibility Map

| File | Responsibility |
| --- | --- |
| `src/editor-project/frameRepairProviderDiagnostics.js` | New pure allowlisted classification of structured provider failures. No I/O, provider import, raw message read, or mutation. |
| `test/editor-project/editorFrameRepairProviderDiagnostics.test.js` | New exhaustive classifier, privacy, accessor, frozen-input, and fallback tests. |
| `src/editor-project/frameRepairService.js` | Replace only the provider-phase classification branch with the new pure classifier; preserve all other phases. |
| `test/editor-project/editorFrameRepairService.test.js` | Prove public Job/ledger parity, known-vs-unknown outcome, one-call accounting, no replay, and no raw leakage. |
| `src/ui/editor/frameRepairPanel.js` | Map public reason/hint pairs to fixed local English copy and render one read-only diagnostic block. |
| `test/editor-project/editorFrameRepairPanel.test.js` | Prove known, unknown, fallback, hint mismatch, live announcement, and no-Retry behavior. |
| `src/ui/editor/editor.css` | Style the diagnostic block inside the existing bounded rail and narrow drawer. |
| `test/editor-project/editorShellStructure.test.js` | Preserve responsive style markers and wrapping contract. |
| `docs/protocols/editor-frame-repair-v1.md` | Define the safe diagnostic taxonomy and unchanged public-field/call semantics. |
| `docs/runbooks/targeted-frame-repair-v1.md` | Record the later bounded live pilot, historical limitation, operator handling, and no-retry boundary. |
| `docs/superpowers/specs/2026-07-12-frame-repair-safe-provider-diagnostics-design.md` | Mark the approved design implemented only after all verification passes. |

## Task 1: Add The Pure Provider-Failure Classifier

**Files:**
- Create: `test/editor-project/editorFrameRepairProviderDiagnostics.test.js`
- Create: `src/editor-project/frameRepairProviderDiagnostics.js`

- [ ] **Step 1: Write the failing classifier tests**

Create `test/editor-project/editorFrameRepairProviderDiagnostics.test.js` with this complete content:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyFrameRepairProviderFailure,
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
    ['normalization candidate', { code: 'provider_output_invalid' }, { unusableProviderOutput: true }, known('provider_candidate_invalid', 'inspect_provider_output_contract')],
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

test('classifier ignores hostile free text, accessors, secrets, paths, and frozen inputs', () => {
  let messageReads = 0
  let codeReads = 0
  const hostile = {}
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
  const serialized = JSON.stringify(result)

  assert.deepEqual(result, unknown('transport_outcome_unknown'))
  assert.equal(messageReads, 0)
  assert.equal(codeReads, 0)
  assert.equal(isFrameRepairProviderOutputFailure(hostile), false)
  assert.equal(codeReads, 0)
  assert.equal(Object.isFrozen(hostile), true)
  assert.doesNotMatch(serialized, /Bearer|private\.token|data:image|\/Users\/private|stack body/)
})
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
npm run test:focused -- test/editor-project/editorFrameRepairProviderDiagnostics.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `frameRepairProviderDiagnostics.js`. The resource guard must exit normally; do not run another test concurrently.

- [ ] **Step 3: Implement the minimal pure classifier**

Create `src/editor-project/frameRepairProviderDiagnostics.js` with this complete content:

```js
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
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
])

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
  const code = ownString(error, 'code')
  return code?.startsWith('provider_output_') === true
}

export function classifyFrameRepairProviderFailure(error, {
  unusableProviderOutput = false,
} = {}) {
  if (unusableProviderOutput === true) {
    return known(DOMAIN_DIAGNOSTICS.provider_candidate_invalid)
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
      TRANSPORT_NAMES.has(ownString(error, 'name')) ||
      TRANSPORT_CODES.has(code) || TRANSPORT_CODES.has(causeCode)) {
    return unknown('transport_outcome_unknown')
  }

  return unknown('provider_failed')
}
```

- [ ] **Step 4: Run the focused classifier test and verify green**

Run:

```bash
npm run test:focused -- test/editor-project/editorFrameRepairProviderDiagnostics.test.js
```

Expected: all three top-level tests pass, `fail 0`, and the focused guard reports completion below its 1536 MiB RSS and 60-second ceilings.

- [ ] **Step 5: Review and commit the classifier unit**

Run:

```bash
git diff --check
git status --short
git add -- src/editor-project/frameRepairProviderDiagnostics.js test/editor-project/editorFrameRepairProviderDiagnostics.test.js
git diff --cached --check
git commit -m "feat: classify frame repair provider failures"
```

Expected: exactly the new classifier and its test are committed; the worktree is otherwise clean.

## Task 2: Publish Safe Diagnostics Through Service And Ledger

**Files:**
- Modify: `test/editor-project/editorFrameRepairService.test.js:354-396`
- Modify: `test/editor-project/editorFrameRepairService.test.js:472-518`
- Modify: `src/editor-project/frameRepairService.js:12-24`
- Modify: `src/editor-project/frameRepairService.js:794-818`

- [ ] **Step 1: Add the failing service integration test**

Insert this test after `unclassified provider exceptions default to conservative outcome-unknown recovery`:

```js
test('service persists safe provider diagnostics without raw text, retry, or ledger drift', async () => {
  const cases = [
    ['authentication', { http_status: 401 }, 'provider_authentication_failed', 'check_provider_credentials', 'known', null],
    ['quota', { http_status: 402 }, 'provider_quota_or_payment_required', 'check_provider_quota', 'known', null],
    ['rate limit', { http_status: 429 }, 'provider_rate_limited', 'wait_before_new_call', 'known', null],
    ['service unavailable', { http_status: 503 }, 'provider_service_unavailable', 'review_provider_status', 'known', null],
    ['invalid image response', { status: 'failed_model_error', retry_hint: 'regenerate' }, 'provider_output_invalid', 'inspect_provider_output_contract', 'known', null],
    ['transport uncertainty', { outcomeUnknown: true }, 'transport_outcome_unknown', null, 'unknown', 'outcome_unknown'],
  ]

  for (const [name, fields, reason, retryHint, providerOutcome, recoveryState] of cases) {
    const rawSecret = `Bearer private.${name.replaceAll(' ', '_')} /Users/private/provider.json`
    const providerError = Object.assign(new Error(rawSecret), fields)
    const harness = await serviceHarness({ providerError })
    const service = createFrameRepairService(harness.dependencies)

    await service.enqueue(liveServiceInput())
    await runQueued(harness.queue[0])

    const failed = await service.getOperation(operationLookup())
    const publicJob = service.getJob(failed.id)
    const record = await harness.ledger.get(operationLookup())
    assert.equal(failed.status, 'failed_model_error', name)
    assert.equal(failed.reason, reason, name)
    assert.equal(failed.retry_hint, retryHint, name)
    assert.equal(failed.recovery_state, recoveryState, name)
    assert.equal(failed.provider_calls_used, 1, name)
    assert.equal(publicJob.reason, reason, name)
    assert.equal(publicJob.retry_hint, retryHint, name)
    assert.equal(record.reason, reason, name)
    assert.equal(record.retry_hint, retryHint, name)
    assert.equal(record.provider_outcome, providerOutcome, name)
    assert.equal(harness.providerCalls, 1, name)

    const restarted = createFrameRepairService({
      ...harness.dependencies,
      getJob() { return null },
    })
    const recovered = await restarted.getOperation(operationLookup())
    assert.equal(recovered.reason, reason, name)
    assert.equal(recovered.retry_hint, retryHint, name)
    assert.equal(recovered.recovery_state, recoveryState ?? 'terminal', name)
    assert.equal(harness.providerCalls, 1, name)
    assert.doesNotMatch(JSON.stringify({ failed, publicJob, record, recovered }), /Bearer|\/Users\/private/)

    const replay = await service.enqueue(liveServiceInput())
    assert.equal(replay.id, failed.id, name)
    assert.equal(harness.queue.length, 1, name)
    assert.equal(harness.providerCalls, 1, name)
  }
})
```

Add these exact assertions to the two existing conservative-recovery tests:

```js
assert.equal(recovered.reason, 'transport_outcome_unknown')
assert.equal(recovered.retry_hint, null)
```

for the explicit `outcomeUnknown: true` case, and:

```js
assert.equal(recovered.reason, 'provider_failed')
assert.equal(recovered.retry_hint, null)
```

for the unclassified `new Error('transport closed')` case.

- [ ] **Step 2: Run the service and classifier tests and verify the red state**

Run:

```bash
npm run test:focused -- test/editor-project/editorFrameRepairProviderDiagnostics.test.js test/editor-project/editorFrameRepairService.test.js
```

Expected: classifier tests pass; the new service assertions fail because the old service still collapses errors to `provider_failed` with a null hint.

- [ ] **Step 3: Integrate the classifier at the existing service boundary**

Add this import beside the other Frame Repair imports in `src/editor-project/frameRepairService.js`:

```js
import {
  classifyFrameRepairProviderFailure,
  isFrameRepairProviderOutputFailure,
} from './frameRepairProviderDiagnostics.js'
```

Replace only the provider branch at the start of `failureForPhase` with:

```js
function failureForPhase(phase, error) {
  const unusableProviderOutput = phase === 'normalization' &&
    isFrameRepairProviderOutputFailure(error)
  if (phase === 'provider' || unusableProviderOutput) {
    const classified = classifyFrameRepairProviderFailure(error, { unusableProviderOutput })
    return {
      status: classified.jobStatus,
      reason: classified.reason,
      retry_hint: classified.retryHint,
      providerOutcome: classified.providerOutcome,
      recoveryState: classified.recoveryState,
    }
  }
  const reasonByPhase = {
    reservation: 'job_directory_collision',
    preflight: 'managed_authority_invalid',
    normalization: 'normalization_failed',
    composite: 'composite_integrity_failed',
    package: 'package_failed',
    writer: 'artifact_integrity_failed',
    queue: 'queue_failed',
  }
  return {
    status: 'failed_post_processing',
    reason: reasonByPhase[phase] ?? 'post_processing_failed',
    retry_hint: 'inspect_editor_character_frame_repair',
    providerOutcome: null,
    recoveryState: null,
  }
}
```

Do not change `publishFailure`, the ledger schema/version, `PUBLIC_SCALARS`, call accounting, replay logic, or any non-provider phase.

- [ ] **Step 4: Run focused service verification**

Run:

```bash
npm run test:focused -- test/editor-project/editorFrameRepairProviderDiagnostics.test.js test/editor-project/editorFrameRepairService.test.js test/editor-project/editorFrameRepairOperationLedger.test.js
```

Expected: all tests pass with `fail 0`; known failures persist `provider_outcome: known`, unknown failures retain `outcome_unknown`, and provider calls remain one.

- [ ] **Step 5: Commit the service integration**

Run:

```bash
git diff --check
git status --short
git add -- src/editor-project/frameRepairService.js test/editor-project/editorFrameRepairService.test.js
git diff --cached --check
git commit -m "feat: publish safe frame repair diagnostics"
```

Expected: only the service and service test are committed in this unit.

## Task 3: Render The Safe Processing Diagnostic

**Files:**
- Modify: `test/editor-project/editorFrameRepairPanel.test.js:153-204`
- Modify: `test/editor-project/editorShellStructure.test.js:203-216`
- Modify: `src/ui/editor/frameRepairPanel.js:1-44`
- Modify: `src/ui/editor/frameRepairPanel.js:153-165`
- Modify: `src/ui/editor/frameRepairPanel.js:288-329`
- Modify: `src/ui/editor/editor.css:1736-1757`

- [ ] **Step 1: Write failing Panel and CSS contract tests**

Append this complete test before `focusFirst and destroy use the stable rail lifecycle` in `editorFrameRepairPanel.test.js`:

```js
test('rail renders only local allowlisted provider diagnostics and keeps one polite live region', () => {
  const documentRef = fakeDocument()
  const panel = createFrameRepairPanel({ documentRef, onAction() {} })

  panel.render(frameRepairView({
    stage: 'processing',
    uiState: 'failed_model',
    canEdit: false,
    actions: ['review_call', 'discard', 'close'],
    job: {
      id: 'job_frame',
      status: 'failed_model_error',
      reason: 'provider_rate_limited',
      retry_hint: 'wait_before_new_call',
      recovery_state: null,
      provider_call_budget: 1,
      provider_calls_used: 1,
      remote_message: 'Bearer private.token /Users/private/provider.json',
    },
  }))

  const diagnostic = panel.element.querySelector('.editor-frame-repair-diagnostic')
  const state = panel.element.querySelector('.editor-frame-repair-diagnostic-state')
  const detail = panel.element.querySelector('.editor-frame-repair-diagnostic-detail')
  const next = panel.element.querySelector('.editor-frame-repair-diagnostic-next')
  const live = panel.element.querySelector('.editor-frame-repair-live')
  assert.equal(diagnostic.hidden, false)
  assert.equal(diagnostic.dataset.tone, 'known')
  assert.equal(state.textContent, 'Known provider failure · provider_rate_limited')
  assert.match(detail.textContent, /rate-limited/)
  assert.match(next.textContent, /Wait before authorizing a new call/)
  assert.match(live.textContent, /provider_rate_limited/)
  assert.doesNotMatch([state, detail, next, live].map((node) => node.textContent).join(' '), /Bearer|\/Users\/private/)
  assert.equal(panel.element.querySelectorAll('[aria-live]').length, 1)
  assert.equal(panel.element.querySelectorAll('button').some((button) => /retry/i.test(button.textContent)), false)

  panel.render(frameRepairView({
    stage: 'processing',
    uiState: 'failed_model',
    canEdit: false,
    actions: ['review_call', 'discard', 'close'],
    job: {
      id: 'job_frame',
      status: 'failed_model_error',
      reason: 'provider_rate_limited',
      retry_hint: 'Bearer private.token',
      recovery_state: null,
      provider_call_budget: 1,
      provider_calls_used: 1,
    },
  }))
  assert.equal(state.textContent, 'Known provider failure · provider_rate_limited')
  assert.equal(next.hidden, true)
  assert.doesNotMatch([state, detail, next, live].map((node) => node.textContent).join(' '), /Bearer/)

  panel.render(frameRepairView({
    stage: 'processing',
    uiState: 'outcome_unknown',
    canEdit: false,
    actions: ['recover', 'discard', 'close'],
    job: {
      id: 'job_frame',
      status: 'failed_model_error',
      reason: 'private_internal_marker',
      retry_hint: 'Bearer private.token',
      recovery_state: 'outcome_unknown',
      provider_call_budget: 1,
      provider_calls_used: 1,
    },
  }))

  assert.equal(diagnostic.dataset.tone, 'unknown')
  assert.equal(state.textContent, 'Outcome unknown · provider_failed')
  assert.match(detail.textContent, /could not be classified safely/)
  assert.equal(next.hidden, true)
  assert.doesNotMatch([state, detail, next, live].map((node) => node.textContent).join(' '), /private_internal_marker|Bearer/)
  assert.equal(panel.element.querySelector('[data-frame-repair-action="recover"]').hidden, false)

  panel.render(frameRepairView({
    stage: 'processing',
    uiState: 'generating',
    job: { id: 'job_frame', status: 'generating', reason: null, retry_hint: null, provider_call_budget: 1, provider_calls_used: 1 },
  }))
  assert.equal(diagnostic.hidden, true)
})
```

In `editorShellStructure.test.js`, add `'.editor-frame-repair-diagnostic'` to the marker list and add:

```js
assert.match(css, /\.editor-frame-repair-diagnostic\[data-tone="unknown"\]/)
```

- [ ] **Step 2: Run the Panel/CSS tests and verify the red state**

Run:

```bash
npm run test:focused -- test/editor-project/editorFrameRepairPanel.test.js test/editor-project/editorShellStructure.test.js
```

Expected: FAIL because `.editor-frame-repair-diagnostic` and its tone styles do not exist.

- [ ] **Step 3: Add the local diagnostic mapping helper**

Insert this block after `STAGES` in `src/ui/editor/frameRepairPanel.js`:

```js
const PROVIDER_DIAGNOSTIC_COPY = Object.freeze({
  provider_safety_filter: Object.freeze({ outcome: 'known', retryHint: null, detail: 'The provider blocked the candidate for safety reasons.', next: null }),
  provider_route_blocked: Object.freeze({ outcome: 'known', retryHint: 'switch_provider_preset', detail: 'The selected provider route rejected image generation.', next: 'Switch the provider preset before authorizing a new call.' }),
  provider_authentication_failed: Object.freeze({ outcome: 'known', retryHint: 'check_provider_credentials', detail: 'The provider rejected the configured credentials.', next: 'Check provider credentials before authorizing a new call.' }),
  provider_quota_or_payment_required: Object.freeze({ outcome: 'known', retryHint: 'check_provider_quota', detail: 'The provider reported unavailable quota or required payment.', next: 'Check the provider account quota before authorizing a new call.' }),
  provider_rate_limited: Object.freeze({ outcome: 'known', retryHint: 'wait_before_new_call', detail: 'The provider temporarily rate-limited the request.', next: 'Wait before authorizing a new call.' }),
  provider_request_rejected: Object.freeze({ outcome: 'known', retryHint: 'review_provider_preset', detail: 'The provider rejected the submitted request.', next: 'Review the selected provider preset before authorizing a new call.' }),
  provider_service_unavailable: Object.freeze({ outcome: 'known', retryHint: 'review_provider_status', detail: 'The provider returned a service error.', next: 'Review provider status before authorizing a new call.' }),
  provider_output_invalid: Object.freeze({ outcome: 'known', retryHint: 'inspect_provider_output_contract', detail: 'The provider response did not contain a usable image.', next: 'Inspect the provider output contract before authorizing a new call.' }),
  provider_candidate_invalid: Object.freeze({ outcome: 'known', retryHint: 'inspect_provider_output_contract', detail: 'The returned image could not produce a valid repair candidate.', next: 'Inspect the provider output contract before authorizing a new call.' }),
  provider_unavailable: Object.freeze({ outcome: 'known', retryHint: 'configure_provider', detail: 'The selected provider is unavailable.', next: 'Configure a provider before authorizing a new call.' }),
  provider_configuration_error: Object.freeze({ outcome: 'known', retryHint: 'check_provider_configuration', detail: 'The provider configuration is invalid.', next: 'Check provider configuration before authorizing a new call.' }),
  transport_outcome_unknown: Object.freeze({ outcome: 'unknown', retryHint: null, detail: 'The remote result could not be confirmed. Recover the original operation; no call will be retried automatically.', next: null }),
  provider_failed: Object.freeze({ outcome: 'unknown', retryHint: null, detail: 'The provider failure could not be classified safely. Recover the original operation; no call will be retried automatically.', next: null }),
})

function safeProviderDiagnostic(job) {
  if (!job || typeof job.reason !== 'string' || job.reason.length === 0) return null
  const requestedReason = Object.hasOwn(PROVIDER_DIAGNOSTIC_COPY, job.reason)
    ? job.reason
    : 'provider_failed'
  const requested = PROVIDER_DIAGNOSTIC_COPY[requestedReason]
  const outcomeUnknown = job.recovery_state === 'outcome_unknown'
  const reason = (requested.outcome === 'unknown') === outcomeUnknown
    ? requestedReason
    : 'provider_failed'
  const definition = PROVIDER_DIAGNOSTIC_COPY[reason]
  const label = definition.outcome === 'unknown' ? 'Outcome unknown' : 'Known provider failure'
  const next = job.retry_hint === definition.retryHint ? definition.next : null
  return Object.freeze({
    tone: definition.outcome,
    state: `${label} · ${reason}`,
    detail: definition.detail,
    next,
    announcement: `${label}. ${reason}. ${definition.detail}${next ? ` Next check. ${next}` : ''}`,
  })
}
```

This helper must not read `job.message`, `remote_message`, response text, headers, paths, or any field other than `reason`, `retry_hint`, and `recovery_state`.

- [ ] **Step 4: Add stable diagnostic DOM and render behavior**

Replace the Processing-body construction with:

```js
  const processingBody = stageNodes.get('processing').body
  const processing = node(documentRef, 'p', 'editor-frame-repair-processing')
  const diagnostic = node(documentRef, 'div', 'editor-frame-repair-diagnostic')
  diagnostic.hidden = true
  const diagnosticTitle = node(documentRef, 'p', 'editor-frame-repair-diagnostic-title', 'Safe diagnostic')
  const diagnosticState = node(documentRef, 'p', 'editor-frame-repair-diagnostic-state')
  const diagnosticDetail = node(documentRef, 'p', 'editor-frame-repair-diagnostic-detail')
  const diagnosticNext = node(documentRef, 'p', 'editor-frame-repair-diagnostic-next')
  diagnostic.append(diagnosticTitle, diagnosticState, diagnosticDetail, diagnosticNext)
  const processingNote = node(
    documentRef,
    'p',
    'editor-frame-repair-note',
    'Closing keeps the operation recoverable; it does not cancel or retry a submitted provider call.',
  )
  const recover = node(documentRef, 'button', 'secondary', 'Recover original operation')
  recover.type = 'button'
  recover.dataset.frameRepairAction = 'recover'
  recover.hidden = true
  processingBody.append(processing, diagnostic, processingNote, recover)
```

Inside `render`, remove the early assignment:

```js
live.textContent = view.announcement ?? view.message ?? ''
```

Then replace the current Job/Processing render block with:

```js
    const job = view.job
    processing.textContent = job
      ? `Job ${valueText(job.id)} · ${valueText(job.status)} · provider calls ${job.provider_calls_used ?? 0} / ${job.provider_call_budget ?? 1}`
      : 'No provider call has been submitted.'
    const providerDiagnostic = safeProviderDiagnostic(job)
    diagnostic.hidden = providerDiagnostic === null
    if (providerDiagnostic) {
      diagnostic.dataset.tone = providerDiagnostic.tone
      diagnosticState.textContent = providerDiagnostic.state
      diagnosticDetail.textContent = providerDiagnostic.detail
      diagnosticNext.hidden = providerDiagnostic.next === null
      diagnosticNext.textContent = providerDiagnostic.next ? `Next check · ${providerDiagnostic.next}` : ''
    } else {
      delete diagnostic.dataset.tone
      diagnosticState.textContent = ''
      diagnosticDetail.textContent = ''
      diagnosticNext.hidden = true
      diagnosticNext.textContent = ''
    }
    const baseAnnouncement = view.announcement ?? view.message ?? ''
    live.textContent = providerDiagnostic
      ? `${baseAnnouncement} ${providerDiagnostic.announcement}`.trim()
      : baseAnnouncement
    recover.hidden = view.uiState !== 'outcome_unknown'
    setDisabled(recover, view.uiState !== 'outcome_unknown', view.uiState === 'outcome_unknown' ? null : 'Recovery is only available for an uncertain original operation', 'Recover original operation')
```

Do not add a click handler, Retry action, extra live region, or server-provided free-text node.

- [ ] **Step 5: Add bounded responsive diagnostic styles**

Insert this block after the existing Frame Repair paragraph styles in `src/ui/editor/editor.css`:

```css
.editor-frame-repair-diagnostic {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid rgba(255, 207, 136, 0.42);
  border-radius: 6px;
  background: rgba(255, 207, 136, 0.08);
  overflow-wrap: anywhere;
}

.editor-frame-repair-diagnostic[hidden] {
  display: none;
}

.editor-frame-repair-diagnostic[data-tone="unknown"] {
  border-color: rgba(255, 139, 139, 0.48);
  background: rgba(255, 139, 139, 0.09);
}

.editor-frame-repair-diagnostic-title,
.editor-frame-repair-diagnostic-state,
.editor-frame-repair-diagnostic-detail,
.editor-frame-repair-diagnostic-next {
  min-width: 0;
  margin: 0;
  color: #d9e2e5;
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.editor-frame-repair-diagnostic-title {
  color: #eef2f3;
  font-weight: 700;
}

.editor-frame-repair-diagnostic-state,
.editor-frame-repair-diagnostic-next {
  color: #ffcf88;
}

.editor-frame-repair-diagnostic[data-tone="unknown"] .editor-frame-repair-diagnostic-state {
  color: #ffaaaa;
}
```

Do not alter the rail grid, drawer width, stage scroller, media query, or global page height.

- [ ] **Step 6: Run focused UI verification**

Run:

```bash
npm run test:focused -- test/editor-project/editorFrameRepairPanel.test.js test/editor-project/editorShellStructure.test.js test/editor-project/editorRepairWorkbenchPanel.test.js
```

Expected: all tests pass, `fail 0`; the diagnostic uses one live region, no Retry button, local text only, and bounded CSS markers.

- [ ] **Step 7: Commit the UI unit**

Run:

```bash
git diff --check
git status --short
git add -- src/ui/editor/frameRepairPanel.js src/ui/editor/editor.css test/editor-project/editorFrameRepairPanel.test.js test/editor-project/editorShellStructure.test.js
git diff --cached --check
git commit -m "feat: show safe frame repair diagnostics"
```

Expected: only the Panel, CSS, and their two tests are committed.

## Task 4: Document Protocol And Operator Handling

**Files:**
- Modify: `docs/protocols/editor-frame-repair-v1.md:228-245`
- Modify: `docs/runbooks/targeted-frame-repair-v1.md:318-end`

- [ ] **Step 1: Add the normative safe-diagnostic protocol section**

Insert this section between `Public Job Statuses` and `Fixed Evidence Filenames` in `editor-frame-repair-v1.md`:

```markdown
### Safe Provider Failure Diagnostics

Frame Repair persists provider diagnostics only through the existing `reason`,
`retry_hint`, `provider_outcome`, and `recovery_state` fields. It never persists
or publishes a remote message, response body, request payload, credential,
header, stack, or local path.

| reason | Structured source | provider_outcome | retry_hint |
| --- | --- | --- | --- |
| `provider_safety_filter` | controlled safety status | `known` | null |
| `provider_route_blocked` | controlled route status or HTTP 403 | `known` | `switch_provider_preset` |
| `provider_authentication_failed` | HTTP 401 | `known` | `check_provider_credentials` |
| `provider_quota_or_payment_required` | HTTP 402 | `known` | `check_provider_quota` |
| `provider_rate_limited` | HTTP 429 | `known` | `wait_before_new_call` |
| `provider_request_rejected` | other HTTP 4xx | `known` | `review_provider_preset` |
| `provider_service_unavailable` | HTTP 5xx | `known` | `review_provider_status` |
| `provider_output_invalid` | controlled unusable provider response | `known` | `inspect_provider_output_contract` |
| `provider_candidate_invalid` | controlled unusable normalized candidate | `known` | `inspect_provider_output_contract` |
| `provider_unavailable` | selected provider unavailable | `known` | `configure_provider` |
| `provider_configuration_error` | invalid provider configuration | `known` | `check_provider_configuration` |
| `transport_outcome_unknown` | allowlisted transport uncertainty without an HTTP response | `unknown` | null |
| `provider_failed` | no safe classification | `unknown` | null |

`retry_hint` is operator guidance, not retry authorization. The application
does not retry, fall back, refund the call, or create another candidate. Any
intentional new call requires a new provider-free Review, a new operation id,
and a separate explicit confirmation.
```

- [ ] **Step 2: Add the dated runbook addendum**

Append this section to `targeted-frame-repair-v1.md`:

```markdown
## 10. 2026-07-12 Bounded Live Pilot And Safe Diagnostics

A later, separately authorized pilot used one synthetic managed Character Pack
fixture, one selected `walk_down` frame, one bounded mask, the `gemini31`
preset, and exactly one provider call. The operation recorded one used call out
of one, ended `failed_model_error`, produced no candidate, did not retry during
recovery, and left project revision 2, active revision `rev_001`, project JSON,
history, and selection unchanged.

The historical record persisted only `provider_failed` with an unknown outcome,
so the exact remote cause cannot be reconstructed and must not be inferred.
Future Frame Repair operations preserve only the safe structured taxonomy in
the protocol. The Processing rail shows fixed local copy for those codes and
never displays remote free text.

Operator handling remains conservative:

- known authentication, quota, route, rate, request, service, and output
  failures may show a local next-check hint;
- transport and generic unknown outcomes require recovery of the original
  operation before any new decision;
- no hint, recovery action, refresh, close, or project switch authorizes a new
  provider call;
- another live request requires separate human authorization and the normal
  provider-free Review plus one-call confirmation flow.
```

- [ ] **Step 3: Check and commit the documentation contract**

Run:

```bash
git diff --check
rg -n "provider_authentication_failed|transport_outcome_unknown|separate human authorization" docs/protocols/editor-frame-repair-v1.md docs/runbooks/targeted-frame-repair-v1.md
git status --short
git add -- docs/protocols/editor-frame-repair-v1.md docs/runbooks/targeted-frame-repair-v1.md
git diff --cached --check
git commit -m "docs: document safe frame repair diagnostics"
```

Expected: the protocol table and dated runbook addendum are present; no code or artifact file is staged.

## Task 5: Verify Once, Close The Design, And Stop

**Files:**
- Modify after verification: `docs/superpowers/specs/2026-07-12-frame-repair-safe-provider-diagnostics-design.md:3-4`

- [ ] **Step 1: Run the complete focused diagnostic set**

Run exactly one focused command:

```bash
npm run test:focused -- test/editor-project/editorFrameRepairProviderDiagnostics.test.js test/editor-project/editorFrameRepairService.test.js test/editor-project/editorFrameRepairOperationLedger.test.js test/editor-project/editorFrameRepairPanel.test.js test/editor-project/editorShellStructure.test.js test/editor-project/editorRepairWorkbenchPanel.test.js
```

Expected: exit 0, `fail 0`, no timeout/RSS breach, and no provider network call.

- [ ] **Step 2: Audit protected boundaries and raw-text access**

Run:

```bash
git diff --check
if git diff --name-only main...HEAD | rg '^(src/character-pack/providers/|server\.js$|package(-lock)?\.json$|ATTRIBUTIONS\.md$)'; then exit 1; fi
rg -n "error\.message|response_body|headers|apiKey|fetch\(" src/editor-project/frameRepairProviderDiagnostics.js
rg -n "job\.message|remote_message|innerHTML" src/ui/editor/frameRepairPanel.js
rg -n "generateCandidate\(" src/editor-project/frameRepairService.js
```

Expected:

- the protected-file command exits 0 with no matched path;
- the classifier raw-text/network scan has no output;
- the Panel raw-text/injection scan has no output;
- the service scan shows exactly the existing single dispatch site.

- [ ] **Step 3: Run the full suite once**

Run:

```bash
npm test
```

Expected: all tests pass with `fail 0`; the resource guard completes below 4096 MiB RSS and the 900-second timeout. If it breaches, hangs, or fails, stop and diagnose the smallest failing test. Do not rerun the full suite automatically.

- [ ] **Step 4: Run one tracked local smoke and stop its exact server**

Start one tracked server session:

```bash
npm run guard:focused -- node server.js
```

Expected: the server reports `http://localhost:4173`; its process tree is capped at 1536 MiB and 60 seconds.

While that exact session is active, run:

```bash
npm run smoke:local -- --base-url http://127.0.0.1:4173
```

Expected: `V8 local smoke passed`, exit 0, and no provider generation call.

Send Ctrl-C to the tracked server session immediately after smoke, then run:

```bash
lsof -nP -iTCP:4173 -sTCP:LISTEN
```

Expected: no listener output. Do not leave a detached server or browser process.

- [ ] **Step 5: Mark the approved design implemented only after every gate passes**

In the design spec, replace:

```markdown
**Status:** User-approved design; implementation not started
```

with:

```markdown
**Status:** Implemented and verified
```

Do not change this status if any focused, full, smoke, security, protected-file, or resource gate is incomplete.

- [ ] **Step 6: Commit the verified closeout**

Run:

```bash
git diff --check
git status --short
git add -- docs/superpowers/specs/2026-07-12-frame-repair-safe-provider-diagnostics-design.md
git diff --cached --check
git commit -m "docs: close safe frame repair diagnostics"
git status -sb
git log -6 --oneline --decorate
```

Expected: the closeout commit contains only the design status change; the worktree is clean on `codex/frame-repair-safe-diagnostics`.

## Final Acceptance Checklist

- [ ] All new classifier outputs are frozen controlled tokens/nulls.
- [ ] No classifier branch reads free-text provider content or an accessor property.
- [ ] Public Job and durable ledger diagnostics match exactly.
- [ ] Known HTTP/provider failures and unknown transport outcomes remain distinct.
- [ ] Every dispatched failure records one used call out of one and never replays.
- [ ] Processing UI displays only local allowlisted copy and one polite live announcement.
- [ ] Unknown reason/hint values collapse without reflection.
- [ ] There is no Retry button, automatic retry, fallback, refund, or extra candidate.
- [ ] Provider modules, server routes, project schema, job enum, package files, and attribution remain unchanged.
- [ ] Focused tests, full tests, smoke, static audits, and resource guards pass.
- [ ] No real provider call was made during implementation or verification.
