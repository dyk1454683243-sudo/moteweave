# Phase B1: Motion Source Options Model Light Split

**Date:** 2026-07-30
**Status:** Implemented and merged in PR #21 on 2026-07-30
**Baseline:** `e3d3ce8ca8a25913f381ac34a7a0eade83b692ba` (PR #20 merge)
**Scope:** A small UI-only structural split of the approximately 2301-line
`src/ui/motionSourceTab.js`.

## Goal

Make Guided and Advanced read and write one in-memory Motion Source options
model, then serialize that model through one owner for Preview, Build Strip,
Apply Strip, and Apply Set. Reduce duplicated control-copying and option-reading
logic without changing visible UI, real-data behavior, request payloads, request
ordering, or protected contracts.

This phase is successful only when the refactor is behavior-preserving. It is
not a redesign or a pipeline change.

## Non-goals And Prohibited Changes

- Do not modify `server.js`, any Motion Source pipeline module, any protocol,
  provider or provider configuration, job status or lifecycle semantics,
  `src/ui/shell.js`, `index.html`, `src/v8.css`, or the v8 visual design.
- Do not change `src/ui/motionSource/api.js` or
  `src/ui/motionSource/guidedState.js`; they are read-only boundaries for this
  phase.
- Do not change endpoints, HTTP methods, payload key names, upload bodies,
  operation ids, source identity/options hashes, polling intervals, timeouts,
  retry delays, abort/resume/cancel behavior, artifact fetching, or release
  cleanup.
- Do not add TypeScript, a bundler, framework, dependency, storage layer,
  migration, feature flag, compatibility alias, or generalized form library.
- Do not add controls, remove controls, change copy, defaults, validation,
  enabled/disabled states, focus behavior, responsive behavior, or Guided /
  Advanced navigation.
- Do not introduce mock data, sample artifacts, provider calls, or a new
  provider requirement. Motion Source remains local and provider-free.
- Do not address npm advisories in this phase.
- Do not split rendering, job orchestration, artifact handling, frame picking,
  or file/upload handling merely to reduce line count. A large rewrite is
  explicitly out of scope.

## Current Data Flow

1. `initMotionSourceTab()` initializes the Advanced controls, mirrors selected
   values into Guided, binds both control surfaces, and defaults to Guided view.
2. Advanced controls currently act as the option source of truth.
   `syncGuidedControlsFromAdvanced()` copies paired values into Guided.
   Guided handlers copy their value back into the matching Advanced control.
3. `readMotionOptions()` rereads Advanced DOM controls and combines them with
   `state.motionSource.frameSelection`. `snapshotMotionOptions()` creates the
   JSON-safe request snapshot.
4. Preview and Build take one snapshot before starting the upload/job sequence.
   Candidate and build fingerprints are derived from that same snapshot.
5. The API layer uploads the original source file, posts the source upload id,
   source identity, operation id, and options, then polls the exact job id.
   Apply Strip and Apply Set serialize their existing file inputs plus the same
   options object.
6. Real job reports and artifacts are fetched, binding-checked, and committed to
   `state.motionSource`; Guided status cards and action gates render from that
   real evidence.

## Protected Behavior Invariants

- Guided and Advanced expose the same current value for every paired option.
  Switching views does not reset, normalize differently, or otherwise mutate
  options.
- A user event updates the model synchronously before staleness, compatibility,
  button-state, or Guided rendering is recomputed.
- The v1 selection dependency remains exact: selecting
  `motion_selection_v1_compat` forces loop expectation `auto` and temporal
  matte `disabled`, and disables those controls while applicable.
- Choosing an action in Guided still sets target frames to that runtime
  action's profile count. Choosing an action in Advanced keeps the current
  target-frame value, matching today's behavior.
- Restore Auto still clears manual authority through the existing frame
  candidate path. Manual ordering and selected indexes remain owned by
  `state.motionSource.frameSelection`.
- Preview freshness depends only on source epoch, source identity, and sampling
  fingerprint. Build freshness continues to cover all strip inputs and exclude
  Apply-only resampling.
- Apply compatibility, edited-strip authority, stale evidence, target-frame
  mismatch, and server-validation-required behavior remain unchanged.
- Preview and Build use the immutable options snapshot captured before their
  request begins. Later UI changes cannot mutate an in-flight request.
- Upload happens before a bound source job; operation id reuse, source
  descriptor validation, request start, polling, artifact validation, and UI
  commit stay in their current order.
- The existing terminal job states, polling pause/resume, cancellation,
  uncertain-transport recovery, bounded artifact fetches, and upload release
  retries are untouched.
- No provider endpoint or key is used. All reports, previews, strips, and apply
  results remain real local job artifacts.

## Single Options Model Contract

Add a small pure module,
`src/ui/motionSource/optionsModel.js`. It owns canonical option values,
defaults, immutable updates, dependency normalization, and API serialization.
It must not import DOM helpers, application state, API functions, or pipeline
code. `motionSourceTab.js` owns the single model instance and renders its values
to both control surfaces.

The model fields and baseline defaults are:

| Model field | Default | API ownership |
|---|---:|---|
| `action` | `walk_down` | `options.action` |
| `targetFrameCount` | current `walk_down` profile count (`4`) | `options.frames` |
| `selectionMode` | `auto` | `options.selection_mode` |
| `selectionRecipe` | `motion_selection_recipe_v2` | `options.motion_selection.recipe` |
| `loopExpectation` | `auto` | `options.motion_selection.loop_expectation` |
| `temporalMatte` | `disabled` | `options.motion_selection.temporal_matte` |
| `stride` | `1` | `options.stride` |
| `fps` | `12` | `options.fps` |
| `maxFrames` | `64` | `options.maxFrames` |
| `startSec` | `0` | `options.startSec` |
| `endSec` | `null` | `options.endSec` |
| `backgroundMethod` | `key_color` | `options.background.method` |
| `keyColor` | `[255, 255, 255]` | `options.background.key_color` |
| `backgroundTolerance` | `24` | `options.background.tolerance` |
| `defringe` | `true` | `options.background.defringe` |
| `staticOffsetY` | `0` | `options.anchor_policy.static_offset_y` |
| `pixelGridRecipe` | `disabled` | omit `options.pixel_grid_refinement` |
| `resampleStrategy` | `reject_mismatch` | `options.output_profile.resample_strategy` |

Serialization rules:

- The new module calls the existing
  `serializeMotionSelectionOptions()` validator/serializer. It does not
  duplicate those accepted values or loosen fail-closed behavior.
- It moves `serializeMotionPixelGridRecipe()` out of
  `motionSourceTab.js` without changing its public behavior: `disabled` omits
  the payload key; supported recipes serialize as `{ recipe }`; unknown values
  throw.
- Numeric form values are converted at the same boundary and with the same
  empty-value behavior as today. `endSec` alone serializes empty input as
  `null`.
- Key color remains exactly three numeric channels in the existing array order.
- `selected_frame_indexes` is derived at serialization time from the existing
  ordered `frameSelection`, included only for manual mode, and omitted for auto
  mode.
- No default-only field is newly omitted, and no omitted optional field is
  newly emitted. Object key spelling and nesting remain byte-for-byte
  JSON-equivalent after `JSON.stringify`.
- Resampling stays in the serialized options for Apply requests but remains
  excluded from the existing Build fingerprint.

## Guided / Advanced Two-way Synchronization

- Every paired Guided or Advanced handler maps its control to one named model
  patch. There is no control-to-control copying.
- After a valid patch, one render function writes the model to both surfaces,
  including checkbox state, numeric/text values, tolerance labels, and
  dependency-disabled states.
- Advanced-only sampling, key-color, defringe, and static-offset controls update
  the same model even though Guided has no duplicate control.
- Guided-only action convenience preserves its current side effect of resetting
  target frames to the selected action's profile count. The Advanced action
  handler does not gain that side effect.
- Selection mode changes continue to invoke the existing frame-selection
  transition before the model and both surfaces are rendered. A busy operation
  rejects a UI edit and rerenders the current model value.
- Programmatic initialization, language changes, Restore Auto, key-color preset
  buttons, and v1 dependency coercion all pass through the same model update /
  render path.
- Render is one-way and does not dispatch synthetic input/change events, so it
  cannot duplicate requests or staleness transitions.

## Exact Files

Implementation is limited to:

- **Add** `src/ui/motionSource/optionsModel.js`: pure options model, defaults,
  dependency normalization, immutable patching, and API serialization.
- **Modify** `src/ui/motionSourceTab.js`: hold one model instance; replace
  Advanced-DOM reads and Guided/Advanced control copying with model patches and
  one render path; keep all job, artifact, file, and evidence logic in place.
- **Add** `test/uiMotionSourceOptionsModel.test.js`: focused model/default,
  dependency, round-trip, omission, immutability, and payload-equivalence tests.
- **Modify** `test/uiMotionSourceStructure.test.js`: update only structural
  assertions needed for the moved serializer and single-model wiring; preserve
  existing API, lifecycle, artifact, and UI contract assertions.

No other implementation or test file is in scope. In particular,
`src/ui/motionSource/api.js`,
`src/ui/motionSource/guidedState.js`,
`test/uiMotionSourceGuidedState.test.js`, and all protected files remain
unchanged.

## Phases, Small Commits, And Completion Gates

### Phase 1 — Pure model and payload lock

Add `optionsModel.js` and its focused test. Cover every field/default in the
table, both selection recipes and their dependencies, every pixel-grid
serialization case, manual index ordering, auto omission, null `endSec`, and
immutable snapshots. Add a table-driven golden comparison in which the new
serializer equals the current payload shape for defaults and representative
Advanced/manual/apply combinations.

Completion gate:

- Only the new model and new test are changed.
- The model has no DOM, state, fetch, timers, file, or job imports.
- Golden payload comparisons cover every serialized leaf and optional-key rule.
- The focused options-model and existing Guided-state tests pass.
- The guarded full `npm test` contract suite passes before committing.

Commit boundary:

```text
refactor: add motion source options model
```

### Phase 2 — Wire both control surfaces

Change `motionSourceTab.js` to initialize the model, patch it from Guided and
Advanced handlers, render it to both surfaces, and serialize it for current
actions. Move the pixel-grid serializer import to the new module. Do not move
unrelated functions or reorder the async operation code.

Completion gate:

- Guided and Advanced both read from the same model; no paired control-copy
  helper remains.
- All model fields have an existing control or the documented model default.
- Preview, Build, Apply Strip, and Apply Set receive snapshots from the same
  serializer.
- The existing UI structure test and all Phase 1 / Guided-state tests pass.
- The guarded full `npm test` contract suite passes before committing.
- A path-limited diff shows no change in API calls, job sequencing, artifact
  checks, upload cleanup, evidence mapping, or protected files.

Commit boundary:

```text
refactor: wire motion source views to shared options
```

### Phase 3 — Desktop browser smoke and final contract review

Run the provider-free desktop browser smoke below. Make only one minimal
repair-and-verification loop if an unexpected wiring defect blocks the gate.
Do not expand scope or refactor passing code.

Completion gate:

- Focused tests are green under the resource guard.
- Desktop smoke proves two-way values, dependency behavior, real local Preview /
  Build / Apply behavior, and unchanged request payloads/order.
- `git diff --check` passes and the final path-limited diff touches only the
  four listed files.
- Protected-boundary review records zero changes to the prohibited files and
  contracts.

Commit boundary:

```text
test: lock motion source options parity
```

Use this third commit only if Phase 3 requires test-only adjustments. Otherwise
Phase 2 is the implementation stopping point.

## API Payload Equivalence Verification

The options-model test must compare complete serialized objects, not selected
fields:

1. Default auto selection with pixel grid disabled.
2. Advanced sampling range and non-default stride/fps/max frames.
3. v1 selection dependency values.
4. v2 loop plus evidence-only temporal matte.
5. Manual selected indexes in user-visible order.
6. External rembg, non-white key color, tolerance, defringe, and static offset.
7. Each supported pixel-grid recipe and disabled-key omission.
8. `reject_mismatch` and `nearest_keyframes`.

For each case, assert deep equality and equality of `JSON.stringify()` output
between the recorded pre-refactor payload fixture and the new serializer.
Separately assert that Preview and Build receive the snapshot unchanged and
that Apply Strip / Apply Set keep their existing file fields and nest that same
options object under `options`.

The browser smoke must inspect local Network request bodies for
`/api/preview-motion-frames`, `/api/build-motion-strip`,
`/api/apply-motion-strip`, and `/api/apply-motion-source-set` when the
corresponding input files are available. Confirm exact key names/nesting and
the sequence upload -> operation POST -> exact-job polling -> artifact GET.
Do not call a provider endpoint.

## Guarded Focused Tests

Only the primary implementation agent is the test owner. Run one command at a
time, serially:

```bash
npm run test:focused -- \
  test/uiMotionSourceOptionsModel.test.js \
  test/uiMotionSourceGuidedState.test.js \
  test/uiMotionSourceStructure.test.js
```

The checked-in `scripts/run-with-resource-guard.mjs` supervisor must enforce
the complete process tree: V8 old-space at most `1024 MiB`, process-tree RSS at
most `1536 MiB`, wall time at most `60 seconds`, sampling at least once per
second, and termination of the exact process group on breach. Do not run raw
`node --test`, do not overlap any test/build/browser/server process, and do not
retry after a timeout, hang, or memory breach until the responsible lifecycle
or test defect is identified and changed.

After the focused command passes, run the guarded full contract suite once at
each implementation phase gate, as required by the UI guardrail:

```bash
npm test
```

Run it serially with one test owner under the checked-in supervisor: V8
old-space at most `2048 MiB`, complete process-tree RSS at most `4096 MiB`, and
the finite healthy-baseline timeout configured by the repository. Do not run a
build; this UI-only split has no build deliverable.

## Desktop Browser Smoke

Use the repository's guarded local smoke/server entry so the server and browser
remain attached to tracked sessions. Keep the entire smoke under the full
workflow ceiling: V8 old-space at most `2048 MiB`, process-tree RSS at most
`4096 MiB`, a finite timeout based on the known healthy baseline, and one
process-tree sample per second. Stop the exact server/browser process groups at
the end.

1. Open the desktop app at the Motion Source tab and confirm Guided is the
   initial view and Advanced remains visually unchanged.
2. Change every paired Guided field, open Advanced, and verify exact values.
   Change every paired Advanced field, return to Guided, and verify exact
   values. Confirm view switching itself sends no request.
3. Verify the v1 recipe forces/disables Auto + Disabled, then return to v2 and
   verify loop/temporal values and enabled states behave as before.
4. Select a small repository-approved local GIF/ZIP/still fixture. Analyze and
   Preview it through the real provider-free API; confirm real preview
   candidates/artifacts and exact request ordering.
5. Exercise Restore Auto, then select/reorder/remove frames manually. Confirm
   only manual mode emits ordered `selected_frame_indexes`, and changing a
   sampling field makes Preview stale while changing an Apply-only resample
   value does not make Build stale.
6. Build a real strip and confirm real report, selected frames, contact sheet,
   normalized strip, binding, warning/blocking states, and action gates.
7. If the focused fixture set includes an approved target normalized sheet,
   exercise Apply Strip and Apply Set and inspect their payloads and real
   artifacts. If either required fixture is absent, record that substep as
   skipped rather than inventing data or adding a fixture in this phase.
8. Pause/resume or cancel only if the selected local job lasts long enough to
   do so safely; otherwise rely on the unchanged focused lifecycle assertions
   and record the interactive substep as not observed.
9. Confirm Network contains no provider request, no key, and no unexpected
   duplicate Motion Source operation. Stop all tracked processes.

## Rollback

The implementation is split into coherent commits. If Phase 2 fails its gate,
revert only the Phase 2 wiring commit; the pure model commit can remain for
inspection without changing runtime behavior. If the model contract itself is
wrong, revert the Phase 1 commit after Phase 2 has been reverted. Use ordinary
`git revert <commit>` commits; do not use `git reset --hard`, delete worktrees,
or bulk-delete files. Confirm the restored baseline with the same focused tests
and path-limited diff.

## Residual Risks

- Static structure tests cannot prove live DOM event ordering; the desktop
  two-way smoke is required.
- Programmatic rendering may accidentally trigger stale-state or action-button
  updates in a different order even when payloads match; keep render one-way
  and verify the event sequence.
- Numeric text/range inputs can differ at empty or temporarily invalid editing
  states. Preserve today's conversion timing and fail-closed request behavior.
- Manual selection is intentionally split between the options model's authority
  field and existing ordered frame state. Serialization tests must prevent
  drift between them.
- The browser may not keep a local job running long enough to observe interactive
  pause/resume/cancel. Existing focused lifecycle coverage remains the evidence
  when that smoke substep is unavailable.
- Apply Set requires multiple real inputs. Missing approved fixtures reduce
  interactive coverage but do not justify mock data or scope expansion.

## Final Protected-boundary Review

Before requesting implementation approval, and again before implementation
handoff, record:

- changed paths are exactly the four files listed above;
- `server.js`, Motion Source pipeline/protocol files, providers, job states,
  `src/ui/shell.js`, `index.html`, `src/v8.css`, and `src/ui/motionSource/api.js`
  are untouched;
- API payload golden comparisons pass with no added/removed/renamed keys;
- request start/poll/artifact ordering is unchanged;
- all visible values, defaults, states, and Guided/Advanced behavior are
  unchanged;
- provider-free behavior is preserved and no provider call occurred;
- no TypeScript, bundler, dependency, npm advisory work, or unrelated cleanup
  entered the diff.

Stop after this review and wait for explicit human approval before implementing
Phase B1.

## Implementation Closure

**Completed:** 2026-07-30
**Pull request:** #21, `refactor: share Motion Source options model`
**Merge commit:** `d001fc99aea1427771dc894d0801c5b123c035f4`

The approved two-phase implementation shipped through five reviewable commits:

- `1acdbb7` — plan the bounded options-model split;
- `faaee80` — add the pure options model and serializer coverage;
- `a8d036a` — wire Guided and Advanced to the shared model;
- `160dba8` — preserve legacy key-color text behavior;
- `77a25ec` — preserve legacy RGB input semantics.

Verification and review evidence:

- the focused options/UI gate passed `33 / 33`;
- `git diff --check` passed;
- an independent full-range review recorded no P0-P3 findings;
- the initial browser smoke confirmed invalid RGB rejection, preset
  canonicalization, and Guided/Advanced tolerance synchronization with zero
  console warnings or errors;
- the later combined full suite, run from the PR #21 baseline during Phase B2,
  passed `1,573 / 1,573`;
- a post-merge provider-free manual acceptance used a user-selected local GIF:
  Analyze completed, Preview produced 12 real candidate frames, and Build wrote
  the real contact sheet, normalized strip, selection report, and bound
  artifacts with zero console warnings or errors.

The manual sample contained only three sufficiently distinct motion phases for
the requested four-frame action. The product truthfully reported
`needs review`, preserved the generated evidence, and kept Apply disabled.
Apply Strip and Apply Set were therefore skipped: no compatible reviewed target
sheet was available, and the plan does not permit inventing a fixture or
bypassing the evidence gate. Pause/resume/cancel was also not observed because
the local jobs completed too quickly. Existing focused lifecycle and Apply
tests remain the evidence for those substeps.

No Provider, model, external-network, protected contract, dependency, visual
redesign, or mock-data change entered this phase.
