# Motion Selection v2 Implementation Plan

**Status:** Complete in implementation commit `f6a6a03`

**Goal:** Deliver bounded, explainable, provider-free Motion Selection v2 while
preserving v1 and Manual behavior.

**Normative design:**
`docs/superpowers/specs/2026-07-16-motion-selection-v2-design.md`

## Safety And Scope

- Only the primary agent runs tests, builds, smoke, or browser verification.
- Use checked-in resource guards and serial execution.
- Do not call a Provider.
- Do not scan `output/`, `generated/`, unrelated artifacts, or exclusive
  worktrees.
- Do not modify or stage unrelated `.superpowers/` or `* 2.*` files.
- D does not redesign the Motion Source UI; E owns that work.

## Task 1: Freeze Contract And V1 Compatibility

- [x] Audit current selector, extraction, Source Set, API/CLI, and reports.
- [x] Define recipe, provenance, loop expectation, Manual, temporal matte, and
      target-shortfall contracts.
- [x] Keep all existing direct-selector v1 expected indexes unchanged.
- [x] Add fail-closed recipe normalization before operation hashing.

## Task 2: Provenance Chain

- [x] Add aligned `frame_provenance` output to extraction.
- [x] Preserve ZIP entry, GIF page/delay, and derived video sampling evidence.
- [x] Bind candidate/raw indexes through Preview, selector, normalized reports,
      and sequence artifacts.
- [x] Keep Manual indexes defined as candidate indexes.

## Task 3: Registration And Global Clustering

- [x] Add bounded 64-pixel analysis rasters.
- [x] Add analysis-only integer translation registration.
- [x] Preserve raw bbox trajectory and registration residual evidence.
- [x] Cache global pair evidence.
- [x] Add deterministic complete-link clustering and explainable rejections.
- [x] Observe cancellation between bounded work stages.

## Task 4: Periodicity And Phase Selection

- [x] Add static gate.
- [x] Score bounded lag self-similarity.
- [x] Reject clear harmonic aliases and abstain on unresolved ambiguity.
- [x] Implement `auto`, `loop`, and `once` temporal phase selection.
- [x] Preserve monotonic source order and omit loop-closing duplicates.

## Task 5: Reports, Source Set, API, And CLI

- [x] Add `motion_selection_report_v2`.
- [x] Mark Manual automatic stages `not_run_manual_authority`.
- [x] Make target shortfall truthful and set the outer report to `warning`.
- [x] Preserve and validate Source Set loop expectations.
- [x] Canonicalize recipe aliases before operation hash/claim.
- [x] Add API and CLI recipe/loop/temporal-matte bindings.
- [x] Add evidence-only temporal matte without changing selected frames or PNGs.

## Task 6: Guarded Verification And Commit

- [x] Run selector, extractor, contract, Source Set, strip, API, and CLI focused
      tests serially through `npm run test:focused --`.
- [x] Run static syntax and diff checks.
- [x] Obtain a final read-only Blocker/High review.
- [x] Stage only D files and commit D independently before E.
- [x] Record commit hash and resource observations.

## Required Exit Conditions

- [x] V1 direct-selector behavior is unchanged.
- [x] V2 is explicit and fail-closed.
- [x] Provenance is truthful after stride sampling.
- [x] Registration does not mutate emitted pixels.
- [x] Near-duplicate decisions are global and complete-link.
- [x] Static, periodic, harmonic, and ambiguous cases are distinct.
- [x] Loop/Once/Auto behavior is evidence-backed.
- [x] Manual is a hard bypass.
- [x] Temporal matte is evidence-only.
- [x] No frame is fabricated to satisfy a target.
- [x] D is verified and committed before E begins.

Guarded verification evidence on 2026-07-16:

- Selector core: 26/26 pass.
- Final full Motion Source plus frame-extractor run: 170/170 pass; peak RSS
  315,952 KiB.
- Motion API: 1/1 pass in the final full Motion run.
- Full Character Pack CLI regression: 63/63 pass; peak RSS 612,816 KiB.
- Final targeted CLI Motion Build regression: 3/3 pass; peak RSS 216,592 KiB.
- Two independent read-only reviews found no remaining Blocker/High after the
  V1 hash-compatibility and bounded async-initialization fixes.
- All commands used the checked-in focused resource guard; no Provider was
  called.
- D was committed independently as `f6a6a03`.
