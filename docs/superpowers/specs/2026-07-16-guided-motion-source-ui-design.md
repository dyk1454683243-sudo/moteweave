# Guided Motion Source UI/HUD Design

**Date:** 2026-07-16  
**Status:** Implemented and guarded-verified in `493f609`
**Owner:** Project lead  
**Target surface:** Provider-free browser Motion Source workflow  
**Implementation baseline:** `36b6397` on
`codex/frame-repair-live-quality-gate`
**Design commit:** `18c117b`
**Implementation commit:** `493f609`

## 1. Design Source And Lineage

This repository-owned specification is the design source for block E. It is
derived from:

- `docs/superpowers/plans/2026-07-16-character-production-quality-master-plan.md`
- `docs/protocols/motion-source-pipeline.md`
- the current Motion Source UI in `index.html`, `src/v8.css`, and
  `src/ui/motionSourceTab.js`
- the implemented B, C, and D contracts

The external suggestion page is prioritization evidence only. No external code,
UI, algorithm implementation, copy, icon, prompt, or asset is used.

The selected baseline contains the accepted Motion Source browser lineage:

- `7713ff0` initial browser entry
- `b9730bd` Source Set apply UI
- `0aa72ba` frame Preview workflow
- `043ebea` Correctness and Safety v1
- `0a6353a` Pixel Grid v2 browser binding
- `f6a6a03` Motion Selection v2 backend/report contract

No prior accepted Motion Source UI branch is omitted. The separate exclusive
implementation worktree is not part of this UI baseline and must remain
untouched.

## 2. Product Decision

Add a five-step Guided view beside the existing Advanced view. Guided becomes
the default browser presentation, while Advanced preserves every existing
control, action, Source Set operation, report, preview, and artifact link.

Both views operate on one shared source, one shared state model, one shared
workspace, and the existing real API. Guided does not introduce a second
pipeline, fake data, a Provider call, or a new persisted contract.

Guided and Advanced must also share the existing single UI operation
controller, AbortController, lifecycle handle, source epoch, render token, and
job stores. Guided actions delegate to the same action functions; they must not
register a parallel poller, upload, cancel path, or competing operation state.

The five steps are:

1. Source
2. Select
3. Clean & Build
4. Review Evidence
5. Apply & Export

## 3. Layout Contract

### 3.1 Shared shell

The Motion Source tab contains:

1. a top view switch with `Guided` and `Advanced`;
2. one left rail, showing either the new Guided steps or the existing Advanced
   settings;
3. the existing shared preview/report workspace;
4. the existing shared artifact rail.

The old Advanced workflow is hidden only while Guided is selected. It remains
reachable in one click and is not deleted, stubbed, or replaced.

### 3.2 Desktop

- Three columns: `340px / minmax(0, 1fr) / 300px`.
- Guided step cards are vertically stacked, numbered, and show one of:
  `waiting`, `ready`, `running`, `needs review`, `blocked`, or `complete`.
- The workspace toolbar keeps the real job status and adds visible Cancel and
  Resume actions when their existing lifecycle authority permits them.
- The evidence HUD is a six-card grid above the raw report:
  Source, Selection, Loop/Phase, Cleanup, Pixel Grid, and Binding.
- Existing frame preview, contact sheet, normalized strip, applied sheet, raw
  JSON, selected-frame list, frame picker, and artifact links remain visible.

Job lifecycle and evidence outcome are separate visual states. A server job may
be `done` while the bound report is `warning`; Guided then shows
`Needs review`, not Complete. A missing, stale, or unreadable bound artifact
shows `Blocked` or `Evidence unavailable`, even when the job itself reached
`done`.

### 3.3 Tablet and mobile

- At `<=1180px`, the artifact rail moves below the workspace.
- From `761px` through `1180px`, the page uses document scrolling instead of a
  clipped fixed-height workspace; previews, the evidence HUD, and report panels
  use one column, and the frame picker may expand vertically.
- At `<=760px`, the rail, workspace, HUD, previews, reports, and artifacts stack
  in one column.
- The view switch stays horizontally reachable without page-width overflow.
- Buttons have at least a 40px visual height in Guided view.
- Frame cards keep their controls in source order and do not require horizontal
  scrolling.

## 4. Guided Step Inventory

### Step 1: Source

Visible:

- Select/replace source button wired to the existing raw-file input.
- File name, byte size, dimensions/duration when known.
- Source identity state: pending upload or abbreviated SHA-256.
- Local FFmpeg/rembg availability from the real tool-status endpoint.
- Analyze action.

Blocked states:

- over the existing source-size ceiling;
- video selected while FFmpeg is unavailable for Preview/Build;
- stale server session requiring re-upload.

### Step 2: Select

Visible real controls:

- Runtime action derived at runtime from all entries in
  `TOPDOWN_RPG_V0.animations`; the UI must not maintain a second hard-coded
  action list.
- Target frame count.
- Selection authority: Auto or Manual.
- Selection recipe:
  `motion_selection_recipe_v2` or `motion_selection_v1_compat`.
- Loop expectation: Auto, Loop, or Once.
- Temporal matte: Disabled or Evidence only.
- Preview Frames action.
- Restore Auto action.

Guided defaults:

- Auto selection.
- `motion_selection_recipe_v2`.
- Loop expectation Auto.
- Temporal matte Disabled.
- Target frame count from the selected `topdown_rpg_v0` action contract
  (`4` for the current profile), so the default `reject_mismatch` Apply path is
  internally consistent.

Advanced keeps v1 compatibility selectable and does not lose its sampling
controls.

Recipe dependencies fail closed in the UI:

- With `motion_selection_recipe_v2`, Loop expectation and Temporal matte use
  their visible real controls.
- With `motion_selection_v1_compat`, Loop expectation is forced to `auto` and
  disabled; Temporal matte is forced to `disabled` and disabled. Explanatory
  copy states that those options require v2.
- Switching back to v2 restores valid user-selectable controls without
  inventing a previous invalid combination.

Target frame count remains independent user/contract intent. Manual selection,
removal, and reordering must never rewrite it to the selected-card count.
Differences are reported through D's real `manual_target_count_mismatch`
evidence.

Restore Auto must restore the complete immutable Preview candidate list in
canonical candidate order, clear manual selection, and return authority to
Auto. It must not merely uncheck the currently remaining cards.

Each frame card shows:

- candidate index;
- raw source index;
- timestamp/duration when available;
- source entry when available;
- selected/manual state.

The UI preserves the complete Preview provenance record, not only
`source_index` and the thumbnail URL.

Preview status is always phrased as `Candidates ready`. Preview does not run
the automatic selector and must never be labeled `Selection complete`.

### Step 3: Clean & Build

Visible real controls:

- Background method.
- Tolerance.
- Pixel Grid recipe.
- Build Strip action.
- Advanced-settings link for key color, defringe, sampling, static offset, and
  other existing controls.

Pixel Grid remains Disabled by default because enabling it mutates pixels.
Available C recipes map exactly to the implemented recipe ids.

### Step 4: Review Evidence

The HUD renders only real report evidence:

- Source: source kind/count and bound identity.
- Selection: recipe, authority, selected/target count, target satisfaction.
- Loop/Phase: expectation, static/periodic/ambiguous state, selected period or
  fallback.
- Cleanup: halo before/after and background warnings.
- Pixel Grid: disabled/refined/passthrough status, recipe, consensus/shared-grid
  evidence, and warnings.
- Binding: source identity, operation id, options hash, and current/stale state.

The raw JSON panel remains the authoritative detailed report. Missing fields
render as `Not run` or `Unavailable`; the UI must not synthesize scores or
semantic judgments.

Manual + v2 reports render registration, clustering, periodicity, phase
selection, and temporal matte as `Not run — Manual authority`, never as Pass.
Pixel Grid `passthrough_normalization_incompatible` renders as `Not applied`
even when source-frame refinement itself completed.

### Step 5: Apply & Export

Visible:

- Select target normalized sheet.
- Optional edited-strip override.
- Resample strategy.
- Apply Strip action.
- Existing real artifact downloads.
- Advanced entry to Source Set Analyze/Apply.

The latest built strip may be applied only while its source/options binding is
current. An explicitly selected edited-strip override is separate user
authority and may be applied even when the previous browser build is stale.

With `reject_mismatch`, Guided preflights the built strip frame count against
the selected action's real profile count and blocks Apply with an actionable
message when they differ. `nearest_keyframes` remains the explicit real
resampling path.

Artifact copy must state that Motion Source exports strips, sequence files, and
an applied normalized sheet. Complete Godot, RPG Maker, and OCAD packs remain
the existing Character Pack export workflow and are not claimed here.

## 5. Stale And Provenance Contract

### 5.1 Preview binding

After Preview, store:

- source epoch;
- source identity;
- operation id;
- options hash;
- a deterministic client options fingerprint;
- Preview artifact URL;
- an immutable copy of every candidate and its provenance.

Candidate freshness uses a dedicated sampling fingerprint covering `stride`,
`fps`, `maxFrames`, `startSec`, and `endSec`. Manual Build is blocked if the
current source or sampling fingerprint no longer matches the Preview binding.
The user must Preview again. Selection and cleanup changes do not falsely claim
that the extracted candidate identities changed.

Guided Auto Build requires a current Preview so the step sequence and displayed
evidence cannot disagree. Advanced Auto Build retains the existing direct-build
path.

### 5.2 Build binding

After Build, store the report plus:

- source epoch and identity;
- operation id and server options hash;
- the client options fingerprint used for Build.

The Build fingerprint contains exactly:

- runtime action and target frame count;
- selection mode and ordered Manual indexes when Manual;
- Motion Selection recipe, loop expectation, and temporal matte;
- stride, fps, max frames, start sec, and end sec;
- background method, key color, tolerance, and defringe;
- static Y offset;
- Pixel Grid recipe or Disabled.

Apply-only resample strategy is not a strip-byte input and does not stale the
built strip. It is evaluated separately by the Apply compatibility preflight.

Applying the latest built strip is blocked when that binding is stale. Changing
any Build-affecting setting does not delete diagnostic evidence; it marks the
evidence stale and requires a new Build before Apply.

### 5.3 Artifact assertions

Existing source identity, operation id, options hash, job id, and source epoch
assertions remain mandatory. Guided rendering occurs only after those checks.

## 6. Parameter Binding Contract

| UI field/action | Existing request binding | Authority |
| --- | --- | --- |
| Source file | raw `POST /api/motion-source/uploads` | existing B upload |
| Runtime action | `options.action` | real contract runtime action |
| Target frames | `options.frames` | real target count |
| Auto/Manual | `options.selection_mode` | real B authority |
| Manual frames | `options.selected_frame_indexes` only in Manual | real candidate indexes |
| Selection recipe | `options.motion_selection.recipe` | real D recipe |
| Loop expectation | `options.motion_selection.loop_expectation` | real D setting |
| Temporal matte | `options.motion_selection.temporal_matte` | D evidence-only mode |
| Sampling | `stride`, `fps`, `maxFrames`, `startSec`, `endSec` | existing Advanced controls |
| Background | `options.background` | existing local cleanup |
| Static offset | `options.anchor_policy.static_offset_y` | existing local alignment |
| Pixel Grid | `options.pixel_grid_refinement` or omission | real C recipe |
| Resample | `options.output_profile.resample_strategy` | existing apply behavior |
| Target sheet / edited strip | existing Apply request | explicit user files |
| Cancel / Resume | existing Motion lifecycle endpoints/poller | real B lifecycle |

No Provider, exporter, process-sheet, validator, job-state, or server endpoint
contract changes are required.

Manual edits do not modify `options.frames`; they only change
`selected_frame_indexes`.

Cancel is active only for bound Analyze, Preview, and Build jobs. Apply Strip
and Source Set operations use their existing non-cancellable behavior; Guided
must not imply otherwise. Resume is same-process exact-job observation, not
cross-restart persistence.

## 7. Capability Truth Table

| Capability | UI treatment |
| --- | --- |
| Raw upload, Analyze, Preview, Auto/Manual, Cancel, Resume | Active and real |
| Motion Selection v2 registration/clustering/periodicity | Active through recipe control and evidence HUD |
| Temporal matte | Active only as `Evidence only`; copy states that it does not change pixels |
| Pixel Grid v2 | Active, opt-in, exact implemented recipes |
| Background cleanup / local rembg | Active only when the existing tool-status check permits |
| Apply Strip / Source Set | Active through existing APIs |
| Semantic action-phase recognition | Disabled, `Coming later` |
| Adaptive candidate generation or automatic extra Provider spend | Disabled, `Coming later` |
| Automatic missing-frame invention | Not shown as active; explicitly unsupported |

Source Set remains an Advanced workflow; Guided links to it without implying an
automatic multi-action planner.

## 8. Accessibility And Internationalization

- All new visible copy has English and Chinese keys in `src/ui/i18n.js`.
- View-switch buttons expose `aria-pressed`.
- The Motion Source tab button owns `id="motion-source-tab"` so the existing
  panel `aria-labelledby` reference resolves.
- The main module-tab switch keeps `aria-selected`, `aria-controls`, and panel
  visibility aligned with the active class.
- Step status text is not color-only.
- Dynamic HUD/status text uses the current language and rerenders after the
  language selector changes.
- The shared job status keeps `role="status"` and polite live updates.
- Every icon-like status mark has text.
- Disabled future controls include an explanatory description.
- Keyboard focus order follows Source through Apply; no custom roving focus is
  required.
- Guided controls and Frame Picker actions have a visible `:focus-visible`
  treatment.
- Frame Picker rerenders preserve focus by candidate identity and action where
  possible; after removing the focused card, focus moves to the nearest
  remaining card control or the Restore Auto action.

## 9. State Coverage

Required visual states:

- no source;
- source selected / upload pending / bound;
- source too large;
- required local tool unavailable;
- Preview absent / running / current / stale / failed;
- Auto and Manual authority;
- no manual frames;
- Build running / warning / complete / stale / failed;
- target shortfall;
- static sequence;
- periodic loop;
- once action;
- ambiguous period;
- Pixel Grid disabled / refined / passthrough / warning;
- polling paused / resumable;
- cancellation in progress / cancelled;
- target sheet absent;
- Apply complete;
- server session expired;
- long file names, long warnings, and mobile overflow.

## 10. Deviations And Protected Boundaries

- There is no external pixel-perfect mockup. This specification is the approved
  visual baseline, so no Figma/Pencil parity claim is made.
- The existing raw JSON report and Advanced controls remain because they expose
  implemented capabilities not represented by the compact Guided rail.
- Source Set inputs remain Advanced-only; Guided links to them instead of
  duplicating a complex multi-file workflow.
- No protected backend, provider, validator, exporter, prompt, profile, or
  persisted protocol file may be changed for visual convenience.

## 11. Verification Contract

- Focused static/unit tests cover five-step structure, action inventory,
  D/C option serialization, full Restore Auto semantics, stale gates, truthful
  future-disabled states, i18n, and accessibility attributes.
- Guarded Motion UI/API tests run serially.
- A resource-bounded local browser verification checks desktop and mobile,
  Guided/Advanced switching, empty/disabled states, overflow, console errors,
  and real provider-free Analyze/Preview/Build/Apply wiring where existing local
  fixtures permit.
- Responsive checkpoints include at least 1440px, 1024px, 800px, and 390px.
- No live Provider call is allowed.

Implementation closure on 2026-07-16 satisfied this contract. The final
provider-free Chrome matrix covered all four responsive checkpoints, real
Guided/Advanced operations, stale and unreadable evidence, Preview/Build/Apply
gates, same-store and cross-store image failures, failed-retry preservation,
edited-strip authority, i18n, focus/navigation reachability, and zero console
errors. The final guarded full suite passed `1431 / 1431`; two independent
read-only reviews reported no remaining Blocker/High.
