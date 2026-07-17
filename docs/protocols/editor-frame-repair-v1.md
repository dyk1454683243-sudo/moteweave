# Editor Frame Repair v1 Protocol

**Status:** Approved contract
**Scope:** Targeted repair of one managed Character Pack frame through the
local Editor Workspace API

This protocol defines the public request, job, evidence, recovery, and
acceptance boundaries for `editor_character_frame_repair`. Plan is
provider-free. Live generation is one explicitly confirmed provider call for
one candidate. Project state remains unchanged until specialized Accept
successfully imports the sealed result as an immutable child revision.

## Request Envelopes

Every request body is an exact plain JSON object. Aliases, omitted fields, and
additional fields are rejected. Request JSON may not contain a client path,
base64 data URL, secret-like key or value, provider credential, binary payload,
or client-owned provider request body.

### Provider-free Plan

```http
POST /api/editor/projects/:projectId/assets/:assetId/frame-repair/plan
```

```json
{
  "expectedRevision": 4,
  "expectedAssetRevisionId": "rev_003",
  "clipId": "walk_down",
  "clipFramePosition": 1,
  "sheetFrameIndex": 17,
  "instruction": "repair the left hand",
  "maskEdits": [
    { "op": "add_rectangle", "x": 10, "y": 12, "width": 8, "height": 9 },
    { "op": "remove_rectangle", "x": 12, "y": 14, "width": 2, "height": 3 }
  ],
  "providerPresetId": "gemini-default",
  "imageConfig": { "image_size": "1K" }
}
```

`expectedRevision`, `clipFramePosition`, and `sheetFrameIndex` are
non-negative integers. Revision, clip, and preset identifiers use managed
Editor id syntax. The instruction is required, trimmed, normalized to NFC,
contains no Unicode control characters, and is at most 500 Unicode code
points. `image_size` is exactly `1K` or `2K`.

`maskEdits` preserves request order and contains at most 64 operations. Each
operation has exactly `op`, `x`, `y`, `width`, and `height`. `op` is
`add_rectangle` or `remove_rectangle`; `x` and `y` are non-negative integers;
`width` and `height` are positive integers. The later authority step rejects a
rectangle outside the resolved frame rather than clipping it.

A successful Plan returns `200` with the canonical plan, lowercase
`plan_hash`, canonical mask, safe provider/model/call summary, `can_run`, and
preflight diagnostics. Planning creates no provider job, consumes zero calls,
does not write the operation ledger, and does not mutate project JSON, project
history, an asset revision, or an existing generated job directory.

### Confirmed live request

```http
POST /api/editor/projects/:projectId/assets/:assetId/frame-repair
```

The body repeats every Plan field exactly and adds these four fields:

```json
{
  "operationId": "fr_0123456789abcdef",
  "expectedPlanHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "confirmLiveGeneration": true,
  "maxProviderCalls": 1
}
```

The complete live body therefore has exactly 13 fields. `operationId` matches
`^[A-Za-z0-9_-]{16,80}$`. `expectedPlanHash` is a lowercase 64-character
SHA-256 hexadecimal digest. Confirmation is the boolean `true`, and the call
budget is the number `1`; aliases and every other value are rejected before
enqueue or dispatch.

The server re-resolves managed authority and rebuilds the canonical plan. A
hash change is `stale_plan` and consumes no provider call. The first exact
submission atomically binds the operation to project, asset, parent revision,
and plan hash, then returns `202` with one public job. An exact replay returns
the same recorded job with `202`; it neither enqueues nor spends a second call.
Rebinding the operation id to another scope or plan is `operation_conflict`.
An intentional retry requires a new Review Call, confirmation, plan, and
operation id.

Immediately before dispatch, the durable account changes from zero calls used
to one. A failed, cancelled, response-lost, or otherwise uncertain dispatched
request still counts as one used call. There is no quota refund, fallback,
automatic retry, or second candidate. A successful terminal job has a budget
of one, one used call, and one generated candidate.

### Specialized Accept

```http
POST /api/editor/projects/:projectId/assets/:assetId/frame-repair/:jobId/accept
```

```json
{
  "expectedRevision": 4,
  "expectedAssetRevisionId": "rev_003",
  "expectedPlanHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "warningConfirmed": false
}
```

Accept requires exactly these four fields. Revision is a non-negative integer,
the asset revision id is valid, the plan hash is lowercase SHA-256, and
`warningConfirmed` is a boolean. A warning result requires `true` bound to the
exact job and full plan hash. `false` remains the correct value for a strict
pass.

The route returns `200` only after revalidating the completed job, private
ledger identity, plan, Context, two-level sealed manifest, parent sheet,
decoded-pixel integrity, quality, project revision, and active asset revision
inside the existing project-keyed mutation lock. Acceptance copies the exact
verified job into one immutable child revision with
`processing_recipe_ref: null`. It does not rerun processing.

The general `import-job` route must reject
`editor_character_frame_repair` with `specialized_accept_required`, including
after restart when the fixed Context marker is the available defense. Existing
frame, action, and local reprocess routes retain their behavior.

## Recovery Route

```http
GET /api/editor/projects/:projectId/assets/:assetId/frame-repair/operations/:operationId
```

The operation id uses the same exact syntax as live submission. The route
returns `200` with the recorded sanitized public job for the exact project and
asset scope, or `404 operation_not_found`. It is provider-free and never
enqueues. Clients use it after losing the original `202` or after refresh;
loading a recovery handle must never issue another live POST. After restart,
the route uses the private ledger and sealed generated evidence. A dispatched
non-terminal record is reported as an uncertain outcome, not retried.

## Canonical Mask Schema

```ts
type CanonicalFrameMask = {
  width: number
  height: number
  source:
    | 'localized_diagnostic'
    | 'localized_plus_user_edits'
    | 'user_scoped'
  confidence: 'high' | 'needs_scope' | 'user_confirmed'
  runs: Array<{ start: number; length: number }>
  activePixelCount: number
  sha256: string
}
```

Dimensions are positive integers and `activePixelCount` is a non-negative
integer appropriate to the resolved frame. Runs use flattened row-major pixel indices and are sorted,
non-overlapping, positive-length, and in bounds. The lowercase SHA-256 binds
width, height, and canonical runs through stable serialization. An unchanged
non-empty diagnostic is `localized_diagnostic`/`high`; an edited diagnostic is
`localized_plus_user_edits`/`user_confirmed`; a mask created without a
diagnostic base is `user_scoped`/`user_confirmed`. An empty mask cannot produce
a runnable live plan and reports `invalid_mask`; a display-only suggestion is
not authoritative mask data.

## Canonical Plan Schema

```ts
type FrameRepairPlanV1 = {
  version: 'frame_repair_plan_v1'
  project: { id: string; revision: number }
  asset: { id: string; parent_revision_id: string }
  profile: { id: string; frame_size: { w: number; h: number } }
  clip: {
    id: string
    frames: number[]
    position: number
    sheet_frame_index: number
    context_frames: Array<{
      position: number
      sheet_frame_index: number
      sha256: string
    }>
  }
  parent_sheet_sha256: string
  target_frame_sha256: string
  references: {
    input_reference_roles: string[]
    context_sha256: string
    items: Array<{ role: string; name: string; sha256: string }>
  }
  mask: CanonicalFrameMask
  instruction: string
  provider: {
    id: string
    provider: string
    label: string
    model: string
    image_config: {
      aspect_ratio: string
      image_size: '1K' | '2K'
    }
  }
  estimated_provider_calls: 1
  max_provider_calls: 1
  implementation_revision: string
}
```

The plan binds the formal project revision, managed parent, registered profile
and frame size, exact clip position and sheet frame, ordered clip/context
frames, parent and decoded-frame digests, ordered reference roles and digests,
canonical mask, normalized instruction, safe preset snapshot, fixed call
accounting, and server implementation revision. It contains no provider key,
image bytes, arbitrary path, raw request, or private runtime configuration.

New live Plans use exactly three ordered provider references:
`target_enlarged`, `mask_visualization`, and `clip_context`. The first image is
the only output-layout authority. All three references use the same nearest-
neighbor-enlarged authoring-cell geometry. `clip_context` contains one adjacent
frame rather than a multi-frame contact sheet; the previous frame is preferred,
otherwise the next frame is used, with the target used only for a degenerate
single-frame clip. The managed full sheet remains server-side authority for
identity, hashing, compositing, validation, and Accept, but is not sent to the
provider. Readers continue to accept already sealed legacy evidence whose
ordered role list includes the optional trailing `full_sheet`; historical
evidence is never rewritten.

Serialization recursively sorts object keys, preserves array order, uses
compact `JSON.stringify` encoded as UTF-8, and computes a lowercase SHA-256.
Only the server-computed full plan hash authorizes live submission and Accept.

## Public Job Statuses

Frame Repair uses all seven existing `JOB_STATUS` values unchanged:

| Status | Meaning in Frame Repair |
| --- | --- |
| `queued` | The existing shared queue owns the reserved job. |
| `generating` | The single provider request is in its generation phase. |
| `post_processing` | Local decode, mask composite, validation, packaging, or evidence sealing is running. |
| `done` | One candidate and its required sealed evidence completed. |
| `failed_safety_filter` | The provider safety boundary rejected the request or result. |
| `failed_model_error` | The single provider attempt failed or returned unusable model output. |
| `failed_post_processing` | Local composite, validation, packaging, or evidence writing failed. |

`outcome_unknown`, `stale_plan`, `selection_switched`, and acceptance states are
session, recovery, or protocol states; they do not add job-status values.

### Safe Provider Failure Diagnostics

Frame Repair's durable operation record and public Job persist provider
diagnostics only through the existing `reason`, `retry_hint`,
`provider_outcome`, and `recovery_state` fields. They never persist or publish a
remote message, response body, request payload, credential, header, stack, or
local path. A failed-job directory may separately retain the bounded sanitized
normalization evidence defined below; original provider response bytes are
never written.

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
| `provider_candidate_invalid` | controlled unusable normalized candidate without an allowlisted subtype | `known` | `inspect_provider_output_contract` |
| `provider_unavailable` | selected provider unavailable | `known` | `configure_provider` |
| `provider_configuration_error` | invalid provider configuration | `known` | `check_provider_configuration` |
| `transport_outcome_unknown` | allowlisted transport uncertainty without an HTTP response | `unknown` | null |
| `provider_failed` | no safe classification | `unknown` | null |

`retry_hint` is operator guidance, not retry authorization. The application
does not retry, fall back, refund the call, or create another candidate. Any
intentional new call requires a new provider-free Review, a new operation id,
and a separate explicit confirmation.

For an allowlisted local normalization failure, `reason` remains
`provider_candidate_invalid` and `retry_hint` preserves the exact safe subtype:

| Local normalization code | retry_hint |
| --- | --- |
| `provider_output_invalid` | `inspect_provider_output_invalid` |
| `provider_output_full_sheet` | `inspect_provider_output_full_sheet` |
| `provider_output_empty` | `inspect_provider_output_empty` |
| `provider_output_multiple_subjects` | `inspect_provider_output_multiple_subjects` |

Only exact matches are classified. No prefix, remote prose, or provider-owned
value may select a subtype.

### Provider Failure Evidence

After the one-call provider phase fails, or after one validated candidate is
rejected by an allowlisted local normalizer code, the already reserved job
directory may contain:

| Fixed filename | Presence and content |
| --- | --- |
| `provider_failure.json` | Required completion marker when capture succeeds. Version 2 contains only job identity, fixed failure stage/reason/outcome, an allowlisted error name and connection code, an integer HTTP status, an allowlisted normalization code, `raw_provider_payload_persisted: false`, and optional preview metadata. Inapplicable fields are null. |
| `provider_failure_preview.png` | Optional freshly decoded and re-encoded PNG for an allowlisted normalization failure only. Absent for provider-request failures and when candidate input cannot be decoded safely. |

The only recorded error names are `Error`, `TypeError`, `AbortError`, and
`TimeoutError`. The only recorded connection codes are `ECONNABORTED`,
`ECONNRESET`, `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`, `ENOTFOUND`,
`EAI_AGAIN`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`,
`UND_ERR_HEADERS_TIMEOUT`, and `UND_ERR_SOCKET`. HTTP status is either an
integer from 100 through 599 or null. Exact allowlist matching is mandatory;
unknown values become null.

An allowlisted error name may come from a data descriptor on the error or its
bounded prototype chain so native `Error` and `TypeError` instances retain
their built-in name. The classifier never invokes a `name` getter. An
accessor, proxy failure, prototype cycle, excessive depth, or non-allowlisted
value produces null. It still never reads or persists the error message,
stack, provider response, request, or credentials.

For normalization evidence, the writer accepts at most 32 MiB of candidate
input, limits decode to 4096 x 4096 pixels, fits without enlargement inside
1024 x 1024, and rejects a preview above 16 MiB. For provider-request evidence,
it writes JSON only. Both paths use exclusive no-follow writes with mode 0600
and write the JSON last. They never write the original candidate buffer, error
message, remote text, prompt, request, URL, headers, credentials, response body,
stack, path, or raw response.

These files are unregistered operator evidence: they add no public Job or API
field, manifest key, UI link, candidate, import path, Accept input, or managed
asset. Capture failure does not replace or reopen the terminal one-call result.
The preview does not authorize retry; a new call still requires the normal new
Review and explicit confirmation.

## Fixed Evidence Filenames

The sealed public job manifest uses only these registered fixed filenames:

| Registered key | Fixed filename |
| --- | --- |
| `source` | `source.png` |
| `source_layout_overlay` | `source_layout_overlay.png` |
| `sheet` | `normalized_sheet.png` |
| `multi_resolution` | `multi_resolution.json` |
| `sheet_96` | `normalized_sheet_96.png` |
| `sheet_64` | `normalized_sheet_64.png` |
| `sheet_48` | `normalized_sheet_48.png` |
| `sheet_32` | `normalized_sheet_32.png` |
| `sheet_16` | `normalized_sheet_16.png` |
| `animations` | `animations.json` |
| `metadata` | `metadata.json` |
| `editor_metadata` | `editor_metadata.json` |
| `debug_report` | `debug_report.json` |
| `debug_overlay` | `debug_overlay.png` |
| `onion_skin_overlay` | `onion_skin_overlay.png` |
| `inspection_index` | `inspection_index.json` |
| `inspection_sheet` | `inspection_sheet.png` |
| `godot_npc_zip` | `godot_npc_pack.zip` |
| `rpgmaker_zip` | `rpgmaker_pack.zip` |
| `ocad_zip` | `ocad_pack.zip` |
| `zip` | `character_pack.zip` |
| `frame_repair_plan` | `frame_repair_plan.json` |
| `frame_repair_context` | `editor_frame_repair_context.json` |
| `target_before` | `target_before.png` |
| `frame_repair_mask` | `frame_repair_mask.png` |
| `frame_repair_context_image` | `frame_repair_context.png` |
| `raw_provider_output` | `raw_provider_output.png` |
| `normalized_candidate_frame` | `normalized_candidate_frame.png` |
| `composited_candidate_frame` | `composited_candidate_frame.png` |
| `frame_repair_difference` | `frame_repair_difference.png` |
| `frame_repair_quality` | `frame_repair_quality.json` |
| `frame_repair_prompt` | `frame_repair_prompt.txt` |
| `patched_normalized_sheet` | `patched_normalized_sheet.png` |

The outer manifest seals every entry, including Context. Context holds an
inner manifest sealing every other required entry, avoiding a self-hash while
cross-binding all evidence. Generated URLs are derived from registered keys;
callers cannot submit or retrieve arbitrary filesystem paths. Dynamic Row GIF
and inspection-preview files may remain inside the sealed Character Pack ZIP,
but are not standalone managed child artifacts in v1.

Specialized Accept copies the verified standard pack and the registered plan,
Context, mask, normalized/composited candidate, difference, and quality
evidence. Raw provider output and prompt remain generated evidence and are not
copied into the managed child in v1.

## Controlled Errors And HTTP Statuses

Responses keep a stable machine-readable `error` code separate from safe
`reason` and `retry_hint` text. They never echo rejected values, provider
credentials, request bodies, buffers, or filesystem paths.

| HTTP status | Controlled codes and conditions |
| --- | --- |
| `400` | `invalid_frame_repair_request`, `invalid_accept_request`, `unexpected_request_field`, `invalid_frame_repair_mask`, `frame_identity_mismatch`, and other malformed exact-envelope or managed-input values. |
| `404` | `operation_not_found` and an existing project, asset, revision, job, or required artifact not found. |
| `409` | `stale_plan`, `operation_conflict`, project revision conflict, asset revision conflict, or another exact identity conflict. |
| `422` | `quality_blocked`, missing warning confirmation, failed/unknown quality, decoded-pixel integrity failure, sealed-artifact integrity failure, or incomplete acceptance evidence. |
| `503` | `frame_repair_unavailable`, `provider_unavailable`, or `provider_configuration_error`. |

Plan preflight diagnostics such as `invalid_mask` and `provider_unavailable`
may accompany a successful provider-free `200` with `can_run: false`; they do
not spend a call. The API wiring owns HTTP mapping. The protocol validator
throws `FrameRepairError` with controlled codes and safe messages only.

## Private Ledger And Mutation Boundary

The durable operation ledger is rooted at
`workspace/.operations/frame-repair/`. It is server-private, is outside the
statically served `/generated` tree, and is not a registered artifact route.
It is not part of `editor_project_v0`, project autosave, project history, an
asset revision, or an exported Editor project pack. Records contain only safe
scope, operation, job, plan, status, call-count, timestamp, and detached
manifest-digest fields. They contain no instruction, prompt, secret, provider
request, image bytes, client path, source path, or artifact content.

Mask editing, Plan, live processing, polling, recovery, failure, and discard do
not mutate the formal project or its immutable parent. Only a successful
specialized Accept may add and activate one verified child revision. Every
rejection, conflict, failed copy, failed save, or concurrent losing Accept
leaves project JSON unchanged; no failure automatically deletes historical or
orphaned evidence.
