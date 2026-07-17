# Generation Release Gate P0 Hardening Plan

**Date:** 2026-07-17
**Status:** Completed and provider-free focused-verified
**Scope:** Provider-free conformance hardening for the completed
`generation_release_gate_v1` contract.

## Context

The Generation Release Gate P0 was implemented and verified on 2026-07-16 in
commit `371e7c5`. A 2026-07-17 read-only audit confirmed that ranking and release
eligibility are already separate, blocked results are diagnostic-only, and
Quality Character uses a hard release gate. The audit found two narrow
fail-closed edges that are not reasons to reopen or redesign the completed P0:

1. Quality Character candidate scoring converted absent hard metrics to numeric
   zero before gate evaluation, which could hide missing evidence.
2. Production release evaluation accepted a closure without proving the
   canonical closure mode and complete four-gate evidence set.

The normative product contract remains
`docs/superpowers/specs/2026-07-16-generation-release-gate-v1-design.md`. This
plan only makes the implementation conform more strictly to that existing
contract.

## Implementation

- Preserve absent and non-finite Quality Character metrics as `null` when
  projecting candidate evidence; use local numeric fallbacks only for ranking.
- Require `character_frame_quality_closure_v1` evidence.
- Require exactly one of each canonical closure gate:
  `background_halo`, `alignment_consistency`, `motion_consistency`, and
  `prop_side_consistency`.
- Keep ranking independent from eligibility and prove that a numerically higher
  blocked candidate cannot become the published candidate.
- Prove top-level closure `status` and `release_ready` change when a nested gate
  warns.

## Verification

- Run only the affected provider-free files through the repository resource
  supervisor:
  `npm run test:focused -- test/character-pack/generationReleaseGate.test.js test/character-pack/textToImageGeneration.test.js test/character-pack/qualityClosureGate.test.js`.
- Review the final diff and worktree status before one independent semantic
  commit.
- Do not call a Provider, run a live generation experiment, or claim semantic
  character quality from these structural tests.

## Completion Gate

- [x] Missing hard metrics remain visibly missing and fail closed.
- [x] Missing, unsupported, empty, duplicate, or incomplete closure provenance
      fails closed.
- [x] A higher-scoring blocked candidate remains diagnostic-only.
- [x] Closure readiness regression is directly asserted.
- [x] Focused guarded tests pass with zero Provider calls.
- [x] The verified change is committed independently.

## Completion Record

Completed on 2026-07-17. The guarded focused command passed `32 / 32` tests in
`559 ms` at `148752 KiB` peak process-tree RSS, below the focused ceilings. No
Provider, build, browser, server, or live generation process was invoked.
