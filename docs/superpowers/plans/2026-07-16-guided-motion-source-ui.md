# Guided Motion Source UI/HUD Implementation Plan

**Status:** Complete in implementation commit `493f609`

**Goal:** Deliver a truthful five-step Motion Source browser workflow and
evidence HUD while preserving the existing Advanced UI and all provider-free
pipeline behavior.

**Normative design:**
`docs/superpowers/specs/2026-07-16-guided-motion-source-ui-design.md`

## Safety And Scope

- Only the primary agent runs tests, builds, servers, or browser verification.
- All such commands use checked-in resource guards, serial execution, finite
  timeouts, and process-tree RSS ceilings.
- Do not call a Provider.
- Do not modify Motion backend/pipeline, validator, exporter, provider, prompt,
  profile, or job-state contracts for UI convenience.
- Do not scan `output/`, `generated/`, unrelated artifacts, or the exclusive
  implementation worktree.
- Do not modify or stage unrelated `.superpowers/` or `* 2.*` files.

## Task 1: Freeze Design And Lineage

- [x] Read repository UI guardrails and the design-to-implementation contract.
- [x] Audit current Motion Source UI/data flow and accepted path history.
- [x] Define desktop/mobile layout, five steps, states, capability truth, and
      parameter bindings.
- [x] Obtain a read-only design-contract review.
- [x] Commit the E design/implementation contract before UI code.

## Task 2: Shared State And Binding Guards

- [x] Add immutable Preview candidate state.
- [x] Restore the complete canonical candidate list on Restore Auto.
- [x] Record Preview and Build bindings without changing server contracts.
- [x] Add deterministic client options fingerprints.
- [x] Reuse one shared operation controller/poller across both views.
- [x] Hard-block stale Manual Build and stale latest-strip Apply.
- [x] Keep Advanced Auto direct Build behavior.
- [x] Keep target count independent from Manual card edits.

## Task 3: Real D/C Controls And Action Inventory

- [x] Derive all real actions from `TOPDOWN_RPG_V0.animations`.
- [x] Prefill Guided target count from the selected action contract and
      preflight `reject_mismatch` Apply.
- [x] Bind Motion Selection recipe, loop expectation, and temporal matte.
- [x] Force and disable v1-incompatible loop/matte controls with explanatory
      copy.
- [x] Preserve all existing Advanced sampling, cleanup, Pixel Grid, Apply, and
      Source Set controls.
- [x] Keep Pixel Grid disabled and temporal matte disabled by default.
- [x] Fail closed on unknown UI recipe values.

## Task 4: Guided View And Evidence HUD

- [x] Add Guided/Advanced switch with Guided as the default view.
- [x] Add the five numbered step cards and real action delegation.
- [x] Add shared Cancel/Resume visibility and truthful lifecycle states.
- [x] Keep job lifecycle and evidence result separate (`done + warning` is
      `Needs review`; artifact failure is not Complete).
- [x] Render Source, Selection, Loop/Phase, Cleanup, Pixel Grid, and Binding
      evidence from real artifacts only.
- [x] Label Preview as candidates and Manual automatic stages as not run.
- [x] Render Pixel Grid normalization-incompatible fallback as not applied.
- [x] Show raw provenance on frame cards.
- [x] Render semantic/adaptive future capabilities disabled as `Coming later`.

## Task 5: Responsive, A11y, And I18n

- [x] Add English and Chinese keys for all new copy.
- [x] Rerender dynamic Guided/HUD copy after language changes.
- [x] Add `aria-pressed`, descriptions, live status, and non-color-only states.
- [x] Repair the Motion tab `aria-labelledby` target and preserve Frame Picker
      focus across rerenders.
- [x] Add visible focus styles and align module-tab ARIA state.
- [x] Verify desktop, tablet, and mobile layouts without horizontal overflow.

## Task 6: Guarded Verification And Commit

- [x] Add focused pure/static UI tests.
- [x] Cover v1 dependency disabling and fail-closed serializer behavior.
- [x] Run the focused Motion UI tests serially through
      `npm run test:focused --`.
- [x] Run the smallest relevant Motion API regression.
- [x] Perform resource-bounded desktop/mobile browser verification.
- [x] Run static syntax and diff checks.
- [x] Obtain final read-only Blocker/High review.
- [x] Stage only E files and commit E independently.
- [x] Record commit hash, tests, resource observations, and deviations.

Guarded verification evidence on 2026-07-16:

- Final focused Guided UI/state run: `24 / 24` pass.
- Final resource-bounded Chrome run passed Guided/Advanced switching, real
  provider-free Preview/Build/Apply, 1440/1024/800/390 responsive checkpoints,
  zero horizontal overflow, bilingual switching, and zero console errors.
- The browser fault matrix proved fail-closed behavior for unreadable Preview,
  Build, Contact Sheet, and Apply images; concurrent cross-store errors;
  same-store Contact/Strip errors with one-sided recovery; missing JSON
  evidence; failed retries preserving old errors; stale Build binding; and the
  independent edited-strip override.
- Final Chrome elapsed time was `11.734s`, with `1,630,048 KiB` peak
  process-tree RSS and `11` peak processes.
- Final full suite: `1431 / 1431` pass in `151.804s`; resource-guard elapsed
  `151.862s`, peak process-tree RSS `846,256 KiB`, peak processes `6`.
- Final independent `npm run smoke:local` passed in `3.867s`, with
  `735,920 KiB` peak RSS and `3` peak processes. The final full suite also
  reran the self-hosted smoke wrapper successfully.
- Two independent read-only reviews found no remaining Blocker/High.
- Design contract commit: `18c117b`. Implementation commit: `493f609`.
- No Provider was called, no backend/pipeline/provider contract was changed,
  and the exclusive implementation worktree remained untouched.

## Required Exit Conditions

- [x] Guided is a real five-step workflow, not a mock.
- [x] Advanced remains reachable and functional.
- [x] No backend/pipeline/provider contract changed.
- [x] D/C controls map to exact implemented values.
- [x] Restore Auto reconstructs all Preview candidates.
- [x] Stale manual candidates and stale latest-strip Apply fail closed.
- [x] HUD values come only from bound artifacts.
- [x] Future capabilities cannot look active.
- [x] English/Chinese, keyboard, live status, and mobile states are covered.
- [x] Guarded tests and browser verification pass without a Provider call.
