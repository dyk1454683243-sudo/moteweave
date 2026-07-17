# Pixel Grid Refinement v2 Implementation Plan

**Status:** Complete and independently committed in `0a6353a`

**Goal:** Deliver sequence-consistent, harmonic-aware, detail-safe, optionally
OKLab pixel-grid refinement with a versioned opt-in recipe and truthful Motion
Source UI binding.

**Normative design:**
`docs/superpowers/specs/2026-07-16-pixel-grid-v2-design.md`

## Safety And Scope

- Only the primary agent runs tests, builds, smoke, or browser verification.
- Use only checked-in resource guards.
- Do not call a Provider.
- Do not scan `output/`, `generated/`, or unrelated artifacts.
- Do not modify or stage unrelated `* 2.*` files, `.superpowers/`, or exclusive
  worktrees.
- Default behavior remains disabled.
- Do not begin Motion Selection v2 or the Guided Motion Source redesign in this
  unit.

## Task 1: Recipe And Sequence Consensus Core

Files:

- Modify: `src/character-pack/pixelGridRefinement.js`
- Modify: `test/character-pack/pixelGridRefinement.test.js`

- [x] Add immutable recipe ids and fail-closed recipe resolution.
- [x] Add boundary-contrast evidence to single-frame candidates.
- [x] Add deterministic sampled sequence consensus and circular phase voting.
- [x] Add explicit harmonic-alias evidence.
- [x] Preserve `pixel_grid_v1_compat`.
- [x] Add stable v2 report schema and passthrough evidence.
- [x] Add fixed refinement work ceilings and cancellable Motion orchestration.
- [x] Run the focused Pixel Grid suite through `npm run test:focused --`.

## Task 2: Detail Protection, OKLab, And Outline Last

Files:

- Modify: `src/character-pack/pixelGridRefinement.js`
- Modify: `src/character-pack/textToImageGeneration.js`
- Modify: `test/character-pack/pixelGridRefinement.test.js`
- Modify: `ATTRIBUTIONS.md`

- [x] Add deterministic RGB and OKLab palette-distance implementations.
- [x] Add balanced/detail-safe cell protection with evidence.
- [x] Project an idempotent outer outline from logical cells only after consolidation.
- [x] Reserve the outline color in the locked output palette.
- [x] Move grid-refined Quality Character outline to the outline-last path while
      preserving non-refined behavior.
- [x] Cover detailed-cell preservation, OKLab divergence, outline ordering,
      determinism, and idempotence.
- [x] Run the smallest focused tests.

## Task 3: CLI, Server, Motion UI, And Protocol Wiring

Files:

- Modify: `scripts/character-pack-cli.mjs`
- Modify: `server.js`
- Modify: `src/motion-source/stripBuilder.js`
- Modify: `index.html`
- Modify: `src/ui/motionSourceTab.js`
- Modify: `test/character-pack/cli.test.js`
- Modify: `test/motion-source/api.test.js`
- Modify: `test/motion-source/stripBuilder.test.js`
- Modify: `test/uiMotionSourceStructure.test.js`
- Modify: `docs/protocols/pixel-grid-refinement.md`
- Modify: `docs/protocols/motion-source-pipeline.md`
- Modify: `docs/roadmap/p0-p2-technical-upgrade-plan.md`
- Modify: `docs/roadmap/technology-reference-roadmap.md`

- [x] Parse canonical recipe options in CLI.
- [x] Pass request recipe and cancellation through the server to Motion strip building.
- [x] Add one accessible, disabled-by-default real recipe select.
- [x] Disable the select while Motion work owns the UI.
- [x] Add focused coverage for UI/request/server/report binding.
- [x] Record design lineage, parameter binding, capability truth, and no
      unimplemented controls.

## Task 4: Guarded C Verification And Commit

- [x] Run all C-focused tests serially through the checked-in guard.
- [x] Review the diff for protected-contract and default-behavior changes.
- [x] Record design refinements: single-frame Quality detection may use 4M
      pixels with a 16-color grid cap; multi-frame Motion remains 1M/frame.
- [x] Run `git status --short`; stage only C files.
- [x] Commit C independently with a conventional message.
- [x] Record the commit hash and resource observations before beginning D.

Focused verification evidence on 2026-07-16:

- Pixel Grid core: 35/35 pass after the final single-candidate confidence
  regression; peak RSS 150,224 KiB.
- Motion strip + UI: 20/20 pass.
- Motion API: 1/1 pass; peak RSS 306,896 KiB.
- CLI + text-to-image: 76/76 pass; peak RSS 646,160 KiB.
- All commands used `npm run test:focused -- ...`; no Provider was called.
- Implementation commit: `0a6353a` (`feat: add pixel grid refinement v2`).

## Completion Checklist

- [x] Sequence cell/phase consensus is authoritative in v2.
- [x] Harmonic aliases are rejected and reported.
- [x] Detail protection is recipe-controlled and covered by focused tests.
- [x] OKLab is explicit, optional, and deterministic.
- [x] Outline is applied after refinement when requested.
- [x] Recipe/report schemas are versioned.
- [x] Motion UI binds to real behavior and defaults to Disabled.
- [x] v1 compatibility and no-grid/budget passthrough remain honest.
- [x] Focused verification passes without Provider calls.
- [x] C is independently committed before D.
