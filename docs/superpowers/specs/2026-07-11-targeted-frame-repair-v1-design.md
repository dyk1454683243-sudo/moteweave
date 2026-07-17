# Targeted Frame Repair v1 Design

**Date:** 2026-07-11
**Status:** Implemented and verified (deterministic MVP; live first-call quality remains Experimental/opt-in)
**Implementation branch base:** main at 427d056
**Implementation commit range:** fa5e987 through 4b85c97
**Closeout evidence:** docs/runbooks/targeted-frame-repair-v1.md
**Roadmap classification:** Core for the deterministic MVP; live first-call quality remains Experimental/opt-in
**Design baseline:** `main` at `1bb606e`

## Summary

Add a single-frame, mask-constrained AI repair workflow inside the existing
Character Finishing Workbench. The workflow closes the current gap between
finding a bad frame and accepting a safely repaired immutable revision:

```text
select one real filmstrip frame
-> derive and refine a local mask
-> review one explicit provider call
-> generate one candidate
-> composite only inside the mask
-> compare and revalidate the complete animation
-> accept the exact job as one child revision, or discard it
```

The feature is local-first and provider-optional until the user confirms the
call. It does not become a pixel editor, does not replace the existing
whole-action repair flow, and does not mutate the project before specialized
acceptance.

### Verification boundary

The deterministic protocol, one-call accounting, mask composite, sealed
acceptance, recovery, Workbench UI, responsive behavior, and automated
contracts are implemented and verified. The configured real-render fixture had
no available provider preset, so browser verification stopped after the
provider-free Plan and spent no quota. Candidate/result/Accept browser evidence
remains an explicit closeout limitation; deterministic injected tests cover
those paths. Live visual quality remains Experimental/opt-in until the
separately authorized benchmark meets the documented threshold.

## Design Sources And Lineage

### Product and implementation source of truth

The merged Editor Workspace and Character Finishing Workbench on `main` are the
capability and UI source of truth. Relevant accepted ancestors are:

- `36eefaf`: Visual Repair Workspace;
- `58176ce`: Editor shell module split;
- `89cf7b2`: Editor Canvas Playtest MVP;
- `17d23f3`: focused Character Finishing Workbench;
- `ae5b69b`: Workbench state, browser, and smoke verification;
- `58ccf2c`: final Workbench runbook and current baseline.

All are ancestors of the selected baseline. No unmerged UI branch is required.

### User-approved visual exploration

The user approved three visual-companion decisions on 2026-07-11:

1. selecting `Repair Frame` temporarily switches the Workbench's right Recipe
   rail to a `Frame Repair` rail while Canvas and filmstrip stay in place;
2. the rail uses a four-stage progressive flow rather than one dense form or
   ambiguous tabs;
3. result review reuses the large Canvas's Before, After, Split, Difference,
   and Onion modes; the right rail shows validation and acceptance, and the
   filmstrip marks the repaired frame.

Local visual evidence:

- `.superpowers/brainstorm/4735-1783751584/content/frame-repair-layout-options.html`;
- `.superpowers/brainstorm/4735-1783751584/content/frame-repair-flow-options.html`;
- `.superpowers/brainstorm/4735-1783751584/content/frame-repair-result-review-options.html`.

These files are local design evidence only and must not be staged or shipped.

Approved desktop information architecture:

```text
+------------------------------------------------------+------------------+
| Before / After / Split / Difference / Onion Canvas   | Frame Repair     |
| selected frame + mask overlay                        | 1 Target & Mask  |
|                                                      | 2 Review Call    |
|                                                      | 3 Processing     |
|                                                      | 4 Result & Gate  |
+------------------------------------------------------+------------------+
| selected clip filmstrip; repaired frame badge; Play repaired clip       |
+-------------------------------------------------------------------------+
```

On narrow screens, the already-approved Recipe drawer becomes the Frame Repair
drawer. The feature does not introduce a second mobile navigation model.

### External reference and IP boundary

The roadmap already lists per-frame masked repair as a neutral workflow
Candidate. Public adjacent-product behavior may explain why local repair is
useful, but no external code, UI, wording, prompt, asset, template, mask
algorithm, or private behavior is a design source. All implementation and
product naming remain project-owned.

No new dependency, bundled model, external asset, or attribution is approved
by this design.

## Goals

1. Let a user repair one selected Character Pack frame without redrawing an
   otherwise-good action or sheet.
2. Keep local diagnostics, mask authoring, plan review, comparison, validation,
   and acceptance in one Workbench context.
3. Guarantee that every non-target frame and every target-frame pixel outside
   the approved mask remains unchanged in decoded RGBA space.
4. Make one confirmation create at most one provider request and one candidate.
5. Reuse existing provider presets, quota guards, job queue, artifact safety,
   project mutation lock, comparison Canvas, filmstrip, and immutable revision
   store.
6. Make provider failure, uncertain outcome, stale selection, quality failure,
   and integrity failure non-mutating and recoverable.
7. Measure real first-call quality before making a production-readiness claim.

## Non-goals

- No freehand brush, eraser, lasso, arbitrary polygon, pixel pencil, or full
  pixel editor.
- No multiple candidates, candidate blending, automatic retry, or automatic
  acceptance.
- No whole-action generation in this flow; the existing Action Repair remains
  separate.
- No layer decomposition, equipment system, skeletal rig, mesh deformation,
  or HD/non-pixel track.
- No reverse projection from a normalized runtime frame into a non-one-to-one
  fixed-region source sheet.
- No new provider family, provider fallback chain, model training, local model,
  or model-weight distribution.
- No project-format migration, cloud account, permission, billing, scene, tile,
  2.5D, or engine-runtime feature.
- No claim that local diagnostics automatically understand anatomy, props,
  facing, or action semantics.

## Capability Truth And Recorded Deviations

| Surface | Current capability | v1 treatment |
| --- | --- | --- |
| Real frame selection and animation clips | Implemented in Workbench filmstrip | Active; clip and actual sheet-frame identity are server-verified. |
| Canvas comparison modes and overlays | Implemented | Reused for mask and candidate review. |
| Local halo, alpha, component, bbox, anchor, and quality evidence | Implemented, with varying localization precision | Used to propose a mask only when localization is honest. |
| Semantic anatomy/prop/facing diagnosis | Not implemented | Never claimed. Show a bbox suggestion and require user scope/instruction. |
| Rectangle mask edits | Not implemented | New active capability with integer frame-space coordinates. |
| Freehand mask editing | Not implemented and outside product direction | Hidden. |
| Existing Action Repair | Implemented for whole actions/fixed source regions with explicit quota | Preserved separately; lower-level provider/queue behavior may be reused, but its endpoint and general-import behavior are not used. |
| One-frame provider generation | Provider adapters can request an image, but no Editor single-frame contract exists | New specialized service and evidence contract. |
| Inpainting/mask-native provider endpoint | Not implemented consistently across presets | Not required. The provider proposes a candidate; local code enforces the mask during composite. |
| Exact Preview/Accept | Implemented for local reprocess jobs | Mirrored through a separate frame-repair job type and specialized acceptance route. |
| Packaging an already-normalized sheet without changing pixels | Missing | New explicit backend adapter required; not treated as incidental UI polish. |
| Real-model first-call quality evidence | Not yet measured for this workflow | Feature remains evidence-limited until an explicitly authorized 8–12-case benchmark. |

The visual mockups used phrases such as “outside mask unchanged 100%.” The
normative contract means equality of decoded RGBA pixel bytes. PNG container
bytes may differ after deterministic re-encoding and are not the pixel
integrity metric.

## Core User Flow

### Entry And Exit

`Repair Frame` appears only when all of the following are true:

- a project is loaded and saved;
- a supported `character_pack` asset and active revision are selected;
- the current Workbench has a valid managed normalized sheet and animations;
- a real clip frame is selected;
- no Build, Accept, or other frame-repair mutation is in flight.

Entering Frame Repair preserves the Workbench Recipe draft, current comparison
view, clip, frame, zoom, pan, and overlay state. The Recipe rail is hidden, not
destroyed. Cancel, Discard, or successful acceptance returns to the prior
Workbench view. A project, asset, revision, or clip switch closes the frame
session through the normal stale-selection lifecycle.

### Stage 1: Target And Mask

The header shows read-only asset, parent revision, clip id, clip position, and
actual sheet-frame index.

The server derives one of two honest mask starting modes:

- `localized_diagnostic`: a non-empty base mask from deterministic local
  pixels such as alpha fringe, edge residue, or detached components;
- `needs_scope`: no active base mask. A subject/bbox rectangle may be shown as
  a visual suggestion, but it is not part of the repair mask until the user
  adds a rectangle.

Semantic issue labels may prefill a short instruction, but they never create a
high-confidence semantic mask. A valid plan requires a non-empty final mask.

The only editing operations are ordered `add_rectangle` and
`remove_rectangle`. Canvas pointer drag creates a rectangle; keyboard users can
focus the active rectangle and adjust x/y/width/height with labelled numeric
controls. Delete removes the selected edit. Undo applies only to local mask
operations and does not enter Editor project history.

The instruction is plain text, required after normalization, and limited to
500 Unicode characters. A diagnostic-generated instruction is editable and is
shown as a suggestion, not prior user input.

The context is derived, never client-selected by path:

- selected target frame;
- previous and next frames in the same clip when present;
- clip id, direction/semantic metadata, and ordered frame position;
- full normalized sheet as secondary identity context when supported by the
  selected preset's existing image-input contract.

### Stage 2: Review AI Call

A provider-free server plan must succeed before the call can be confirmed. The
rail displays:

- target asset/revision/clip/frame;
- final mask pixel count and percentage;
- mask source and scope status;
- normalized instruction;
- context frame ids;
- explicit provider preset, model label, and image configuration without any
  secret;
- estimated and maximum provider calls, both exactly `1`;
- canonical `plan_hash` prefix for diagnostics.

The user must activate `Generate one candidate`. The action submits
`confirmLiveGeneration: true` and `maxProviderCalls: 1`. There is no timeout,
focus, selection, or render event that submits implicitly.

### Stage 3: Processing

Once submitted, target identity, mask, instruction, provider preset, and plan
hash are frozen. The rail shows the existing job status and actual consumed
call count. Closing or switching context aborts local polling where possible
and token-guards every late result; it does not claim that a provider request
was unspent or cancelled.

`outcome_unknown` is used when the request may have reached the server but the
client cannot determine the result. The only recovery is to query the original
job/operation identity. The UI must not submit another provider call
automatically.

### Stage 4: Result And Validation

The main Canvas uses the existing comparison toolbar. `Difference` is clipped
visually to the selected frame but may distinguish changed-inside-mask from an
integrity violation outside the mask. `Onion` compares the target with its
same-clip neighbors. The filmstrip adds an `R` badge to the candidate frame and
plays the candidate sheet without changing the parent revision.

The right rail shows real evidence:

- provider/job identity and one-call accounting;
- final mask pixel count;
- target changed-pixel count;
- non-target frame equality;
- target outside-mask equality;
- bbox, anchor, and baseline before/after deltas;
- empty/crop/edge/halo/component evidence;
- clip continuity and full Character Pack validation deltas;
- pass, warning, fail, or unknown acceptance state.

`Discard candidate` changes no project state and does not delete generated
evidence. `Accept revision` is available only under the acceptance policy
below.

## State Architecture

Frame Repair adds a fifth state layer beside the Workbench's existing project,
draft, view, and job state. It remains ephemeral until acceptance.

### Persistent project state

Unchanged until specialized Accept:

- project revision;
- asset active revision id;
- immutable revision records and managed artifact references.

### Ephemeral frame-repair draft

- selection token: project, project revision, asset, parent revision, clip,
  actual sheet-frame index;
- instruction;
- ordered mask edits;
- provisional plan response and hashes;
- selected rectangle and mask view settings;
- current stage and disclosure state.

It is excluded from project JSON, autosave, Undo/Redo, and persistent camera.
After a confirmed live submit, the browser may retain only a minimal
session-scoped recovery handle containing project id, asset id, operation id,
job id when known, and plan hash. It stores no instruction, mask pixels,
provider payload, image, credential, or arbitrary path. A refresh uses the
handle only for operation lookup; it never resubmits generation.

### Provider job state

- operation/dedupe identity;
- canonical plan hash;
- job id and existing job status;
- provider call budget and used count;
- controlled artifact URLs;
- terminal error, reason, and retry hint.

The existing shared job store is process-memory state, so it is not sufficient
as the only call-accounting authority. Frame Repair adds a small durable
operation ledger under a server-controlled Editor operation-data root outside
the statically served `/generated` tree. The ledger is addressed by a digest of
the scoped operation identity, uses contained regular files, create-exclusive
reservation, and atomic state-transition updates. It records only safe
operation/job/scope/plan/status/call-count timestamps and stores no secret,
prompt, image bytes, source path, or provider request body.

The ledger is written before enqueue and marks the call used immediately
before dispatch. After a server restart, a non-terminal dispatched entry is
recovered honestly as an uncertain outcome and is never retried automatically.
An entry interrupted before dispatch remains zero-call and requires a new
explicit Review Call confirmation rather than auto-resuming.

Terminal jobs may be reconstructed from the ledger plus sealed generated
artifacts. Ledger files are not silently deleted by this workflow; retention
policy is outside v1.

### Candidate review state

- decoded candidate and patched-sheet cache keys;
- comparison mode and candidate animation clock;
- validation/integrity evidence;
- warning confirmation bound to exact job and plan hash.

## Canonical Mask And Plan Contract

### User-edit request

The browser sends no image bytes or path. The plan request contains:

```ts
type FrameRepairPlanRequest = {
  expectedRevision: number
  expectedAssetRevisionId: string
  clipId: string
  clipFramePosition: number
  sheetFrameIndex: number
  instruction: string
  maskEdits: Array<{
    op: 'add_rectangle' | 'remove_rectangle'
    x: number
    y: number
    width: number
    height: number
  }>
  providerPresetId: string
  imageConfig: { image_size: '1K' | '2K' }
}
```

`clipFramePosition` and `sheetFrameIndex` are non-negative integers. The server
requires the clip entry at that exact position to equal the submitted sheet
frame index; it never guesses a position when a clip repeats a frame.

Rectangle fields are integers. Width and height are at least one; the complete
rectangle must be within the resolved frame dimensions. At most 64 operations
are accepted. Operation order is preserved because add/remove operations are
not commutative. Invalid values are rejected, never clipped.

### Canonical mask

The server reloads the managed parent sheet, animations, and diagnostics,
re-derives the base mask, applies the ordered edits, and converts the final
mask to sorted, non-overlapping row-major runs over the resolved frame. The
response includes:

```ts
type CanonicalFrameMask = {
  width: number
  height: number
  source: 'localized_diagnostic' | 'localized_plus_user_edits' | 'user_scoped'
  confidence: 'high' | 'needs_scope' | 'user_confirmed'
  runs: Array<{ start: number; length: number }>
  activePixelCount: number
  sha256: string
}
```

An empty low-confidence response may return `can_run: false`,
`confidence: 'needs_scope'`, and a display-only suggested rectangle, but no
live plan may use it. Once the user adds active pixels, the canonical mask is
`user_confirmed`. Runs use flattened row-major pixel indices and cannot overlap
or leave bounds. The client renders these server runs; it does not treat its
provisional mask as authoritative.

Mask labels are deterministic: an unchanged non-empty diagnostic mask is
`localized_diagnostic`/`high`; any edited non-empty diagnostic mask is
`localized_plus_user_edits`/`user_confirmed`; and a user-created mask with no
diagnostic base is `user_scoped`/`user_confirmed`. Removing every active pixel
returns `invalid_mask` and cannot produce a runnable plan.

### Canonical plan

`frame_repair_plan_v1` binds:

- project id and revision;
- asset id and parent revision id;
- registered profile and resolved frame dimensions;
- clip id, ordered clip frames, clip position, and actual sheet-frame index;
- parent normalized-sheet SHA-256 and target-frame decoded RGBA SHA-256;
- previous/next context frame indices and decoded RGBA hashes;
- canonical mask and mask hash;
- normalized instruction;
- explicit provider preset, provider/model label, and explicit image config;
- `estimated_provider_calls: 1` and `max_provider_calls: 1`;
- server implementation revision.

The plan is serialized as recursively key-sorted plain JSON with array order
preserved, compact `JSON.stringify`, UTF-8 encoding, and lowercase SHA-256.
The browser may display the returned hash but never authorizes acceptance with
a client-computed hash.

The live request repeats the user-edit request and adds
`expectedPlanHash`, `confirmLiveGeneration: true`, and
`maxProviderCalls: 1`. It also carries a client-created, validated
`operationId` generated before the network request. The server repeats
authority resolution and plan canonicalization immediately before enqueue; a
hash difference is a stale-plan conflict and spends no call. The operation id
is an idempotency/recovery key scoped to project, asset, parent revision, and
plan hash; it is not a client-selected job id. It must match
`^[A-Za-z0-9_-]{16,80}$`; invalid or previously rebound values are rejected
before enqueue.

## Provider And Local Composite Pipeline

### Reuse boundary

The feature reuses the existing configured provider presets, provider adapters,
explicit image configuration, provider call budget guard, process-wide job
queue, and job store. It does not call `/api/repair-character-action` because
that route owns whole-action/fixed-region semantics and general import.

An explicit provider preset is required. The server does not silently fall
back to another preset or provider family: one confirmed operation can issue
at most one provider image request. The call budget is reserved immediately
before network dispatch; a response-loss or uncertain network outcome remains
one used call and never restores the budget automatically.

### Reference payload

The service builds project-owned reference images in deterministic order:

1. nearest-neighbor enlarged target frame;
2. mask visualization/reference;
3. previous/target/next context contact sheet;
4. full normalized-sheet identity context when allowed by the existing preset.

The project-owned prompt requests one isolated transparent pixel-art frame,
preserves identity/action/direction, names the repair instruction, and explains
that local code will composite only the selected mask. It must not contain an
API key, filesystem path, hidden template, unrelated historical prompt, or
external product wording.

### Candidate normalization and composite

The provider output is untrusted. The service:

1. verifies an image was returned and decodes it at no more than 2048 pixels
   per side and 4,194,304 total pixels;
2. removes supported flat/background residue through existing local primitives;
3. extracts one visible subject and rejects empty or clearly multi-canvas/full-
   sheet output;
4. fits it to the target frame's scale and anchor using nearest-neighbor
   operations;
5. applies the approved local alpha/component/palette finishing only to the
   candidate frame before composite;
6. composites candidate pixels into a clone of the parent decoded sheet only
   where the canonical mask bit is active;
7. verifies decoded RGBA equality for all non-target frames and all target
   pixels outside the mask.

The provider cannot modify pixels outside the mask even if it ignores the
prompt or mask reference.

### Already-normalized packaging boundary

`processSheetBuffer()` always performs source preparation and frame
normalization, so it cannot satisfy the unchanged-pixel invariant for an
already-normalized patched sheet. The implementation must not use it to produce
the accepted candidate sheet and then claim unrelated pixels were preserved.

Add a specialized Editor-owned normalized-sheet packaging adapter. It consumes
the exact patched sheet and project-owned metadata, then reuses existing
Character Pack validators, animation/metadata builders, Row GIF and inspection
builders, multi-resolution builder, debug/onion renderer, engine exporters,
ZIP builder, artifact manifest, and writer. It must not run background removal,
grid correction, normalization, auto-correction, stabilization, whole-sheet
palette mutation, or per-frame nudge.

The adapter writes the standard required Character Pack artifact set. In the
child output, `source.png` and `normalized_sheet.png` both represent the exact
patched normalized sheet under the registered uniform runtime layout. Metadata
records a server-built `derived_revision` parent lineage and an
`editor_targeted_frame_repair` generation mode. The original parent revision
and its original/fixed-region source remain immutable and reachable.

Frame Repair is not a Processing Recipe execution. The job must not fabricate
a `processing_recipe.json` that claims `processSheetBuffer()` produced these
pixels. The child revision therefore has `processing_recipe_ref: null`; the
frame-repair context records the parent's optional Recipe reference as lineage.
Reopening the child in the Finishing Workbench follows the existing no-Recipe
path and creates a fresh default draft rebound to the child's controlled
uniform `source.png`.

This is a deliberate backend capability addition with dedicated pixel-equality
and artifact-contract tests. It is not a visual convenience refactor and does
not change existing generation/upload behavior.

## Generated Evidence And Managed Revision

The job writes the standard Character Pack files plus:

- `frame_repair_plan.json`;
- `editor_frame_repair_context.json`;
- `target_before.png`;
- `frame_repair_mask.png`;
- `frame_repair_context.png`;
- `raw_provider_output.png`;
- `normalized_candidate_frame.png`;
- `composited_candidate_frame.png`;
- `frame_repair_difference.png`;
- `frame_repair_quality.json`;
- safe `frame_repair_prompt.txt`;
- `patched_normalized_sheet.png` as explicit evidence matching the standard
  `normalized_sheet.png` pixels.

The context cross-binds job type, job id, project/revision/asset/parent
identity, parent sheet digest, target frame digest, context frame digests,
mask hash, full plan hash, provider preset id, explicit call budget, used-call
count, implementation revision, and a sealed artifact manifest.

Specialized acceptance copies the standard pack plus plan, context, mask,
candidate, difference, and quality evidence into the immutable child revision.
Raw provider output and safe prompt evidence may be copied only through their
registered artifact keys; they are never exposed as arbitrary paths.

## API Contract

### Provider-free plan

```http
POST /api/editor/projects/:projectId/assets/:assetId/frame-repair/plan
```

Body: `FrameRepairPlanRequest`.

Returns `200` with the canonical plan, `plan_hash`, canonical mask runs,
read-only provider/model/call summary, and `can_run`/preflight diagnostics. It
does not create a provider job, spend quota, or mutate the project.

### One-candidate Preview

```http
POST /api/editor/projects/:projectId/assets/:assetId/frame-repair
```

Body: `FrameRepairPlanRequest` plus:

```ts
{
  operationId: string
  expectedPlanHash: string
  confirmLiveGeneration: true
  maxProviderCalls: 1
}
```

The initial submit and an exact idempotent replay both return `202` with the
same public `editor_character_frame_repair` job. Existing
`GET /api/jobs/:jobId` polling remains unchanged.

Submitting the same operation identity and exact plan returns the already
recorded job and cannot enqueue or spend a second call. Reusing that operation
identity with a different plan or scope is rejected. A later intentional retry
uses a newly created operation identity only after the user returns through
Review Call and confirms again; it is a new potentially billable operation.
The operation record is atomically reserved and bound to its scoped plan hash
before enqueue, so two concurrent first submissions cannot both dispatch. Its
durable ledger, rather than the process-memory job map alone, is the authority
for replay and used-call accounting.

The new job type uses the existing public job-status vocabulary. States such
as `outcome_unknown`, `stale_plan`, and `selection_switched` are client/session
states derived around that job; they do not expand or falsify the shared job
status enum.

### Uncertain-outcome recovery

```http
GET /api/editor/projects/:projectId/assets/:assetId/frame-repair/operations/:operationId
```

Returns `200` with the recorded public job for the exact scoped operation, or a
controlled `404 operation_not_found`. This route spends no quota and exists so
a client that lost the original `202` response can recover without resubmitting
generation. It consults the durable ledger and sealed artifacts, so client
refresh or server restart does not turn a previously dispatched call into a
fresh automatic attempt.

### Exact Accept

```http
POST /api/editor/projects/:projectId/assets/:assetId/frame-repair/:jobId/accept
```

```ts
{
  expectedRevision: number
  expectedAssetRevisionId: string
  expectedPlanHash: string
  warningConfirmed: boolean
}
```

Returns `200` only after the exact completed job, context, sealed artifacts,
parent sheet, plan hash, pixel-integrity report, quality policy, project
revision, and active asset revision are revalidated inside the existing
project-keyed mutation lock.

The general `import-job` route rejects this job type with
`specialized_accept_required`. Existing frame/action/local-reprocess routes do
not change behavior.

## Authorization, Availability, And Offline Truth

The local Editor Workspace has no account, role, or project-permission model.
Unauthorized and no-permission states are therefore not applicable, and the UI
must not invent them.

Provider configuration remains server-owned. If no explicit preset is
available, mask editing and local diagnostics remain usable. A selected preset
whose safe public metadata exists but whose runtime is unavailable produces a
provider-free Plan with `can_run: false` and `provider_unavailable`. If provider
configuration is invalid and exposes no selectable preset metadata, the UI
derives the same disabled state from the existing safe provider-config response
and does not fabricate or silently choose a preset. Provider credentials never
enter the plan response.

If the local GameTool server is unavailable, the Editor itself cannot load and
there is no separate offline Frame Repair mode. If the server is available but
the external provider network is unavailable, the job reports the real model
or uncertain-outcome state, keeps all local draft data, and never retries
implicitly.

## Acceptance And Storage Rules

Accept requires all of the following:

- job type `editor_character_frame_repair` and terminal status `done`;
- exactly one consumed provider call and exactly one generated candidate for a
  successful job; failed preflight/enqueue paths may consume zero;
- full plan hash equality across request, job, plan artifact, and context;
- unchanged current project and active parent revision;
- parent sheet digest still equals the plan/context value;
- all required standard and frame-repair artifacts exist as regular contained
  files and match the sealed manifest;
- decoded non-target frames equal the parent;
- decoded target pixels outside the mask equal the parent;
- standard validation and frame-repair quality meet the policy below.

The shared project mutation lock, exclusive revision directory reservation,
no-overwrite copy, revision-checked save, and orphan handling remain identical
to Character Reprocess acceptance. Two concurrent accepts from the same parent
produce one success and one conflict.

No failure deletes a job, parent revision, historical revision, or orphaned
no-replace directory automatically.

## Parameter And Control Binding

| UI/data concern | Request or server source | Provider/pipeline binding | v1 behavior |
| --- | --- | --- | --- |
| Project identity | Current Editor project | Server lookup and revision check | Read-only. |
| Asset/parent revision | Selected active Character Pack revision | Managed artifact authority | Read-only; stale change blocks. |
| Clip | Filmstrip selection | Server-validated `animations.json` clip | Read-only in Frame Repair. |
| Clip position | Exact selected filmstrip position | `clipFramePosition` | Must resolve to the submitted sheet frame, including repeated-frame clips. |
| Sheet frame | Real selected filmstrip item | `sheetFrameIndex` | Must match the clip entry at the submitted position. |
| Base mask | Server-derived parent frame/diagnostics | Canonical mask base | Read-only evidence; may be empty under `needs_scope`. |
| Mask Add/Remove | Ordered rectangle UI operations | Canonical mask runs | Active; max 64 bounded operations. |
| Repair instruction | Suggested diagnostic text plus user edit | Provider prompt instruction | Required, normalized, max 500 characters. |
| Context frames | Server-derived previous/next clip frames | Provider reference contact sheet | Read-only; no arbitrary selection/path. |
| Full identity context | Managed normalized sheet | Optional provider reference image | Server-controlled and preset-compatible. |
| Provider preset | Existing safe provider-config response | Existing explicit provider adapter | Active selection; no key in browser and no implicit fallback. |
| Image size | Existing supported preset UI | Explicit `image_config.image_size` | `1K` or `2K`; included in plan hash. |
| Call confirmation | Stage 2 action | `confirmLiveGeneration` | Sent only by explicit click. |
| Call budget | Fixed design value | `maxProviderCalls` | Exactly `1`; read-only. |
| Operation identity | Client-generated safe id, server-scoped to exact plan | Live idempotency and uncertain-outcome lookup | Created once before submit; never reused for a different plan. |
| Candidate count | Fixed design value | Service generation count | Exactly one successful candidate. |
| Candidate background cleanup | Server fixed local behavior | Existing local cleanup primitives | No active v1 control; evidence recorded. |
| Candidate pixel finishing | Parent style evidence plus fixed safe adapter defaults | Candidate-frame-only finishing before mask composite | No whole-sheet mutation. |
| Composite | Canonical mask and parent/candidate RGBA | Local mask compositor | Server-owned; no browser pixels trusted. |
| Quality policy | Existing validator plus frame-repair integrity report | Acceptance state | Pass/warning/fail/unknown as below. |

Every active control must appear in this table. The implementation plan must
stop and update the design if it discovers a provider or packaging option that
would otherwise be submitted silently.

## Quality And Acceptance Policy

### Blocking integrity invariants

- valid managed parent sheet and registered profile;
- valid clip membership and frame dimensions;
- non-empty canonical mask;
- non-target decoded RGBA equality;
- target outside-mask decoded RGBA equality;
- standard artifact completeness and sealed digests;
- no empty target, crop, invalid frame count, changed clip mapping, or new
  blocking Character Pack error;
- no project/revision/plan conflict.

An integrity invariant failure is never downgraded to a warning.

### Review quality

| Candidate evidence | Accept behavior | Meaning |
| --- | --- | --- |
| Integrity pass + standard validation pass + no new continuity warning | Enabled | Local structural evidence passed; semantic success still needs human review. |
| Integrity pass + standard warning or non-blocking continuity delta | Enabled only after exact job/hash warning confirmation | Candidate remains reviewable; child production state is `review_required`. |
| Any integrity failure, standard validation fail, incomplete evidence, or quality unknown | Disabled | No project change. |

The product does not claim that a structural pass proves the intended anatomy,
prop, facing, or action was fixed. Before/After and animation playback remain
the semantic review authority.

### Comparative evidence

The quality report records before, after, and delta for:

- changed pixels inside mask;
- attempted changes outside mask;
- bbox and visible-pixel count;
- anchor and baseline;
- crop/edge pressure;
- halo, alpha fringe, and detached components where measurable;
- selected clip motion/continuity metrics;
- full validation status, warnings, blockers, and failure taxonomy.

## UI State Matrix

Required states:

- `no_project`;
- `no_asset`;
- `unsupported_asset`;
- `no_frame`;
- `planning`;
- `needs_scope`;
- `invalid_mask`;
- `planned`;
- `provider_unavailable`;
- `confirming`;
- `queued`;
- `generating`;
- `post_processing`;
- `ready`;
- `warning`;
- `blocked_quality`;
- `failed_model`;
- `failed_processing`;
- `outcome_unknown`;
- `stale_plan`;
- `project_conflict`;
- `asset_revision_conflict`;
- `selection_switched`;
- `accepting`;
- `accepted`;
- `discarded`;
- `teardown`.

Each state has one visible message, `aria-live` announcement, retained-draft
rule, and exact action availability. Provider unavailable still allows mask
editing and provider-free planning where meaningful, but generation is disabled
with a real reason. A failed job keeps the mask, instruction, plan, and
inspectable evidence; it never retries automatically.

## Error And Lifecycle Handling

- Plan and live requests use generation tokens so an older response cannot
  replace a newer mask/selection.
- The confirmation handler creates one operation id, disables itself
  synchronously, and reuses that id for transport recovery. Concurrent submits
  with that same id deduplicate server-side before a second provider operation
  can start.
- One poll timer and one abort controller exist per active frame session.
- Blur, panel switch, project switch, asset/revision switch, teardown, and
  explicit cancel clear pointer capture, local timers, and active polling.
- Provider request cancellation is not represented as quota refund or assured
  remote cancellation.
- Network/5xx uncertainty after live submission enters `outcome_unknown` and
  resolves only through the original operation lookup and then the recorded
  job id.
- A session recovery handle is cleared only after successful acceptance,
  explicit discard/acknowledgement, or a controlled not-found result that the
  user acknowledges; loading it never performs a generation POST.
- A plan or candidate stays inspectable when stale, but cannot be accepted.
- Retry always requires a new Review Call step and explicit confirmation; it
  creates a new plan/job identity and may spend another call.
- Controlled server error code, reason, and retry hint remain separate in UI
  state and logs.

## Accessibility And Responsive Behavior

- `Repair Frame` has an accessible reason when unavailable.
- The four stages expose current-step and progress semantics without making
  future steps interactive.
- Canvas mask evidence has a textual run/pixel/rectangle summary.
- Add/Remove mode uses pressed state; colors are not the only distinction.
- Rectangle numeric controls have labels, bounds, and keyboard increments.
- Filmstrip keeps one roving tab stop and the repaired badge has accessible
  text.
- Async states, call outcome, validation, and acceptance use `aria-live`.
- Disabled generation/Accept controls include an accessible reason.
- The mobile rail uses the existing modal drawer, inert background, focus trap,
  Escape/backdrop close, and focus return.
- Touch pointer rectangles are supported, but mobile copy may recommend a
  hardware pointer for precision. No capability is falsely disabled solely
  because the viewport is narrow.
- Reduced-motion rules apply to stage transitions and repaired-frame badges.

## Performance

- No fetch, image decode, mask analysis, hashing, DOM layout read, or artifact
  construction inside animation RAF.
- Mask overlay draw uses the canonical 96×96 runs or a cached bitmap.
- Managed images are decoded once per project/asset/revision/artifact identity;
  candidate images are decoded once per job/artifact identity.
- Rectangle edits operate on bounded 96×96 local state and do not enqueue a
  provider job.
- The full plan is server-canonicalized only on explicit Plan refresh and live
  submit.
- Only the selected candidate clip animates.
- Existing Canvas 2D nearest-neighbor renderer remains; no new UI/runtime
  dependency is justified.

## Testing And Evidence

### Pure contract tests

- clip position/frame membership, repeated-frame clips, and fixed frame-space
  bounds;
- deterministic base-mask derivation for localized diagnostics;
- honest empty `needs_scope` behavior;
- ordered Add/Remove rectangle semantics, operation limit, bounds rejection,
  canonical runs, mask hash, and pixel count;
- instruction normalization and length/control-character rejection;
- canonical plan serialization and full hash vectors;
- plan freshness across project/asset/revision/sheet/context/provider changes;
- state matrix and action availability;
- live-operation and Accept deduplication.

### Image and packaging tests

- exact decoded RGBA equality for every non-target frame;
- exact decoded RGBA equality outside the target mask;
- provider attempts outside the mask are discarded locally;
- corrupt, empty, oversized, full-sheet, and unsupported provider output is
  rejected;
- candidate normalization preserves target dimensions and records every local
  transform;
- already-normalized packaging does not run normalization or mutate input
  pixels;
- standard sheet, animations, metadata, debug, Row GIF, inspection,
  multi-resolution, engine export, ZIP, and manifest artifacts agree with the
  exact patched sheet;
- parent and generated evidence remain unchanged.

### API, provider, and store tests

- Plan uses zero provider calls and zero project mutations;
- live submit requires exact plan hash, explicit confirmation, explicit preset,
  and call budget one;
- a successful terminal job makes exactly one provider request and one
  candidate; a dispatched uncertain/failing request remains one used call;
- same-operation replay returns the recorded job, different-plan rebinding is
  rejected, and an intentional retry requires a new explicit confirmation and
  operation id;
- invalid operation ids and concurrent first submissions are rejected or
  deduplicated before a second dispatch;
- durable ledger replay, client refresh, server-restart recovery, and
  dispatched-but-non-terminal recovery never issue another provider request;
- the session recovery handle contains only its allowed identifiers and never
  causes a live POST on load;
- no implicit provider fallback or retry;
- provider keys, paths, raw request bodies, and source base64 never enter public
  job/UI state;
- controlled managed path, regular-file, realpath, and symlink containment;
- artifact/context/hash tampering rejection;
- stale project, active revision, parent sheet, plan, and clip rejection;
- general import rejects the specialized job type;
- exact Accept imports one parented child revision;
- warning confirmation is bound to exact job and plan hash;
- failed, unknown, or concurrent acceptance leaves project JSON unchanged;
- two concurrent accepts yield exactly one success.

### UI and browser tests

- all empty/loading/disabled/running/failure/conflict/completed states;
- Recipe rail preservation and Frame Repair rail restoration;
- four-stage progression and back/cancel rules;
- pointer and keyboard rectangle editing;
- Plan refresh after any mask/instruction/provider edit;
- zero POST from selection, rectangle editing, comparison, playback, or view
  changes;
- one Plan POST, one confirmed live POST, and one exact Accept POST;
- Before/After/Split/Difference/Onion and repaired-filmstrip playback;
- no project dirty/history change before Accept;
- mobile drawer, focus trap, overflow, long text, reduced motion, and hardware-
  pointer guidance;
- real rendering at `1440 x 900`, `2048 x 963`, and `390 x 844` with console
  and Network evidence.

### Real-effect benchmark gate

Implementation tests use a deterministic injected provider and spend no quota.
A separate benchmark requires explicit user authorization and a maximum call
budget before any real provider use.

All implementation verification runs through the repository's guarded focused,
full-test, and smoke entry points. The plan must not introduce an unbounded raw
test or browser command, and every spawned server or browser process must be
accounted for and stopped.

The first benchmark contains 8–12 user-owned or repository-owned bad frames
covering halo/edge residue, missing local pixels, broken anatomy, unwanted prop,
and direction/action issues. It records first-call results only.

Production-readiness evidence requires:

- zero decoded-pixel integrity violations;
- zero silent retries or calls above the approved budget;
- at least 70% of completed first-call candidates judged visibly improved and
  usable or review-required without a new blocker;
- per-category outcomes and failures, not only an aggregate score.

If the threshold is not met, deterministic safety can still ship, but the live
entry remains explicitly Experimental/opt-in and no broad quality claim is
made.

## Rollout And Work Boundaries

The implementation plan should split this design into verified units:

1. protocol, canonical plan/mask/hash, state model, and docs;
2. deterministic mask derivation and rectangle operations;
3. exact normalized-sheet composite and specialized packaging adapter;
4. provider-free Plan route and one-call job service through the shared queue;
5. sealed evidence and specialized immutable Accept under the shared lock;
6. Workbench controller/rail/Canvas/filmstrip integration;
7. state, accessibility, smoke, browser, and resource verification;
8. optional separately authorized real-effect benchmark.

The implementation must use TDD, preserve existing Action Repair and Character
Reprocess behavior, and stop if the normalized-sheet packaging adapter would
require silently changing existing pipeline output. Any required public
artifact/protocol addition must land as an explicit contract unit with tests.

## Definition Of Done

- A user can select one real managed Character Pack frame and enter Frame
  Repair without losing the Workbench draft or view.
- The final canonical mask is server-derived, bounded, visible, and hash-bound.
- Plan spends zero calls; confirmed Preview spends at most one call and returns
  one candidate.
- Local composite makes provider changes outside the mask impossible.
- All non-target frames and target outside-mask pixels match the parent in
  decoded RGBA space.
- Result review uses real Canvas comparison modes, repaired-clip playback, and
  real quality/integrity evidence.
- Pass/warning/fail/unknown, stale, conflict, uncertain outcome, and provider
  failure states are honest.
- Accept imports the exact sealed job as one immutable child revision; Discard
  and every failure leave the project unchanged.
- Existing `/`, Character Pack, Motion Source, Action Repair, Character
  Reprocess, providers, validators, exporters, project packs, Playtest, scene,
  and 2.5D flows remain available.
- No external code, UI, prompt, template, asset, provider secret, or private
  behavior is copied or exposed.
- Focused tests, full guarded tests, local smoke, three-viewport browser
  verification, binding audit, and runbook pass with actual evidence.

## Repository Hygiene Note

At design time, `main` contained unrelated untracked `.superpowers/` visual
evidence and duplicate `* 2.js` / `* 2.md` files. They are not part of this
spec and must not be staged, edited, moved, or deleted by implementation work.
