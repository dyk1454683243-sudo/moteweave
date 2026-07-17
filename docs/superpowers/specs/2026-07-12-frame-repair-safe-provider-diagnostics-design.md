# Frame Repair Safe Provider Diagnostics Design

**Date:** 2026-07-12
**Status:** Implemented and verified
**Branch base:** `main` at `b96c129`
**Design branch:** `codex/frame-repair-safe-diagnostics`
**Product surface:** Editor Character Finishing Workbench / Frame Repair
**Provider quota:** No live provider call is authorized by this design
**Approved amendment:** 2026-07-14 normalization subtype and sanitized
failure-preview evidence

## Summary

Add safe, actionable provider-failure diagnostics to the existing Frame Repair
Processing stage without changing its one-call contract. The Editor will map
structured provider error metadata to a small allowlist of diagnostic codes,
persist those codes through the existing `reason` and `retry_hint` fields, and
show fixed local explanatory text in the UI.

The change does not expose remote error messages, response bodies, credentials,
paths, or request payloads. It does not add a Retry button, automatic retry,
provider fallback, a new provider call, a new API field, or a project-format
change.

```text
provider adapter error
-> Editor-only structured classifier
-> existing Frame Repair failure transition
-> existing ledger reason / retry_hint
-> existing public Job reason / retry_hint
-> local allowlisted Processing diagnostic copy
```

## Design Sources And Verified Evidence

### Product and UI source of truth

The merged Frame Repair implementation on `main` is the source of truth. The
relevant accepted lineage includes:

- `27417da`: one-call Frame Repair service;
- `9e05bea`: durable plan and operation coordination;
- `b8bc726`: Frame Repair controller and Canvas integration;
- `4b85c97`: four-stage Frame Repair Workbench UI;
- `b96c129`: merged Targeted Frame Repair v1.

No external product, bundle, code, UI, wording, prompt, or asset is a design
source for this change.

### Verified facts

1. A strictly bounded live pilot used exactly one provider call. Its job ended
   as `failed_model_error`, with `provider_calls_used: 1`,
   `provider_call_budget: 1`, `reason: provider_failed`, no candidate, and
   `provider_outcome: unknown`. Recovery did not dispatch another call.
2. The parent project revision and active Character Pack revision remained
   unchanged after that failure.
3. The OpenRouter and Gemini adapters attach structured fields such as an HTTP
   status, failure status, controlled status, or retry hint to several failure
   shapes.
4. `frameRepairService.js` currently collapses most provider failures to
   `provider_failed`, even when structured metadata is present.
5. The durable operation ledger and public Job already carry `reason` and
   `retry_hint`. Their existing safe text constraints accept the proposed
   lowercase diagnostic tokens.
6. `frameRepairPanel.js` currently shows job status and call accounting but not
   the Job's controlled `reason` or `retry_hint`.

### Reasonable inference

The Editor failure boundary is too lossy for useful diagnosis: it discards
safe structured distinctions before durable and public publication. Improving
that boundary should make future failures diagnosable without weakening the
one-call or privacy contracts.

### Not verified

- The exact remote cause of the completed live pilot cannot be reconstructed.
  Its persisted record contains only `provider_failed`; this design must not
  relabel that historical operation after the fact.
- A future provider may return a failure shape not covered by the initial
  allowlist. Such failures must remain conservative and generic.
- This design does not claim that a provider route, account, quota, or model is
  currently healthy.

### 2026-07-14 approved amendment evidence

A separately authorized fixed-region repair operation,
`job_mrjeg44c_2d4dk0`, used exactly one Gemini call and received one image
candidate, but local normalization ended as `provider_candidate_invalid`. The
then-current implementation preserved only the generic
`inspect_provider_output_contract` hint and wrote no failure image, so the
exact normalization subtype for that historical job cannot be reconstructed
and must not be guessed. Recovery and inspection used no second provider call,
and the managed project and active asset revision remained unchanged.

The user then explicitly approved a narrow extension for future normalization
failures:

- preserve one of four exact local normalization codes through the existing
  `retry_hint` field;
- write a fixed safe JSON diagnostic and, only when local decoding succeeds, a
  freshly re-encoded bounded PNG preview inside the already reserved failed-job
  directory;
- never persist the original remote bytes, remote text, request, prompt,
  headers, credential, or raw response;
- keep the preview as operator evidence only, not a candidate, managed asset,
  Accept input, registered manifest entry, or active UI control;
- keep the original terminal failure if evidence capture itself fails.

This amendment authorizes no provider call. Its implementation and tests use
only deterministic local fixtures.

## Goals

1. Preserve safe distinctions for authentication, quota/payment, routing,
   rate limiting, request rejection, service unavailability, invalid provider
   output, transport uncertainty, and unknown failure.
2. Show a compact read-only diagnostic in the existing Processing stage.
3. Keep every public value allowlisted and independent of remote free text.
4. Keep known provider rejection separate from unknown remote outcome.
5. Preserve the exact one-call budget, durable recovery behavior, immutable
   parent revision, and explicit authorization requirement for any new call.
6. Make the classification and UI mapping deterministic and provider-free in
   automated tests.

## Non-goals

- No automatic or implicit retry.
- No Retry button or one-click provider resubmission.
- No provider fallback or preset switching performed by the application.
- No additional candidate or quota consumption.
- No raw provider message, response body, request body, headers, credentials,
  model payload, local path, or stack trace in the ledger, API, project, UI, or
  browser state.
- No changes to `src/character-pack/providers/*`.
- No new server endpoint, public Job field, job status, ledger version, project
  JSON field, dependency, asset, or attribution.
- No retroactive reclassification of already persisted operations.

## Alternatives Considered

### A. Existing fields plus Editor-only classification and UI (selected)

Reuse `reason` and `retry_hint`, classify only structured allowlisted metadata,
and render fixed local copy. This is the smallest change that gives the user a
useful diagnosis without expanding public contracts.

### B. Add a `provider_diagnostic` public object

This could expose category and status class separately, but it would expand the
ledger, public Job, API validation, recovery, and acceptance surface. The
existing fields are sufficient, so the added protocol risk is unjustified.

### C. Record classification only in backend logs

This would be simpler but would leave the user unable to understand the failure
from the Frame Repair UI. It does not meet the approved product goal.

## Architecture And Component Boundaries

### Editor-only classifier

Add a small pure module under `src/editor-project/`. Its conceptual interface
is:

```js
classifyFrameRepairProviderFailure(error, { unusableProviderOutput })
// -> {
//   jobStatus,
//   reason,
//   retryHint,
//   providerOutcome,
//   recoveryState,
// }
```

The classifier:

- performs no I/O;
- imports no provider adapter;
- never reads `error.message`, stack traces, response text, headers, request
  data, or environment variables;
- reads only allowlisted structured scalar fields, including `code`,
  `failure_status`, `status`, `http_status`, `retry_hint`, `outcomeUnknown`,
  `name`, and an allowlisted network `cause.code` when present;
- returns a newly created frozen object containing only controlled tokens and
  nulls;
- does not mutate or decorate the incoming error, including frozen errors.

`frameRepairService.js` delegates its provider-phase branch to this classifier.
All reservation, preflight, composite, package, writer, and queue failure
behavior stays unchanged.

### Protected provider boundary

`src/character-pack/providers/*` remains unchanged. The Editor wrapper may
continue receiving the adapters' current error objects, but only the new
Editor classifier decides what crosses into the Frame Repair ledger and public
Job.

### Existing persistence and API boundary

The service continues to write only the existing fields:

- `job_status` / public `status`;
- `reason`;
- `retry_hint`;
- `provider_outcome`;
- `recovery_state`;
- existing call accounting.

No raw source field is retained. Recovery reads the same durable record and
must reproduce the same safe diagnostic without dispatching a provider call.

## Classification Contract

Classification precedence is deterministic:

1. known safety and existing Frame Repair provider-domain codes;
2. allowlisted `failure_status` values;
3. numeric HTTP response status;
4. the adapters' structured invalid-image response shape;
5. explicit or allowlisted transport uncertainty;
6. conservative unknown fallback.

An explicit HTTP error response is a known failed request for this synchronous
image contract. A connection interruption with no definite response remains an
unknown remote outcome.

| Public `reason` | Structured condition | Outcome | `retry_hint` |
| --- | --- | --- | --- |
| `provider_safety_filter` | `failed_safety_filter` or `safety_filter` | known | null |
| `provider_route_blocked` | controlled route-block status or HTTP 403 | known | `switch_provider_preset` |
| `provider_authentication_failed` | HTTP 401 | known | `check_provider_credentials` |
| `provider_quota_or_payment_required` | HTTP 402 | known | `check_provider_quota` |
| `provider_rate_limited` | HTTP 429 | known | `wait_before_new_call` |
| `provider_request_rejected` | other HTTP 4xx | known | `review_provider_preset` |
| `provider_service_unavailable` | HTTP 5xx | known | `review_provider_status` |
| `provider_output_invalid` | existing output-invalid code or structured adapter no-image result | known | `inspect_provider_output_contract` |
| `provider_candidate_invalid` | unusable normalized candidate without an allowlisted subtype | known | `inspect_provider_output_contract` |
| `provider_unavailable` | existing unavailable code | known | `configure_provider` |
| `provider_configuration_error` | existing configuration code | known | `check_provider_configuration` |
| `transport_outcome_unknown` | explicit unknown outcome, abort/timeout, or allowlisted network cause code without HTTP response | unknown | null |
| `provider_failed` | no safe classification | unknown | null |

The initial network-code allowlist may include only stable runtime tokens such
as `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, and `ETIMEDOUT`.
Unrecognized values do not cross the boundary and fall back to
`provider_failed`.

`retry_hint` is an operator remediation pointer, not permission to retry. A new
provider call still requires a new reviewed Plan and explicit human
authorization.

For future normalization failures only, the approved amendment uses this exact
subtype allowlist while retaining public `reason: provider_candidate_invalid`:

| Local normalization code | Existing `retry_hint` field |
| --- | --- |
| `provider_output_invalid` | `inspect_provider_output_invalid` |
| `provider_output_full_sheet` | `inspect_provider_output_full_sheet` |
| `provider_output_empty` | `inspect_provider_output_empty` |
| `provider_output_multiple_subjects` | `inspect_provider_output_multiple_subjects` |

Prefix matching is forbidden. Any other code follows the ordinary local
normalization-failure path and cannot trigger provider-subtype publication or
failure-preview capture.

## Post-Pilot Provider Request Evidence Extension

After a later one-call native Gemini attempt ended with an unreconstructable
transport outcome, the same unregistered `provider_failure.json` completion
marker is extended to version 2. A provider-phase failure records only a fixed
stage, controlled reason and outcome, an allowlisted error name, an allowlisted
connection code, and an integer HTTP status. It records null when no safe value
is available. It never records an error message, response text, request, URL,
headers, credential, stack, path, or raw payload, and it never writes a preview
for a provider-request failure.

Normalization failures use the same version-2 key set with provider-request
fields set to null and retain their allowlisted normalization code plus optional
freshly re-encoded preview. The public Job, API, ledger version, UI controls,
call accounting, recovery behavior, and managed-asset contracts remain
unchanged. Evidence capture is best-effort and cannot replace the original
terminal result or authorize retry.

## Sanitized Failure Evidence Amendment

Evidence capture runs after a provider-phase failure or after the service has
validated that one provider candidate exists and an allowlisted local
normalizer rejects it. It is best-effort and precedes publication of the same
terminal failure.

The exact failed-job directory may contain only these additional fixed files:

| Fixed file | Contract |
| --- | --- |
| `provider_failure.json` | Last-written version-2 completion marker containing only job identity, fixed stage/reason/outcome, allowlisted error name and connection code, integer HTTP status, allowlisted normalization code, `raw_provider_payload_persisted: false`, and optional preview metadata. Inapplicable fields are null. |
| `provider_failure_preview.png` | Optional normalization-only image decoded from the candidate and freshly encoded as PNG; never the original response bytes. |

The normalization preview pipeline accepts at most 32 MiB of candidate input,
limits decode to 4096 x 4096 pixels, applies orientation, fits without
enlargement inside 1024 x 1024 with nearest-neighbor sampling, ensures alpha,
encodes PNG, and rejects an encoded result above 16 MiB. Undecodable input and
all provider-request failures produce `preview: null` and no PNG. Both files
use exclusive no-follow writes with mode 0600 after revalidating the reserved
job directory identity. The JSON is written last, so it is the only completion
marker.

No public Job field, API response field, registered artifact key,
browser-facing URL field, preview link, or retry control is added. Existing
static generated-file serving is unchanged; the UI renders only fixed local
subtype text. Failed evidence is never accepted or copied into a managed asset.

## Recovery And Call Accounting

- Provider call budget remains exactly one.
- The call is still recorded as used before dispatch, preserving the existing
  duplicate-prevention contract.
- Known failures finish with `provider_outcome: known` and no
  `outcome_unknown` recovery state.
- Transport and generic unknown failures finish with
  `provider_outcome: unknown` and `recovery_state: outcome_unknown`.
- `Recover original operation` performs the existing lookup only. It does not
  poll a different job, re-plan, retry, refund, or dispatch.
- Closing, refreshing, switching selection, or recovering cannot create a
  second provider call.

## Processing UI

Add one compact read-only diagnostic block immediately below the existing Job
status/call-accounting line and above the existing closing/recovery note.

Known-failure example:

```text
Safe diagnostic
Known provider failure · provider_rate_limited
Provider temporarily rejected the request rate.
Next check · Wait before authorizing a new call.
```

Unknown-outcome example:

```text
Safe diagnostic
Outcome unknown · transport_outcome_unknown
The remote result could not be confirmed. Recover the original operation;
no call will be retried automatically.
```

### Rendering rules

- Hide the block when `job.reason` is absent.
- Map recognized `reason` values to fixed English copy because the current
  Editor UI is English.
- Display only an exact locally approved reason/hint pair. Ignore arbitrary or
  mismatched `retry_hint` values.
- Collapse any unrecognized public reason to the local generic
  `provider_failed` presentation instead of reflecting the unknown token.
- Distinguish `Known provider failure` and `Outcome unknown` with both text and
  tone; never rely on color alone.
- Use `overflow-wrap` and the existing bounded stage scroller. The diagnostic
  must not create horizontal overflow at desktop or narrow widths.
- Do not add a button. The existing `Recover original operation` button remains
  visible only for `outcome_unknown`.
- Known failures retain the existing Review/Discard/Close behavior. Any future
  call still requires the existing explicit Generate confirmation.

### Accessibility

The visible diagnostic text is also appended to the existing polite atomic
Frame Repair live announcement. No competing live region is added. The
diagnostic order follows the visual reading order, and the code is selectable
plain text rather than a focusable control.

## Capability Truth And Design Deviations

| Surface | Capability truth after this change |
| --- | --- |
| Safe structured failure classification | Active for future Frame Repair failures covered by the allowlist. |
| Historical live pilot exact cause | Unavailable; remains `provider_failed` and is not rewritten. |
| Historical 2026-07-14 normalization subtype | Unavailable; the generic persisted record is not rewritten. |
| Raw remote diagnostics | Intentionally unavailable in UI and public records; original failure bytes are never written. |
| Sanitized failure preview | Active only for future allowlisted normalization failures when bounded local decode succeeds; operator evidence only. |
| Automatic retry | Not implemented; no active control is shown. |
| Manual new provider call | Existing reviewed one-call flow only; requires separate authorization. |
| Provider health or quota check | Not implemented; hints are guidance, not a live health claim. |

The approved design and 2026-07-14 amendment add information inside the
existing Processing stage and do not change the four-stage layout, Canvas,
filmstrip, Recipe drawer model, or narrow-screen drawer behavior. The new
job-local sanitized preview is the recorded capability deviation from the
original expected-file list; no visual-layout or interaction deviation is
approved. Any further implementation deviation must be recorded in this
document before completion.

## Security And Privacy Requirements

1. No output may contain a substring copied from `error.message`, response
   text, stack, headers, request data, credentials, or local paths.
2. Classification must be exact allowlist matching, not regex inference over
   remote prose.
3. Diagnostic values must satisfy the current lowercase token validation.
4. UI copy must be local constants and assigned with `textContent`; no raw HTML
   injection is allowed.
5. Provider keys remain server-side and do not enter the browser, project, or
   ledger.
6. Existing durable ledger safety, immutable project behavior, and controlled
   path rules remain unchanged.
7. Failure evidence must use only fixed filenames, an exact allowlisted
   normalization code, the existing validated job identity and timestamp, and
   bounded re-encoding. It must never write the original candidate buffer.

## Test-Driven Implementation Plan Boundary

Implementation must begin with failing focused tests and the smallest relevant
guarded command.

### Classifier tests

- existing safety, route, unavailable, configuration, output-invalid, and
  candidate-invalid codes;
- HTTP 401, 402, 403, 429, other 4xx, and 5xx;
- structured adapter no-image result;
- abort, timeout, allowlisted network cause, explicit unknown outcome, and
  generic unknown error;
- frozen input errors remain unchanged;
- hostile message, secret, path, data URL, response body, and stack fixtures do
  not appear anywhere in returned values.

### Service tests

- public Job and durable ledger contain the same controlled reason and hint;
- known versus unknown provider outcome and recovery state are correct;
- every dispatched failure remains `provider_calls_used: 1` of budget 1;
- recovery performs no provider call and preserves the original diagnostic;
- there is no retry or fallback after any classified failure;
- unrelated post-processing failures remain unchanged.

### Panel tests

- known failure renders the approved label, code, fixed copy, and exact hint;
- unknown outcome renders conservative copy and the existing Recover action;
- unrecognized reason and mismatched hint collapse safely;
- raw hostile fields are never rendered;
- no Retry button exists;
- live announcement contains the concise safe diagnosis;
- narrow layout keeps bounded width and wrapping styles.

## Expected Implementation Files

- new pure classifier under `src/editor-project/`;
- `src/editor-project/frameRepairService.js`;
- `src/ui/editor/frameRepairPanel.js`;
- `src/ui/editor/editor.css`;
- new focused classifier test;
- existing Frame Repair service and panel tests;
- `docs/protocols/editor-frame-repair-v1.md`;
- `docs/runbooks/targeted-frame-repair-v1.md`.

No provider module, server route, project schema, exporter, validator, or
dependency file is expected to change.

## Verification And Resource Safety

All commands must use the checked-in process-tree resource guard. Only one test
runner may be active.

1. Run focused classifier, service, and panel tests serially with
   `npm run test:focused -- <explicit files>`.
2. Run `git diff --check` and review the complete diff.
3. Run one complete `npm test` after implementation.
4. Run `npm run smoke:local` after the full suite completes.
5. Confirm no provider call, browser live generation, detached server, or
   unbounded process was started.

The clean worktree baseline passed 1185 tests under the full guard. Peak
process-tree RSS was 3,981,296 KiB, below but close to the 4,096 MiB ceiling.
Therefore full suites must not overlap or be repeated without a diagnosed
reason.

## Acceptance Criteria

- Future structured Provider failures publish the approved safe diagnostic.
- Unknown failures stay honest and recoverable without a second call.
- The UI explains the failure class without displaying remote free text.
- There is no automatic retry, Retry button, fallback, quota refund, or
  additional provider call.
- Existing API fields, job states, ledger version, project JSON, parent
  revision, and provider modules remain unchanged.
- Focused tests, full tests, smoke, diff checks, and security assertions pass
  within the repository resource limits.
