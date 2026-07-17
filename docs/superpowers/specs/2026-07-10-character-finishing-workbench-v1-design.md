# Character Finishing Workbench v1 Design

**Date:** 2026-07-10
**Status:** User-approved direction; awaiting final specification review
**Roadmap classification:** Editor Workspace Visual Repair, Core
**Implementation baseline:** `main` at `8aa1b0d`

## Summary

Build a non-destructive Character Finishing Workbench inside the existing
`/editor` Repair panel. The workbench turns the current evidence viewer and
provider-repair launcher into a complete local workflow:

```text
select a character revision
-> edit a processing_recipe_v0 draft
-> inspect immediate geometry overlays
-> build one authoritative local preview job
-> compare real before/after frames and quality evidence
-> accept that exact job as a child revision, or discard it
```

The workbench reuses real Character Pack processing and immutable Editor asset
revisions. It does not become a pixel editor, does not mutate generated
artifacts, and does not call a provider during local preview.

## Design Sources And Lineage

### Product source of truth

The current Editor Workspace on `main` is the UI and capability source of
truth. Relevant accepted ancestors are:

- `36eefaf`: Visual Repair Workspace;
- `58176ce`: Editor shell module split;
- `89cf7b2`: Editor Canvas Playtest MVP;
- `8aa1b0d`: current merged baseline.

All are ancestors of the selected baseline. No unmerged UI branch is required
before this work starts.

### Visual exploration

The user approved the following provisional information architecture during
the 2026-07-10 visual-companion review:

```text
+------------------------------------------------------+------------------+
| comparison canvas                                    | Processing Recipe|
| Before / After / Split / Difference / Onion          | controls         |
+------------------------------------------------------+                  |
| horizontal frame filmstrip for the selected clip     |                  |
+------------------------------------------------------+------------------+
| quality evidence                         Build / Accept / Reset           |
+-------------------------------------------------------------------------+
```

The frame filmstrip moved from the left rail to the bottom so increasing frame
counts use horizontal space and scrolling instead of shrinking the canvas.
The right Recipe panel remains full height. The work area grows with viewport
height. On narrow screens the Recipe panel becomes a drawer entry and the
filmstrip remains horizontally scrollable.

This layout is approved as an MVP baseline, not as final visual polish.
Resizable splitters, a user-adjustable filmstrip height, and large-sequence
virtualization remain later refinements after real-artifact browser review.

The visual-companion files under `.superpowers/brainstorm/` are local design
evidence only and must not be staged or shipped.

### External reference boundary

A public adjacent-tool homepage was reviewed only to understand broad workflow
expectations such as short paths between frame extraction, cleanup, sheet
inspection, animation preview, and test scenes. Its code, bundle, layout,
wording, assets, algorithms, and private behavior are not design inputs and
must not be copied.

No new dependency, external source code, or external asset is approved by this
design. Existing project-owned processing remains authoritative.

## Goals

1. Make existing Character Pack correction controls usable from one Editor
   workspace.
2. Use real managed assets, real processing jobs, and real quality reports.
3. Guarantee that the accepted revision is the exact previewed job, with no
   second processing run.
4. Keep current and historical asset revisions immutable.
5. Make parameter provenance, warnings, blocking errors, and before/after
   evidence visible.
6. Keep local deterministic finishing separate from the existing
   quota-confirmed AI Action Repair flow.
7. Preserve `/`, existing APIs, Character Pack generation/upload, providers,
   validators, exporters, and project-pack behavior.

## Non-goals

- No brush, eraser, freehand paint, pixel selection, or full pixel editor.
- No general UI/prop/sheet extraction workspace.
- No semantic action or facing correctness judgment.
- No automatic multi-action provider repair or candidate blending.
- No provider call from `Build Preview`.
- No direct browser access to arbitrary filesystem paths.
- No in-place mutation or deletion of generated jobs or managed revisions.
- No React, PixiJS, Konva, WebGL migration, or new runtime dependency.
- No final commitment to resizable panels or frame virtualization in v1.

## Capability Truth And Recorded Deviations

| Surface | Current capability | v1 treatment |
| --- | --- | --- |
| Source, normalized, debug, onion, inspection artifacts | Implemented | Render real artifacts and selected frames. |
| Manual 8x8 cut lines | Implemented in Character Pack processing | Active only for compatible layouts. |
| Anchor offset and per-frame nudge | Implemented | Active and reflected in the draft Recipe. |
| Background mode/tolerance and component cleanup | Implemented | Active. |
| Fixed-region source staging | Implemented before managed `source.png` is written | Read-only historical evidence in v1; forced off for reprocess to prevent staging an already staged source twice. Reopening it requires a future explicit raw/pre-staging managed artifact. |
| Pixel Finishing palette, alpha cleanup, components, and outline | Implemented | Active, opt-in, with real report metrics. |
| Style report | Implemented | Always enabled for authoritative preview evidence. |
| Pixel Grid Refinement algorithm | Implemented for selected generation and Motion Source paths, but not accepted by `processSheetBuffer` | Disabled or hidden with `Coming later` in v1. The visual wireframe checkbox was placement exploration, not an active capability promise. Activation requires a separately approved protected-pipeline contract change. |
| AI Action Repair | Implemented with explicit provider confirmation | Preserved as a separate collapsed flow; never triggered by local Preview. |
| Difference and split views | Derivable from real same-size artifacts in Canvas | Active when compatible before/after frames exist; otherwise visibly unavailable. |
| Full pixel editing | Not implemented and Not Planned | Hidden. |

This capability table overrides any active-looking control in the provisional
wireframes.

## State Architecture

The implementation keeps four state layers separate.

### Persistent project state

- asset and revision records;
- active revision id;
- immutable managed artifact references;
- `processing_recipe_ref` on accepted derived revisions.

Project state changes only through Editor validator/store APIs.

### Ephemeral repair draft

- selected asset id and parent revision id;
- editable `processing_recipe_v0` value;
- selected clip and frame;
- comparison mode, zoom, pan, and overlays;
- dirty flag, opening `draft_settings_hash`, and current
  `draft_settings_hash`.

The draft is not written into project JSON, command history, or autosave.
Both hashes use lowercase-hex SHA-256 over UTF-8 bytes of a validated plain JSON
object whose keys are recursively sorted, whose array order is preserved, and
which is serialized with `JSON.stringify` and no pretty-print spacing:

- `recipe_hash` covers the complete server-canonical Recipe, including the
  server-owned `implementation_revision`. It binds job evidence, context, and
  acceptance.
- `draft_settings_hash` first clones that same canonical Recipe and forces only
  `implementation_revision` to `null`. It compares opening/current/submitted
  editable settings for dirty, stale, and Reset behavior.

The server recomputes both authoritative hashes with `node:crypto`; the UI may
use Web Crypto to provisionally compute only `draft_settings_hash`. No hashing
dependency is added, and no client-computed hash is trusted for acceptance.

### Processing job state

- preview job id and real job status;
- submitted full `recipe_hash` and `draft_settings_hash`;
- parent asset/revision identity;
- controlled artifact URLs and quality evidence;
- failure status and reason.

### Provider repair state

The existing AI Action Repair plan/run state remains separate. It retains its
provider preset, explicit quota confirmation, and one-action repair boundary.
It cannot be reached through local `Build Preview`.

## Core Flow

### 1. Open

Opening Repair for a `character_pack` asset creates a draft from:

1. the active revision's `processing_recipe_ref`, when present and valid;
2. otherwise `createDefaultCharacterProcessingRecipe()` plus immutable source
   metadata from the active revision.

Defaults must be shown as defaults, not inferred as prior user choices.

A historical Recipe contributes only editable processing sections; historical
fixed-region staging settings remain read-only provenance. Draft
construction always rebinds `source.asset_id`, `source.source_job_id`,
`source.source_layout`, `source.file_name`, and the optional managed black-matte
reference to the currently active asset/revision and its server-derived input.
That rebound Recipe is the new clean opening snapshot: it does not modify the
historical Recipe artifact and does not mark the draft dirty. This makes a
revision accepted from one Preview a valid parent for a later repair round even
though its stored Recipe correctly names the earlier parent job that produced
it.
The constructor also applies Workbench-required defaults before establishing
that snapshot: style reporting is on, output frame sizes use the fixed v1 set,
and `implementation_revision` is `null` until server submission.
The draft is dirty only when its current `draft_settings_hash` differs from the
opening hash. Preview freshness compares current settings with the Preview's
server-returned `draft_settings_hash`, plus the selected project/asset/revision
identity; it never compares the browser draft directly with full `recipe_hash`.

For a managed original-source input, the authoritative source layout is
resolved server-side in this exact order:

1. a valid managed Recipe referenced by the active revision;
2. `debug_report.source_layout.id` from that active revision;
3. `animations.source_layout.id` from that active revision.

`asset.profile` is a runtime/export profile and must never be treated as source
layout authority. The submitted Recipe's `source.asset_id`,
`source.source_job_id`, and `source.source_layout` are immutable identity fields:
the server validates them against the selected asset, active revision, and
authoritative source layout instead of trusting or rewriting client values.
The Recipe cannot select a different source job or layout.

#### Reprocess input policy

The server uses the active revision's managed `source` artifact and the
authoritative source layout above when both are available. If that artifact is
absent, it may use the required managed `sheet` artifact only through an explicit
`normalized_sheet_fallback` mode:

- the fallback input's server-derived authoritative layout is
  `topdown_rpg_v0`, and the read-only draft identity is normalized to match;
- original-source cut controls are disabled;
- the UI labels the fallback before the user builds a Preview;
- the fallback decision is recorded in `editor_reprocess_context.json`.

There is no silent switch between source and normalized-sheet semantics. If
neither a valid source nor the required sheet is available, Preview is blocked.
The Recipe's `source.file_name` is display/provenance metadata, not a path to
open. A black-matte reference is accepted only when it exactly identifies a
managed artifact already recorded on the selected revision.

Current managed `source.png` is encoded after fixed-region staging and layout
preprocessing. Therefore every v1 reprocess canonicalizes
`fixed_region_staging.enabled` to `false` with the remaining staging fields
`null`, for both managed-source and normalized-sheet-fallback inputs. The UI may
show the parent staging report as provenance but cannot offer an active staging
control. A later design may reopen it only after the artifact protocol stores a
separate raw/pre-staging source.

### 2. Edit

Geometry controls update local overlays immediately. They do not imply that
pixel cleanup has run. Background, cleanup, correction, and finishing controls
only change the draft and mark the current authoritative preview stale.

No slider, nudge, frame selection, animation tick, or Canvas render may start a
server job automatically.

### 3. Build Preview

`Build Preview` submits one complete Recipe candidate to an Editor-owned local
reprocess endpoint. The server:

1. loads the named project and checks `expectedRevision`;
2. resolves the named managed character asset and checks
   `expectedAssetRevisionId`;
3. resolves the selected managed input and reads only its controlled metadata
   and image dimensions;
4. revalidates the Recipe identity, structure, source-aware bounds, and
   pipeline-effective domains, then produces the canonical Recipe;
5. sets the server-owned `implementation_revision`, then computes full
   `recipe_hash` and revision-neutral `draft_settings_hash`;
6. converts it through `recipeToCharacterProcessingOptions()` and adds only
   server-derived metadata options;
7. submits one provider-free task to the server's existing shared Character
   Pack queue;
8. writes standard Character Pack artifacts plus Recipe/provenance evidence.

The endpoint must not accept a client filesystem path, base64 asset, provider
key, prompt, script, or arbitrary processing module.

Non-editable processing metadata is derived server-side so a new preview does
not fall back to generic `Character`/`upload` metadata:

- `name` comes from the selected project asset;
- `description` and sanitized generation provenance come from the active
  revision's managed `metadata.json`;
- `profile` is the registered internal profile resolved from validated
  `asset.profile`, which must agree with managed metadata/animations;
- `createdAt` is the Preview job's server timestamp;
- `source` is a server-built `derived_revision` record containing the managed
  input filename plus parent asset, revision, and job identity, while retaining
  safe original-source provenance from the parent metadata.

The browser cannot override these values or `implementation_revision`.
Generation/source provenance is copied through an explicit safe-field allowlist;
provider keys, tokens, raw responses, and prompt text are never copied. Missing,
malformed, conflicting, or secret-bearing required metadata blocks Preview
rather than degrading silently.

### 4. Review

The UI polls the existing real job state and renders only terminal job
artifacts that pass the completeness and integrity checks below. This includes
inspectable quality-blocked output from `failed_post_processing`; it does not
make that output acceptable. The UI compares the current revision with the
preview job and shows:

- frame and clip animation previews;
- Before, After, Split, Difference, and Onion modes where supported;
- validation status and failure taxonomy;
- unique-color count;
- palette changed-pixel ratio;
- halo/residue before and after;
- outline ratio;
- component-cleanup evidence;
- anchor/baseline and motion-stabilization evidence;
- documented warnings for missing metrics.

Changing the draft so its `draft_settings_hash` differs from the submitted
settings hash marks the preview `stale` and disables acceptance. The stale job
remains inspectable but cannot be mistaken for the current draft.

### 5. Accept Or Discard

`Accept as revision` imports the already completed preview job through a
specialized Editor acceptance route that delegates to the existing artifact
import/store boundary. It does not run processing again.

The imported revision must:

- use the previous active revision as `parent_revision_id`;
- reference the preview job through `source_job_id`;
- copy `processing_recipe.json` into managed immutable storage;
- set `processing_recipe_ref` to that managed file;
- retain real quality and production status;
- become active only after a successful revision-checked project save.

`Reset draft` restores the immutable clean opening snapshot produced by
parameter inheritance or documented defaults, legacy migration, required
Workbench defaults, and active-revision identity rebinding. It does not delete
a Preview. Preview freshness is recomputed from the restored
`draft_settings_hash`, so the Preview is fresh only when it represents that
exact opening settings snapshot and the same asset/revision.

`Discard session` is a secondary action in the Quality/Actions area. It clears
the ephemeral draft and Preview selection, then returns to the selected asset's
non-repair context. It does not delete a job directory or change the project.

## Internal Interfaces

Proposed pure boundaries:

```js
createRepairRecipeDraft({ asset, revision, loadedRecipe })
updateRepairRecipeDraft(draft, patch)
validateRepairRecipeDraft(draft)
canonicalizeRepairRecipe(recipe, { profile, sourceSize, inputMode })
createDraftSettingsHashInput(canonicalRecipe)
serializeCanonicalRecipe(recipe)
hashRepairRecipe(canonicalBytes)
getRepairPreviewFreshness({ currentDraftSettingsHash, submittedDraftSettingsHash, selection, jobStatus })
getRepairAcceptanceState({ project, asset, revision, draft, preview })
```

`canonicalizeRepairRecipe()` produces the pipeline-effective object;
`createDraftSettingsHashInput()` clones it and nulls only
`implementation_revision`; `serializeCanonicalRecipe()` owns the shared
byte-level serialization contract. The server hash adapter is synchronous with
`node:crypto`; the browser adapter is asynchronous with
`crypto.subtle.digest`. Both consume the same canonical UTF-8 bytes and must
pass identical full/settings golden vectors.

Proposed server boundary:

```http
POST /api/editor/projects/:projectId/assets/:assetId/reprocess
```

Request shape:

```ts
{
  expectedRevision: number,
  expectedAssetRevisionId: string,
  recipe: ProcessingRecipeV0
}
```

`recipe` is a complete protocol candidate, not a partial patch. The server is
the authority for validation, canonicalization, implementation revision, and
hashing.

Response is the standard local job summary, including a stable job id,
full `recipe_hash`, `draft_settings_hash`, and canonical Recipe echo for
freshness reconciliation. Existing `GET /api/jobs/:id` polling remains
unchanged. The UI adopts the returned canonical echo as the submitted snapshot
and uses only the returned `draft_settings_hash` for freshness; it never treats
its provisional digest as authoritative. Acceptance stores and sends the full
server `recipe_hash`.

The preview job additionally writes:

- `processing_recipe.json`: the canonical submitted Recipe;
- `editor_reprocess_context.json`: job type `editor_character_reprocess`,
  preview job id, project id, project revision
  at submission, asset id, parent revision id, input mode, managed input
  artifact key/reference, authoritative source layout, full `recipe_hash`,
  `draft_settings_hash`, and implementation revision.

These are evidence artifacts, not embedded project payloads.

The Character Pack Editor import specification adds these two optional files.
When `processing_recipe.json` is present, the importer copies it into the
managed revision and passes its controlled relative path to
`createAssetRevision({ processingRecipeRef })`. Legacy jobs without the file
retain `processing_recipe_ref: null`. For a specialized reprocess acceptance,
the validated context file is also copied and registered as the revision's
optional `reprocess_context` artifact; it is provenance evidence, not a second
source of mutable project state.

The route must be delegated through the existing `/api/editor/*` handler. It
must not change legacy endpoint behavior or the job-state enum.

Acceptance uses a second narrow route:

```http
POST /api/editor/projects/:projectId/assets/:assetId/reprocess/:jobId/accept
```

```ts
{
  expectedRevision: number,
  expectedAssetRevisionId: string,
  expectedRecipeHash: string, // full recipe_hash, never draft_settings_hash
  warningConfirmed: boolean
}
```

The route verifies the completed job, reprocess context, parent revision, full
`recipe_hash`, quality policy, and project revision before delegating to
`importGeneratedJobAsAsset()` and the existing project store. The general
`import-job` endpoint retains legacy behavior, but rejects the new
`editor_character_reprocess` job type with `specialized_accept_required`; the
Workbench does not call it directly. This prevents the strict boundary from
being bypassed without changing imports for pre-existing job types.

`draft_settings_hash` has no authority at acceptance. The route recomputes the
full Recipe hash from `processing_recipe.json` and requires it to match the job,
context, and `expectedRecipeHash`.

The route job type must be `editor_character_reprocess`, and its job id must
equal the context job id. The request's project revision, asset revision, and
full `recipe_hash` must equal both the recorded submission values and current server
state; an intervening project save or active-revision change returns a conflict
instead of rebasing the Preview implicitly. A legacy, provider, benchmark, or
other non-reprocess job can never enter through this route.

### Acceptance serialization and no-overwrite rule

All formal Editor project mutations, including existing save/import routes and
specialized acceptance, must share one in-process project-id-keyed mutation
lock. The acceptance critical section must:

1. reload the project after acquiring the lock;
2. repeat project revision, active asset revision, job type/context, full
   `recipe_hash`, artifact integrity, and quality checks;
3. choose a revision id absent from both project state and managed storage;
4. atomically reserve a never-existing final revision directory with an
   exclusive non-recursive create, then copy every verified file with
   exclusive/no-overwrite semantics;
5. save the revision-checked project before releasing the lock.

Processing and polling do not hold this lock. A failed copy or save cannot
change project JSON; an orphaned no-replace directory after a process crash is
never reused or overwritten and is reported for manual recovery. The
implementation must not add automatic bulk cleanup. Two concurrent accepts
from the same project revision result in exactly one success; the other returns
a conflict.

### Reprocess orchestration boundary

The implementation extracts or introduces one provider-free Character
reprocess service and injects it into the Editor API handler from `server.js`.
That service must use the existing process-wide `jobQueue`, job store, and
Character Pack artifact writer. The Editor handler must not construct a second
queue, bypass global concurrency, or duplicate job-status persistence. It may
adapt a validated Recipe into the existing processing call, but it does not
own provider configuration.

### Managed artifact and evidence safety

Every input path is selected from the active revision's artifact registry, not
from a request path. The same containment rules apply separately to managed
revision inputs under the workspace root and Recipe/context evidence under the
generated-job root. Resolution must:

1. reject absolute paths, traversal, unknown artifact keys, and unrecorded
   black-matte references;
2. perform lexical containment under the expected managed workspace root;
3. call `realpath` for the root and candidate, then repeat containment using
   the real paths so a symlink cannot escape the workspace;
4. accept only an existing regular file;
5. read the submitted canonical Recipe and reprocess context back from the job
   directory before acceptance, revalidate both, and recompute full and settings
   hashes.

A directory, external symlink target, missing artifact, modified Recipe, or
modified context is a hard rejection. Neither route opens `source.file_name`
from the Recipe or any other client-supplied filesystem path.

## UI Structure

### Header

- asset name;
- active revision id;
- immutable-current-revision status;
- preview state: `no_preview`, `dirty`, `queued`, `processing`, `ready`,
  `stale`, `warning`, `blocked_quality`, `failed`, or `accepted`.

### Comparison Canvas

- nearest-neighbor rendering;
- pan and discrete zoom without layout reads inside animation RAF;
- Before / After / Split / Difference / Onion modes;
- cut, anchor, baseline, bbox, and debug overlays;
- selected frame and comparison status.

Split and Difference are enabled only when both real frames can be aligned to
the same dimensions. Missing or incompatible frames show a diagnostic instead
of fabricated pixels.

### Processing Recipe Panel

Sections:

1. Geometry;
2. Cleanup;
3. Pixel Finishing;
4. Advanced correction;
5. separate AI Action Repair entry.

Unsupported controls are hidden or disabled with honest copy. They must not
look active.

### Bottom Frame Filmstrip

- real frames from the selected clip only;
- horizontal scrolling for overflow;
- selected frame automatically kept in view;
- left/right keys select frames when the filmstrip owns focus;
- play/pause and first/last controls;
- real frame count and duration;
- no virtualization requirement in v1.

The v1 implementation may add virtualization later only if measured clip sizes
or decode cost require it.

### Quality And Actions Bar

- concise metrics from the real preview report;
- `Reset draft`;
- `Build Preview`;
- `Accept as revision`;
- secondary `Discard session`;
- warning confirmation or blocking reason.

On narrow screens, the Recipe panel is a drawer, the Canvas remains above the
filmstrip, and action buttons remain reachable through vertical layout. Mobile
is review-capable; precise drag editing may still recommend a pointer device.

## Parameter Binding Contract

Every submitted processing option must come from an active control, inherited
immutable metadata, or a documented default.

| Concern | Recipe source | Processing option | v1 UI/default |
| --- | --- | --- | --- |
| Asset name | Existing project asset | server-derived `name` | Read-only; preserves package and metadata identity. |
| Character description | Active revision managed metadata | server-derived `description` | Not editable; preserved in generated metadata. |
| Runtime profile | Validated `asset.profile` plus managed metadata/animations | server-resolved internal `profile` object | Not editable; v1 supports registered `topdown_rpg_v0`; unknown/conflicting profiles block Preview. |
| Creation time | Preview job clock | server-derived `createdAt` | Not editable; records this derived output. |
| Source provenance | Active revision metadata plus selected managed input | server-derived `source` | Not editable; records `derived_revision` and parent/input identity. |
| Generation provenance | Active revision managed metadata | sanitized server-derived `generation` | Not editable and never triggers a provider call. |
| Source layout | `source.source_layout` | `sourceLayout` | Read-only identity field. |
| Background mode | `background.mode` | `backgroundMode` | Active input modes: `auto`, `passthrough`, `flood`, `edge_palette`; `dual_matte` is enabled only for original-source mode with a valid managed black matte; `alpha_cleanup` is output evidence only. |
| Background tolerance | `background.tolerance` | `backgroundTolerance` | Active integer control, default `24`, range `0..80`. |
| Black matte | `source.black_matte_artifact_ref` | resolved `blackSourceBuffer` | Server resolves the recorded file to a real Buffer; a path string is never passed as the processing buffer. Without it, or in normalized-sheet fallback, `dual_matte` is hidden/disabled with a reason. |
| Component cleanup | `cleanup.component_cleanup` | `componentCleanup` | Active control, default `true`. |
| Minimum alpha | `cleanup.min_alpha` | `cleanupMinAlpha` | Advanced integer, default `18`, range `0..80`. |
| Minimum component area | `cleanup.min_area` | `componentCleanupMinArea` | Advanced integer, default `4`, range `1..64`. |
| Minimum area ratio | `cleanup.min_area_ratio` | `componentCleanupMinAreaRatio` | Advanced number, default `0`, range `0..0.25`. |
| Fixed-region staging | canonical disabled object | processing staging remains off | No active v1 control; historical staging report is read-only because managed source is already post-staging. |
| Manual cut lines | `grid.manual_overrides` | `manualOverrides` | Active only for compatible equal-grid layouts. |
| Anchor | `anchor_offset` | `anchorOffset` | Active integer x/y controls, each `-16..16`. |
| Per-frame nudge | `frame_adjustments` | `frameAdjustments` | Active integer dx/dy for a valid real frame, each `-16..16`. |
| Locked animations | `locked_animations` | `lockedAnimations` | Advanced control; defaults to inherited list. |
| Auto correction | `correction.auto_correct` | `autoCorrect` | Advanced, default `true`. |
| Motion stabilization | `correction.motion_stabilize` | `motionStabilize` | Advanced, default `true`. |
| Motion max shift | `correction.motion_max_shift` | `motionStabilizationMaxShift` | Advanced integer, default `2`, range `0..4`. |
| Pixel Finishing | `pixel_finishing.enabled` | `pixelFinishing` | Active, default `false`. |
| Palette budget | `pixel_finishing.max_colors` | `pixelFinishingMaxColors` | Active integer when finishing is enabled; default `16`, range `1..256`. |
| Outline | `pixel_finishing.outline` | `pixelFinishingOutline` | Active when finishing is enabled; default `true`. |
| Outline mode | `pixel_finishing.outline_mode` | `pixelFinishingOutlineMode` | Active when outline is enabled; `outer`, `inner`, `both`, or `none`; default `outer`. |
| Style report | `style_report.enabled` | `styleReport` | Forced to `true` for authoritative Preview evidence and shown in the draft. |
| Style report palette budget | `style_report.max_colors` | `styleMaxColors` | Integer `1..256`; defaults to the visible finishing/report palette budget, `16`. |
| Output frame sizes | `outputs.frame_sizes` | `outputFrameSizes` | No active v1 control; canonical documented default `[96, 64, 48, 32, 16]` feeds the existing multi-resolution builder. |
| Style enforcement | No current Recipe or processing contract | `styleEnforcement` | Unsupported in the current local pipeline; no control and no silent value. |
| Pixel Grid Refinement | No current `processSheetBuffer` option | none in this path | Disabled/hidden in v1 pending separately approved contract integration. |

The implementation handoff must reproduce this table, list any newly
discovered option, and confirm that no submitted value is silently disconnected.

The current documentation-only Recipe draft's `outputs.scales` /
`outputScales` mapping is not consumed by `processSheetBuffer` and therefore is
not a v1 contract. Before exposing the route, the Recipe protocol, factory,
validator, mapping, and tests must use `outputs.frame_sizes` /
`outputFrameSizes`. A legacy Recipe containing only `outputs.scales` may be
opened through a migration adapter, but it is normalized to the documented
frame-size default and shows `legacy_output_scales_migrated`; scale values are
not silently reinterpreted as frame sizes. Canonical hashes and accepted
Recipe artifacts always use `outputs.frame_sizes`.

The current adapter's `motionMaxShift` output is also disconnected from the
frame pipeline. Before exposing the route,
`recipeToCharacterProcessingOptions()` must map the unchanged Recipe field
`correction.motion_max_shift` to `motionStabilizationMaxShift`. A behavior test
with controlled drifting frames must prove that distinct valid values change
the real stabilization corrections; testing only object shape is insufficient.

### Pipeline-effective validation and canonicalization

The Recipe that is hashed, executed, returned, and persisted must be the same
canonical, pipeline-effective object. The server rejects out-of-range or
ill-structured user values instead of relying on downstream clamping. In
addition to the table above:

- `grid.manual_overrides` is `null` or full `columns`/`rows` boundary arrays
  for a compatible uniform grid; lengths must be grid-count plus one, values
  must be integers, start at zero, end at the real managed input dimension,
  remain in bounds, and be strictly increasing; normalized-sheet fallback and
  fixed-region inputs require `null`;
- `frame_adjustments` is a canonical object keyed by a valid profile frame
  index, with only integer `dx`/`dy` fields in `-16..16`; zero-shift entries are
  removed; a safe but unapplied request such as `would_crop` remains visible in
  the real report and UI;
- every `locked_animations` id must exist in the resolved profile, and the
  canonical list is unique and follows profile animation order;
- `fixed_region_staging` must be exactly disabled with nullable tuning fields;
  historical non-disabled values are not inherited into the clean draft;
- the request carries `implementation_revision: null`; the server replaces it
  with its current git/build revision before the authoritative hash and writes
  the same value into reprocess context;
- `style_report.enabled` must be `true` for a Workbench Preview;
- v1 `outputs.frame_sizes` must equal the documented default because no output
  size control is active;
- `alpha_cleanup` may be reported as the result of `auto`, but is rejected as
  a requested background mode because the current explicit branch would not
  honor it;
- `dual_matte` requires the selected revision's valid managed black-matte
  artifact and resolved Buffer; missing input rejects the Recipe instead of
  taking the pipeline's flood fallback.

Source-aware checks use the resolved managed input dimensions and profile
before the job is created. Protocol validation, option mapping, and processing
tests must share these domains so a passing Recipe cannot be silently clamped,
ignored, or routed through an undocumented mode. Legacy migration and immutable
identity rebinding happen before the clean `draft_settings_hash`; server
validation and canonicalization happen again before both authoritative
submitted hashes.
After canonicalization, documented data-dependent behavior such as `auto`
candidate selection, an inconsistent dual-matte pair falling back with a real
warning, or a safe `would_crop` diagnostic may affect the result. Otherwise the
adapter and pipeline must not clamp, drop, or reinterpret a configuration value
without that behavior being represented in the Recipe and evidence.

The orchestration layer resolves `black_matte_artifact_ref` after path safety
checks and supplies the resulting Buffer as `blackSourceBuffer`; the current
adapter behavior of returning the reference string directly is not an allowed
Workbench processing call.

Existing processing settings that are intentionally not editable remain fixed
and covered by binding tests: matte residue cleanup `true`, tolerance `40`,
passes `2`; edge decontamination `true`, max distance `112`, strength `0.55`;
Pixel Finishing outline color `[24, 24, 32]`; layout source preprocessing
enabled; and no `promptText`. Their meaning is versioned by
`implementation_revision`. Changing one requires a deliberate Recipe/default
contract review, not a silent pipeline-default change.

## Quality And Acceptance Policy

| Preview quality | Accept behavior | Resulting production state |
| --- | --- | --- |
| `pass` | Enabled | Existing default mapping, normally `ready`. |
| `warning` | Enabled only after explicit warning confirmation | `review_required`. |
| `fail` | Disabled | No project change. |
| `unknown` or missing report | Disabled | No project change. |

Acceptance also requires:

- preview job status `done`;
- current `draft_settings_hash` equal to submitted `draft_settings_hash`;
- full `recipe_hash` equal across the job record, Recipe artifact, reprocess
  context, and acceptance request;
- selected asset and parent revision unchanged;
- project revision equal to the expected revision;
- required Character Pack artifacts present;
- no unresolved path or Recipe validation error.

### Existing job-status interpretation

The Workbench does not add or rename job-store statuses. It derives honest UI
states from the existing status plus artifact evidence:

| Existing job status and evidence | Workbench state | Review/accept behavior |
| --- | --- | --- |
| `queued` or active processing status | `queued` / `processing` | Progress only. |
| `done` + complete artifacts + validation `pass` | `ready` | Inspect and accept. |
| `done` + complete artifacts + validation `warning` | `warning` | Inspect; accept only after confirmation. |
| `failed_post_processing` + complete required artifacts + valid report with validation `fail` | `blocked_quality` | Inspect real output; never accept. |
| `failed_post_processing` without complete artifacts or a valid fail report | `failed` | Processing/integrity failure; no authoritative comparison. |
| other terminal failure status | `failed` | Show the real failure reason; never accept. |

This distinction preserves the standard Character Pack writer's current
`failed_post_processing` behavior while separating an inspectable quality gate
from a broken or incomplete processing run. Acceptance still requires the
underlying status `done`; `blocked_quality` never satisfies it.

## Error And Lifecycle Handling

Required states:

- no project;
- no selected asset;
- unsupported asset kind;
- missing or unsafe source artifact;
- invalid Recipe;
- queued;
- processing;
- ready;
- stale;
- warning confirmation required;
- blocked quality gate (`blocked_quality`);
- failed processing (`failed`);
- project revision conflict;
- asset revision changed;
- project/asset switched during processing.

Failure rules:

- keep the draft after processing failure;
- leave the current revision active;
- ignore late results using a selection token or request generation id;
- clear polling and image work on project switch or teardown;
- do not retry provider or local processing implicitly;
- show the real job failure status and reason;
- never downgrade a blocking result to a generic warning.

## Accessibility And Keyboard

- Stage and filmstrip have visible focus indicators.
- Arrow-key frame navigation is scoped to the focused filmstrip and never
  steals arrows from form controls.
- Comparison modes and overlays expose pressed/selected state.
- Async transitions and acceptance results use `aria-live`.
- Disabled controls include an accessible reason.
- Canvas evidence has a textual metric/diagnostic equivalent.
- Long clip names and revision ids truncate visually but retain accessible
  text.

## Performance

- No fetch, image decode, or DOM layout read inside animation RAF.
- Cache decoded artifacts by job/revision and controlled URL.
- Use `imageSmoothingEnabled = false` for pixel rendering.
- Only the selected clip animates in the comparison Canvas.
- Draft control changes do not enqueue work.
- One explicit Build creates one job.
- No new renderer dependency is justified in v1.
- Add request cancellation when practical; at minimum stale results must be
  token-guarded and unable to mutate the active workspace.

## Testing

### Pure state and Recipe tests

- default draft from a revision with and without a Recipe;
- historical Recipe parameters plus clean source-identity rebinding to the
  current active revision;
- historical fixed-region staging is retained only as evidence while the clean
  reprocess Recipe forces staging off;
- legacy output-scale migration without dirtying the opening snapshot;
- full `recipe_hash` and revision-neutral `draft_settings_hash` stability with
  shared server/Web Crypto golden vectors;
- option mapping, effective ranges, requested background modes, and documented
  defaults;
- fixed non-editable processing defaults and exact v1 output-size set;
- motion max-shift values change real stabilization corrections on a controlled
  drifting-frame fixture;
- manual-grid and frame-adjustment shape/bounds rejection;
- path and secret rejection;
- draft dirty/stale transitions;
- pass/warning/fail acceptance state;
- clip/frame selection and horizontal-filmstrip model.

### API and store tests

- controlled managed source resolution;
- black matte resolves to a Buffer, while a raw reference string never reaches
  `processSheetBuffer`;
- absolute path and `..` rejection;
- `realpath` containment after resolution and symlink-escape rejection;
- directory-as-file and non-regular artifact rejection;
- submitted/recorded full Recipe hash mismatch rejection, including rejection
  when `draft_settings_hash` is supplied in its place;
- modified or cross-asset reprocess context rejection;
- source asset, source job, and source-layout binding rejection;
- profile/metadata conflict and missing managed metadata rejection;
- asset name, description, source, generation, profile, and new creation time
  are derived into Preview metadata without client overrides;
- local reprocess passes no prompt and makes no provider call;
- project and asset revision conflicts;
- local reprocess job creation without provider calls;
- standard artifact production plus Recipe/context evidence;
- exact preview job import as a parented child revision;
- specialized acceptance rejects a non-reprocess or wrong-type job even when
  it contains otherwise importable Character Pack artifacts;
- the general import route rejects `editor_character_reprocess` while retaining
  legacy-job behavior;
- two concurrent accepts from one project revision produce exactly one success,
  and the successful revision's managed Recipe/context and artifact hashes
  match only its accepted job;
- revision directories use exclusive no-replace creation and orphaned paths are
  never selected for a later revision;
- `processing_recipe_ref` copied into managed storage;
- validated reprocess context copied as immutable managed provenance;
- failed/warning quality policy;
- old project, source revision, and generated artifacts remain unchanged.

### UI tests

- no project, no selection, unsupported asset, and missing artifact states;
- real frame filmstrip and keyboard navigation;
- Before/After/Split/Difference/Onion availability;
- geometry overlay updates without server requests;
- explicit Build and polling states;
- adding the server implementation revision during Build leaves an otherwise
  unchanged draft fresh;
- stale Preview disables Accept;
- editing a processing setting makes that Preview stale;
- Reset restores the clean opening snapshot and returns to fresh only when that
  Preview was built from the opening settings;
- Discard clears the session without changing project state or deleting jobs;
- late poll/image completions after project, asset, or revision switch cannot
  update the active workspace;
- warning confirmation and blocking quality gate;
- AI Action Repair remains separate and quota-confirmed;
- form controls do not trigger frame keyboard shortcuts;
- no fake active Pixel Grid Refinement control;
- no active fixed-region staging control for managed revision sources;
- `dual_matte` is enabled only with a valid managed black matte and is
  unavailable with a clear reason otherwise or during sheet fallback.

### Browser verification

- `1440 x 900`, `2048 x 963`, and `390 x 844`;
- no horizontal page overflow;
- full-height Recipe and bottom horizontal filmstrip behavior;
- increasing real frame counts scroll within the filmstrip;
- focus rings, long names, narrow Recipe drawer, and reachable actions;
- no relevant console errors or warnings;
- real artifacts only.

### Required commands

```bash
git status --short
git diff --check
npm test
npm run smoke:local
```

The implementation report must include the actual full-suite pass count and
must distinguish local verification from any independent CI status.

## Rollout And Work Boundaries

The implementation plan should split this design into coherent verified units:

1. Contract foundation: replace the disconnected output-scales mapping with
   canonical output frame sizes; add Recipe/provenance and pure repair-state
   contracts; update `docs/protocols/processing-recipe-v0.md`,
   `docs/protocols/local-api-boundaries.md`,
   `docs/protocols/character-pack-artifacts.md`, and the
   existing-status-to-Workbench-state mapping. The Recipe document remains
   `Draft, documentation-only` until that same verified unit lands the factory,
   validator, option mapping, migration, and tests; it may then mark the
   Character Workbench portion active.
2. controlled local Editor reprocess endpoint through the injected shared
   queue service and hardened managed-path resolver;
3. managed Recipe artifact import and serialized, no-overwrite parent revision
   acceptance under the shared project mutation lock;
4. Comparison Canvas, Recipe panel, and bottom filmstrip;
5. quality/error/accessibility states and browser verification.

Do not advance several units in one uncontrolled change. Do not modify
protected Character Pack pipeline files merely to activate a designed control.
If active Pixel Grid Refinement is desired, stop and request explicit approval
for that separate protected-contract scope.

## Definition Of Done

- The user can select a real managed Character Pack revision in `/editor`.
- Every active control maps to a real processing option or documented default.
- Build Preview creates one provider-free real job.
- The workbench displays real before/after animation and quality evidence.
- Stale, warning, blocking, failure, and conflict states are honest.
- Accept imports the exact preview job as a new child revision.
- Concurrent accepts cannot overwrite or mix revisions; one conflicting request
  fails cleanly.
- Reset, Discard, and every failure leave project state unchanged.
- The old `/` UI, Character Pack flows, Action Repair, APIs, providers,
  validators, exporters, and project-pack behavior remain available.
- No external code, UI, assets, or private behavior are copied.
- Complete tests and local smoke pass.

## Repository Hygiene Note

At design time, the working tree contained unrelated untracked `* 2.js` /
`* 2.md` duplicate files and local `.superpowers/` visual-companion evidence.
They are not part of this design and must not be staged, edited, or deleted by
the implementation task.
