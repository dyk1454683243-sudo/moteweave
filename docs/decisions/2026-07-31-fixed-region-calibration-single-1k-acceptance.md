# Fixed-region Calibration Single-1K Acceptance

## Status

Accepted on 2026-07-31 as a single-call, single-1K acceptance result.

This record closes the evidence boundary for the fixed-region calibration work
merged through PR #25 and PR #26. It does not claim a sampled benchmark,
provider-wide reliability, or general production-quality readiness.

## Provenance

- Prompt-contract implementation: `359ecb7`
  (`character_prompt_contract_v1_16`).
- Prompt-contract merge: PR #25, merge commit `f02e8ac`.
- Final calibration hardening: `d458369`.
- Calibration merge: PR #26, merge commit `07d04ae`.
- Main baseline reviewed for this record: `07d04ae`.
- Evidence-recovery baseline: `f02249f`.
- Raw-source retention audit baseline: `14aea07`.
- Provider: `gemini`, preset `gemini-default` ("Gemini default").
- Model: `gemini-3.1-flash-image-preview`.
- Acceptance configuration: `1K`, `1:1`, one candidate, one successful
  provider attempt, no retry, and no fallback.
- Prompt contract: `character_prompt_contract_v1_16` with
  `fixed_region_motion_v0`.
- Template: `motion_template_ocad_primary.png`; no reference or palette image.
- Acceptance run directory id:
  `fixed_region_calibration_acceptance_20260731`.
- Persisted package id: `npc_20260731_021839_forest_lantern_keeper`, created at
  `2026-07-31T02:18:39.808Z`.
- Original task record: `019fae98-f37a-7ab3-ae97-ab128927f0d9`.
- Acceptance outcome: passed.

The generated artifacts do not persist the local API job id. The run-directory
id, package id, creation timestamp, provider attempt, and generation metadata
above are the retained identities; no API job id has been inferred.

## Recovered Artifact Evidence

The original local artifact directory is:

```text
$HOME/.codex/worktrees/eae8/Game tools/generated/final-acceptance/fixed_region_calibration_acceptance_20260731
```

The bounded evidence recovery directly inspected:

- `generation.json`;
- `metadata.json`;
- `generation_release_gate.json`;
- `source_quality_report.json`;
- `debug_report.json`;
- `inspection_index.json`;
- `inspection_strips/climb.png`;
- `inspection_sheet.png`.

Automatic gate evidence:

- candidate 1 was both the diagnostic and release selection, with score `1000`
  and artifact disposition `release`;
- `generation_release_gate_v1` under `strict_live_generation_v1` reported
  `status: "pass"` and `release_ready: true`, with no warning or blocking
  error;
- normalized validation passed for all `64` runtime frames;
- fixed-region source quality passed for all `60` regions, with zero empty,
  low-occupancy, halo, pressured, or severely pressured regions and zero
  unexpected duplicate-motion actions;
- background-halo, alignment-consistency, motion-consistency, and
  prop-side-consistency closure gates all passed;
- calibration reported `60 / 60` regions calibrated and zero missing regions.

The original manual review recorded that all six climb frames show only the
character acting against invisible supports, with no ladder, rail, rung, rope,
wall, platform, or other support scenery. It also recorded no crop or
out-of-bounds issue across the 60-region inspection sheet. Direct inspection of
the recovered climb strip and full inspection sheet during evidence recovery
agreed with those notes.

## Raw Source Retention Boundary

A bounded, provider-free follow-up inspected only the retained acceptance
directory, its four release archives, the generation metadata, and the directly
relevant publication path. It found no retained copy of the uncalibrated
`1024 x 1024` provider response:

- `generation.json` records fixed-region staging from `1024 x 1024` through a
  `256 x 256` stage to a `252 x 252` processing input;
- the persisted `source.png` is `252 x 252`, and its SHA-256
  (`19ef65fc3a78032c6c50f4bd24ec6bc245a4cc83b593f55d078169061282b89c`)
  matches the copy inside `character_pack.zip`;
- `metadata.json` names `candidate_1.png` as the source identity, but no file
  with that name, or an explicit raw/original-provider image, exists in the
  retained directory or release archives; and
- the implementation calibrates the generated buffer before package processing
  and publishes only the resulting `sourcePng`.

The original uncalibrated input therefore cannot be replayed offline against
the final `d458369` hardening. The calibrated `source.png` must not be used as a
substitute. Whether an unrecorded external copy exists is **待确认**; no broader
artifact scan was performed and no path is known. A fresh provider call would
require separate approval and is not implied by this acceptance.

## Accepted Contract Boundary

The accepted closure combines two distinct evidence layers:

- The single live call verifies the v1.16 character-only climb rule and the
  template-safe fixed-region calibration/output path represented by the
  recovered artifacts.
- The later `d458369` hardening preserves disconnected pose components, removes
  nonuniform mattes before fitting, and normalizes downstream staging. It was
  added after the live call and passed the final `131 / 131` focused test gate;
  it was deliberately not followed by a second provider call.

The single-1K pass therefore proves one reviewed live sample, while the final
edge-case hardening has offline regression evidence. Neither proves semantic
direction correctness across a sample set, stable provider behavior, absence of
all possible halo/background defects, or suitability for broader quality
claims.

## Follow-on Inventory

This inventory preserves current direction without converting ideas into
commitments.

### Approved Work Status

- The bounded P0 Release And Repository Readiness audit completed in PR #27,
  merge commit `f02249f`.
- Pixel Finishing v1 was already implemented in `1452387`; the 2026-07-31
  status reconciliation confirmed its opt-in mutation path and reporting
  acceptance fields on current `main`.
- The dictionary-backed Chinese/English browser language surface was already
  implemented through `ae37d64`, `f4de1b6`, and `3c3463f`; the static status
  reconciliation confirmed the header switcher, persisted preference, and
  Character Pack key coverage without claiming a new live browser run.
- The fixed-region background, white-edge, and halo evidence path was already
  implemented through `396ee8d`, `c093dd4`, `1ac590e`, and `371e7c5`; the
  retained single-1K acceptance records zero halo regions and a passing
  `background_halo` gate. This closes the current deterministic tuning
  candidate, not a universal claim about future samples.

No other incomplete implementation plan was proven to have explicit approval
during the bounded 2026-07-31 review. Any newly selected implementation unit
requires its own approval and scope boundary.

### Roadmap Candidates Requiring Separate Selection

- additional live character-repair evidence;
- larger character or 2.5D provider benchmarks;
- WFC productization, multi-level LDtk/world work, and auto-layer rules;

### Deferred Or Explicit Non-goals

- automatic semantic facing or action judgment;
- multi-candidate blending, unconfirmed replacement, or masked whole-sheet
  rewriting;
- broad WFC, multi-level worlds, or external-editor round-trip expansion during
  the character naming/quality reset;
- bundled engine plugins, generated native Godot scenes, or complete LDtk world
  export under the current Editor Workspace boundary;
- AI video-source creation, an unmeasured PixiJS/WebGL migration, a full pixel
  editor, billing, a community asset library, or a non-pixel HD product track.

## Next Decision Gate

The missing provenance fields and review artifacts have been recovered without
another provider call. Do not repeat the live run merely to manufacture an API
job id that the retained artifacts did not persist.

The next implementation unit must be a separately approved, minimal roadmap
candidate with explicit files, protected contracts, completion gate, and
guarded verification.
