# Editor Frame Repair Quality Gate v1 Protocol

**Status:** Implemented protocol; deterministic closeout evidence is recorded separately

**Scope:** Provider-budgeted, eight-case quality evidence around the existing
single-frame Repair workflow in Editor Workspace

**Live-quality status:** Unverified until a separately authorized live session
publishes a complete report

This protocol defines an append-only quality-gate layer around the existing
Editor Frame Repair v1 contract. It does not add a provider dispatcher, batch
route, retry path, fallback, Job status, or project field. Setup is the only new
project-creating operation. Plan, Start, Get, Review, Outcome, and Finalize are
provider-free. The existing explicit Frame Repair Generate action remains the
only provider-call authority, and the existing specialized Frame Repair Accept
route remains the only authority that may add an accepted child revision.

## 1. Fixed Protocol Identifiers

Exactly seven evidence protocol identifiers exist:

| Identifier | Fixed evidence |
| --- | --- |
| `frame_repair_quality_gate_setup_v1` | One Setup manifest for the isolated target project |
| `frame_repair_quality_gate_plan_v1` | One canonical sealed session plan |
| `frame_repair_quality_gate_blind_order_v1` | One deterministic A/B mapping |
| `frame_repair_quality_gate_review_v1` | At most one immutable review per reviewable case |
| `frame_repair_quality_gate_outcome_v1` | At most one immutable terminal outcome per case |
| `frame_repair_quality_gate_report_v1` | One final aggregate JSON report |
| `frame_repair_quality_gate_artifact_manifest_v1` | One final size/SHA-256 manifest |

These identifiers are evidence schema versions. They do not change
`editor_project_v0`, the existing Frame Repair plan version, or the global Job
status enum.

## 2. API Routes And Effects

All POST bodies are exact plain JSON objects and are limited to **128 KiB of
incoming UTF-8 bytes before JSON parsing**. Extra, missing, accessor, sparse,
or inherited fields are rejected. Route identities are encoded URL segments
and are validated before use.

| Method and route | Success | Provider calls | Project mutation |
| --- | ---: | ---: | --- |
| `POST /api/editor/projects/:sourceProjectId/frame-repair-quality-gates/setup` | `201` | 0 | Exclusively creates one new isolated target project |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates/plan` | `200` | 0 | None; write-free |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates` | `201` | 0 | None; seals plan and blind order |
| `GET /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId` | `200` | 0 | None |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId/cases/:caseId/review` | `200` | 0 | None |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId/cases/:caseId/outcome` | `200` | 0 | None beyond a specialized Accept that already completed |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId/finalize` | `200` | 0 | None |

No quality-gate route accepts a provider request or calls the existing Frame
Repair submission authority.

## 3. Exact Request Envelopes

### 3.1 Setup

```json
{
  "expectedRevision": 12,
  "targetProjectId": "project_frame_repair_gate_20260712",
  "targetProjectName": "Frame Repair Quality Gate 2026-07-12",
  "ownershipConfirmed": true,
  "sourceAssets": [
    {
      "caseId": "real_shape_01",
      "assetId": "asset_forest_hero",
      "expectedAssetRevisionId": "rev_003"
    },
    {
      "caseId": "real_detail_02",
      "assetId": "asset_copper_scout",
      "expectedAssetRevisionId": "rev_002"
    },
    {
      "caseId": "real_anchor_03",
      "assetId": "asset_moss_mage",
      "expectedAssetRevisionId": "rev_004"
    },
    {
      "caseId": "real_facing_04",
      "assetId": "asset_river_guard",
      "expectedAssetRevisionId": "rev_001"
    },
    {
      "caseId": "real_semantic_05",
      "assetId": "asset_night_alchemist",
      "expectedAssetRevisionId": "rev_003"
    },
    {
      "caseId": "real_continuity_06",
      "assetId": "asset_ember_ranger",
      "expectedAssetRevisionId": "rev_002"
    }
  ]
}
```

The array has exactly six distinct case ids, asset ids, and asset/revision
tuples, all from the named source project at `expectedRevision`. Every source
must be an eligible managed Character Pack active revision. Ownership must be
the literal boolean `true`. The source project id and target project id must
differ.

A successful response is exactly the existing validated `project` projection,
an ordered eight-entry `mapping`, and `setupManifestSha256`. Each mapping entry
has `caseId`, nullable `sourceAssetId`/`sourceRevisionId`, `targetAssetId`,
`targetRevisionId`, and `ownershipClass`. The two repository controls have null
source ids; the six owned inputs keep their explicit source identities.

### 3.2 Plan

The Plan body has exactly these seven top-level keys:

```json
{
  "sessionId": "frqg_20260712_primary",
  "expectedRevision": 1,
  "setupManifestSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "providerPresetId": "one_exact_existing_preset",
  "imageConfig": { "image_size": "1K" },
  "maxProviderCalls": 8,
  "cases": []
}
```

`cases` is not optional or empty in a valid request. It contains exactly eight
objects, each with exactly:

```json
{
  "caseId": "control_outline_alpha",
  "assetId": "asset_qg_control_outline_alpha",
  "expectedAssetRevisionId": "rev_001",
  "clipId": "walk_down",
  "clipFramePosition": 1,
  "sheetFrameIndex": 17,
  "instruction": "Repair the broken outline and alpha edge only.",
  "maskEdits": [
    { "op": "add_rectangle", "x": 39, "y": 48, "width": 12, "height": 18 }
  ],
  "difficulty": "basic",
  "defectCategory": "outline_alpha_edge",
  "expectedImprovement": "The silhouette edge is continuous without changing pixels outside the mask."
}
```

The eight cases have distinct case and asset ids, exactly two `basic`, four
`medium`, and two `hard` difficulties, and exactly one of each category:
`outline_alpha_edge`, `small_component`, `shape`, `detail`,
`anchor_baseline`, `facing_consistency`, `semantic_reconstruction`, and
`neighbor_continuity`. The two control definitions must match the repository
defaults exactly. `image_size` is `1K` or `2K`; one preset and one image size
apply to the entire session.

Plan reloads the exact Setup manifest, re-resolves all eight Frame Repair plans
sequentially, requires `can_run === true`, and returns the canonical
`frame_repair_quality_gate_plan_v1` document. It creates no session directory,
operation, job, or provider call.

### 3.3 Start

Start uses the Plan route body unchanged and adds exactly:

```json
{
  "expectedPlanHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "confirmSessionStart": true
}
```

The complete Start body therefore has exactly nine top-level keys. The server
recomputes Plan; a changed hash is `stale_quality_gate_plan`. A successful
response is `{ "plan", "blindOrder", "evidence" }`, where `evidence` contains
only `plan_sha256` and `blind_order_sha256`. Start writes no project state and
uses no provider.

### 3.4 Get

Get has no body. It returns exactly `{ session, cases, artifacts,
allowedArtifactUrls }`. The session projection includes id, target project and
revision, initial revision, plan hash, preset, image size, derived status,
controlled blocking reason, and calls used/remaining. Each case includes its
sealed identity, locked repair/classification projection, blind mapping,
derived status, safe operation projection, review/outcome flags, successful
candidate classification, and controlled evidence URLs. The server addresses
the eight planned operation ids and fixed case files directly; it never lists
operation or artifact roots.

### 3.5 Review

```json
{
  "expectedPlanHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "expectedCaseHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "operationId": "frqgop_0123456789abcdef0123456789abcdef0123456789abcdef",
  "jobId": "existing_frame_repair_job",
  "blindChoice": "prefer_b",
  "improvement": "improved",
  "usability": "usable",
  "newBlockingDefect": false,
  "reasonCodes": ["outline_repaired"],
  "note": "Optional NFC-normalized local note."
}
```

Blind choice is `prefer_a`, `prefer_b`, or `no_material_difference`.
Improvement is `improved`, `same`, or `worse`; usability is `usable`,
`review_required`, or `blocked`. Reason codes are distinct, limited to 16, and
come from the fixed protocol list. `note` is null or at most 500 Unicode code
points. Review requires a hydrated candidate, the exact durable operation/job,
complete sealed evidence, and non-blocking automated hard gates.

Success returns `{ "sha256", "review" }`. The first successful writer owns the
server timestamp; a semantically identical repeat returns that winner.

### 3.6 Outcome

```json
{
  "expectedPlanHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "expectedCaseHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "operationId": "frqgop_0123456789abcdef0123456789abcdef0123456789abcdef",
  "jobId": "existing_frame_repair_job",
  "expectedReviewSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "outcome": "accepted",
  "expectedProjectRevision": 2,
  "acceptedRevisionId": "rev_002"
}
```

Nullable-field combinations are exact:

| `outcome` | `jobId` | `expectedReviewSha256` | `acceptedRevisionId` | Persistence |
| --- | --- | --- | --- | --- |
| `accepted` | Required | Required | Required | Terminal outcome file |
| `rejected` | Required | Required | null | Terminal outcome file |
| `quality_blocked` | Required | null | null | Terminal outcome file |
| `provider_blocked` | **Required durable job id** | null | null | Terminal outcome file |
| `outcome_unknown` | null | null | null | Pause marker only; no outcome file |

`provider_blocked` is valid only when the planned durable operation resolves to
that exact job, the job produced no candidate, and its reason is in the
controlled known-provider taxonomy. A reserved operation without a durable job
cannot be sealed as `provider_blocked`. Unknown transport/provider outcomes
must remain `outcome_unknown` and recover the original operation.

Accepted and rejected outcomes bind the exact review digest. Accepted also
binds the already-created specialized-Accept child revision. Success returns
`{ "sha256", "outcome" }`; `outcome_unknown` instead returns the current safe
session view.

### 3.7 Finalize

```json
{
  "expectedPlanHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "expectedRevision": 4,
  "confirmFinalize": true
}
```

Finalize requires the literal boolean `true`, verifies the current accepted
revision chain, and publishes the aggregate evidence. Its response contains
the four final artifact digests, the report, artifact manifest, and refreshed
safe view. It never invokes a provider or mutates the project.

## 4. Scalar And Collection Limits

- Session ids match `^frqg_[a-z0-9][a-z0-9_-]{15,79}$`.
- Case ids are lower-case safe ids of at most 64 ASCII characters.
- Project, asset, revision, clip, and preset ids are lower-case safe ids of at
  most 80 ASCII characters.
- Operation ids are 16–80 safe characters at the request boundary; sealed
  quality-gate operations are `frqgop_` plus 48 lowercase hexadecimal digits.
- Setup project names are at most 160 Unicode code points.
- Instructions and expected-improvement text are NFC-normalized, trimmed,
  non-empty, control-free, and at most 500 Unicode code points.
- Notes are null or NFC/control-free text of at most 500 Unicode code points.
- Each case has at most 64 ordered `add_rectangle`/`remove_rectangle` edits,
  each wholly within the 96×96 frame.
- Reason codes are distinct and limited to 16.
- SHA-256 values are 64 lowercase hexadecimal digits.

Every unexpected field is rejected, including client path, file, binary,
credential, provider runtime, provider request, prompt, retry, and encoded
image fields. Controlled errors never echo rejected values.

## 5. Setup Authority And The 6+2 Boundary

Setup captures six explicit active revisions from one explicitly named source
project while holding the source-project mutation lock. It verifies the five
managed artifact classes `sheet`, `animations`, `metadata`,
`editor_metadata`, and `debug_report`, plus the optional declared processing
recipe authority, before reserving the target. Captured source bytes are capped
by the existing per-artifact limits and a 128 MiB aggregate six-source ceiling.
An eligible source revision may retain other repository-known Character Pack
artifact authorities, such as import previews and export bundles, but Setup
does not read, hash, copy, or publish them. Unknown artifact keys, unsafe paths,
or incomplete five-class authority remain integrity failures.

Repository code then builds exactly two deterministic original controls:
`control_outline_alpha` and `control_small_component`. All eight inputs pass
through the same verified Character Pack import authority and become distinct
`rev_001` assets in a new target project at revision 1.

The target project directory must not exist in any form. Setup publishes
`project.json` only after all eight imports, source revalidation, and exclusive
Setup-manifest publication succeed. Any target directory or Setup evidence
collision is a conflict. If a failure leaves an unpublished target directory
or a Setup manifest without `project.json`, that orphan is retained for manual
inspection, is never reused, and is never automatically deleted. A later
attempt must use a new target id.

Setup is the only new quality-gate project mutation. It never writes the source
project. Quality-gate metadata does not enter project JSON.

## 6. Canonical Identity And Revision Chain

Canonical serialization recursively sorts plain-object keys, preserves array
order, emits compact UTF-8 JSON, and hashes exact bytes with SHA-256.

Each case hash covers its display/asset/parent identity; frame/clip,
instruction, ordered mask and their digests; ownership, difficulty, category,
expected improvement; source, parent sheet, target frame and reference-context
digests; preset, image size, and per-case call ceiling. It excludes mutable
current project revision and runtime operation/job state.

The server reserves the deterministic operation identity:

```text
frqgop_ + first48(sha256(sessionId + NUL + caseId + NUL + caseHash))
```

Reservation in the sealed plan is not an operation ledger record and consumes
zero calls. The session hash covers the Setup-manifest digest, implementation
revision, initial target project revision/projection, preset/image size, call
budget, ordered sealed cases, case hashes, and planned operation ids. It
excludes timestamps and mutable runtime state.

After each accepted case, the outcome records exact before/after project
revisions and server-derived project-projection hashes. The next case is
authorized only when the current project matches the chain of prior accepted
outcomes. The server never derives the next revision by adding an acceptance
count. Any unrelated asset, scene, settings, flow, revision, or artifact
change pauses the session.

## 7. Blind Review, Hard Gates, And Human Classification

`blind_order.json` fixes either A=before/B=after or the inverse for every case.
Before choice, the browser exposes only A/B. After `prefer_a`, `prefer_b`, or
`no_material_difference` is recorded, the mapping is revealed for the
functional verdict.

Review recomputes and seals these server facts:

- plan/case/operation/job identity complete;
- Frame Repair manifest verified;
- decoded pixels outside the canonical mask equal, with zero changed count;
- candidate and composited frame available;
- quality evidence complete;
- validator status and controlled blocking errors;
- bbox, anchor, baseline, halo, component, and neighboring continuity evidence;
- revision chain valid and no unrelated project mutation;
- exactly one provider call for a reviewable candidate;
- controlled non-blocking warnings.

Incomplete, unknown, mismatched, or blocking evidence cannot enter human
review. `warning` may proceed only when the underlying evidence is complete and
non-blocking.

A reviewed candidate is successful only when hard gates are not blocked,
`improvement === "improved"`, usability is `usable` or `review_required`, and
`newBlockingDefect === false`. Accept/Reject is a separate isolated-project
decision and does not change that numerator.

## 8. Provider Taxonomy, Calls, And Pauses

Known no-candidate reasons eligible for a durable `provider_blocked` outcome
are:

- `provider_safety_filter`
- `provider_route_blocked`
- `provider_unavailable`
- `provider_configuration_error`
- `provider_output_invalid`
- `provider_candidate_invalid`
- `provider_authentication_failed`
- `provider_quota_or_payment_required`
- `provider_rate_limited`
- `provider_request_rejected`
- `provider_service_unavailable`

`transport_outcome_unknown` and `provider_failed` remain unknown. They pause
and permit only recovery of the original durable operation; they cannot be
converted to `provider_blocked` without a later known terminal authority.

Call accounting is derived from the exact durable operations/outcomes:

| Action | Calls |
| --- | ---: |
| Setup, provider preflight, Plan, Start, Get | 0 |
| Existing per-case Frame Repair Plan | 0 |
| Existing explicit Generate | At most 1 for that case |
| Recover, Review, Accept, Reject, Outcome, Finalize | 0 |
| Session ceiling | 8 |

A planned operation with no ledger record contributes zero. A dispatched
uncertain call still contributes one. More than one call in a case or more than
eight total is an immediate safety pause/failure. `provider_safety_filter` is
also an immediate safety pause/failure. Two consecutive terminal no-candidate
cases trigger `provider_conservation_pause`; there is no automatic resume or
next-case generation.

## 9. Append-Only Evidence

Setup evidence is fixed at:

```text
frame-repair-quality-gates/setup_<target-project-id>/setup_manifest.json
```

Session evidence is fixed under
`frame-repair-quality-gates/<session-id>/`:

| Filename | Protocol | Maximum bytes |
| --- | --- | ---: |
| `session_plan.json` | `frame_repair_quality_gate_plan_v1` | 512 KiB |
| `blind_order.json` | `frame_repair_quality_gate_blind_order_v1` | 64 KiB |
| `case_<case-id>_review.json` | `frame_repair_quality_gate_review_v1` | 128 KiB |
| `case_<case-id>_outcome.json` | `frame_repair_quality_gate_outcome_v1` | 128 KiB |
| `frame_repair_quality_gate.json` | `frame_repair_quality_gate_report_v1` | 512 KiB |
| `frame_repair_quality_gate.md` | Derived controlled Markdown | 256 KiB |
| `frame_repair_quality_gate_contact_sheet.png` | Deterministic 1536×512 PNG | 16 MiB |
| `artifact_manifest.json` | `frame_repair_quality_gate_artifact_manifest_v1` | 128 KiB |

`setup_manifest.json` is limited to 512 KiB. Files use exclusive creation,
captured-byte size/SHA-256 verification, exact schema validation, and direct
fixed-name reads. Nothing is discovered by enumerating artifact roots.

The first writer wins. A byte-identical plan/finalization repeat, or a
semantically identical review/outcome repeat excluding the server timestamp,
returns the persisted winner without rewriting. A different repeat is
`evidence_conflict`. Once final report creation starts, no new review or
outcome may be written. Partial finalization resumes only with identical bytes.
No evidence file is overwritten or automatically deleted.

The final manifest sorts entries and records exactly `{ file_name, size,
sha256 }` for plan, blind order, existing case records, report JSON, Markdown,
and contact sheet. It excludes itself and contains no root or URL.

## 10. Recovery Semantics

- Refresh, close, project switch, and Get are provider-free and never enqueue.
- A response-lost Generate recovers only the exact planned operation id. It
  never allocates a second id or automatically submits again.
- `outcome_unknown` writes no terminal evidence and keeps the session paused
  until the original operation is recovered.
- Known no-candidate evidence may be sealed as `provider_blocked` only with the
  exact durable job id and controlled reason.
- A lost review/outcome response may repeat the same semantic provider-free
  write and receive the first persisted winner.
- If specialized Accept completed but outcome recording failed, recovery loads
  the exact target project/child revision, verifies the sealed review and job,
  and repeats only the provider-free accepted outcome. Generate and Accept are
  not repeated.
- Integrity, revision-chain, path, collision, short-write, digest, schema, or
  resource failures pause; they do not overwrite, repair, or delete evidence.
- Identical Finalize recovery may complete missing final files. Different
  evidence conflicts.

## 11. Aggregate Decision

For completed reviewable candidates:

```text
required_successes = ceil(0.70 * completed_candidates)
visual_pass = successful_candidates >= required_successes
```

The final `result` is exactly:

- `quality_failed` with `failure_domain: "safety"` immediately when any
  integrity, accounting, hard-gate, project-chain, or provider safety failure
  exists;
- `evidence_insufficient` when no safety failure exists but fewer than six
  candidates completed, any case remains unresolved, or not all eight terminal
  outcomes exist;
- `passed` when all eight outcomes are terminal, at least six candidates
  completed, no safety failure exists, calls used are at most eight, and the
  integer success threshold is met;
- otherwise `quality_failed` with `failure_domain: "visual_quality"`.

`provider_blocked` is a controlled cause, not a fourth result. The report
publishes the numerator, denominator, required integer, rate, calls,
difficulty/category breakdowns, terminal counts, hard-gate taxonomy, controlled
provider taxonomy, exact preset, and session-plan hash.

## 12. Security, Privacy, And Compatibility

Public requests, safe views, project JSON, evidence, and browser recovery state
contain no provider credentials/runtime object, raw remote text, request or
response body, header, environment field, stack, absolute path, Buffer, or
encoded image bytes. Reviewer notes remain only in exact review JSON and never
enter provider input, Markdown, or contact-sheet labels.

The browser recovery handle is non-authoritative and contains only safe ids,
hashes, revision, and pending review/outcome identities. Server evidence and
the private durable operation ledger remain authoritative after refresh.

The ordinary Frame Repair UI and API remain available. Existing Generate,
operation recovery, polling, specialized Accept, Character Pack processing,
exporters, providers, project schema, and all seven Job statuses retain their
existing contracts. No live quality or production-readiness claim follows from
implementing or deterministically testing this protocol.

## 13. Controlled HTTP Errors

| HTTP | Quality-gate errors |
| ---: | --- |
| `400` | Invalid exact request/plan/review/outcome/evidence, unexpected field, or unsafe artifact path |
| `404` | Missing project, asset, revision, job, artifact, Setup manifest, session, case, or operation |
| `409` | Existing target, revision conflict, stale plan, reused session id, identity mismatch, ambiguous accepted outcome, evidence conflict, or evidence-integrity conflict |
| `413` | Request exceeds 128 KiB |
| `422` | Artifact-integrity failure, hard-gate failure, paused session, or finalized session |
| `503` | Quality-gate coordinator, selected provider, or provider configuration unavailable |

Error responses expose only a machine-readable `error`, controlled `reason`,
and optional already-sanitized scalar/list `details`. They never reflect the
rejected input.
