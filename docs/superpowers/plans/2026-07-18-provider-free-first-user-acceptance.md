# Provider-Free First-User Acceptance v1

**Date:** 2026-07-18

**Status:** Complete

**Owner:** Project lead

**Branch:** `codex/first-user-acceptance-v1`

**Private release-record baseline:** `7ff88c16fa6c2d6c018260a44748454a3c14af5d`

**Public release:** `v0.5.0-preview.2`

## 1. Purpose

Prove that a new user can install MoteWeave, import the original tracked
`sample_hero` fixture, run deterministic local Character processing, Motion
Selection v2, Pixel Grid v2, apply the selected action, and download real
Character, Godot, RPG Maker, and OCAD ZIP files without any Provider call.

This is a private engineering acceptance pass. It does not change the public
mirror, tag, prerelease, Pages site, package version, or accepted Preview 2
release identities.

## 2. Frozen Scope And Boundaries

- The worktree starts at the exact Preview 2 private publication-record commit
  above. Later release-line documentation does not move that immutable record.
- Provider call budget is `0`. The server process must receive blank Provider
  credentials and preset configuration, and the acceptance client may contact
  only the local MoteWeave server.
- The input is the tracked, original fixture
  `test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png` plus a
  deterministic Motion ZIP assembled in memory from that fixture's normalized
  frames. No generated or third-party image is added to the repository.
- Local repair means background handling, component cleanup, automatic frame
  correction, motion stabilization, Motion Selection v2, and Pixel Grid v2.
  Pixel Finishing is explicitly disabled in this journey so Pixel Grid v2
  evidence remains isolated. Provider-backed Action Repair and Frame Repair are
  excluded.
- Motion Apply followed by `/api/process-sheet` is described as **reprocess and
  re-export**, not an exact pixel-preserving repack. The current Character
  pipeline always normalizes cells again.
- No protected Character pipeline, validator, exporter, Provider, prompt
  contract, or existing server endpoint behavior may change in this work.
- Exact repack, inherited lineage/metadata, apply evidence embedded in the
  final ZIP, and server-owned atomic recovery require a separate product and
  server/package contract with explicit approval.

## 3. Acceptance Journey

1. Run a clean locked dependency install through the repository's full
   resource supervisor.
2. Start one local server with Provider credentials and preset configuration
   blanked, under the repository supervisor and a tracked process group.
3. Submit `sample_hero` to `/api/process-sheet` with canonical UI-equivalent
   local processing options and require a terminal successful validation.
4. Build six deterministic frames in memory, upload one Motion ZIP, preview
   candidates, and build in explicit `selection_mode: "auto"` with
   `motion_selection_recipe_v2` and `pixel_grid_v2_balanced`.
5. Require the Motion report to prove Auto remained authoritative, the v2
   recipe executed, and Pixel Grid v2 produced bound evidence.
6. Apply the four-frame strip to `walk_down`; fail closed unless the apply
   report is canonical and contains no blocking validation error.
7. Prove non-target cells were unchanged by Apply and at least one target cell
   changed.
8. Reprocess the applied sheet with frozen preservation-oriented options:
   `passthrough`, no auto-correct, no stabilization, no component cleanup, no
   Pixel Finishing, and the fixed `96/64/48/32/16` output sizes.
9. Require the final Character job and all four ZIP URLs, parse each ZIP, and
   prove the final Godot sprite is the final normalized sheet. Record whether
   the applied and final target frames are pixel-identical as experiment
   evidence; do not assume that result in advance.
10. Perform one real browser walkthrough in one reused window: load the local
    app, confirm the truthful Character controls and Motion re-export action,
    and avoid opening duplicate browser windows.

## 4. Confirmed Product Gaps In Scope

| Priority | Gap | Closure boundary |
| --- | --- | --- |
| P0 | Character background values `flood_edge` and `alpha` do not match core modes | Canonicalize to `auto` and `passthrough` in the UI request layer |
| P0 | Cleanup and motion-shift controls send legacy field names | Send canonical fields and clamp Max Shift to the implemented `0–4` range |
| P0 | Motion Apply stops at an applied sheet | Add a truthful UI action that reprocesses and re-exports through the existing public Character endpoint |
| P1 | Active 1x–4x checkboxes have no consumer | Replace them with the real fixed `96/64/48/32/16` package statement |
| P1 | No complete provider-free first-user harness exists | Add one guarded, serial command with exact artifact assertions |

The Provider-backed Quality Character shared-control boundary is not part of
this provider-free journey. Any change to that protected processing contract is
deferred.

## 5. Verification And Resource Contract

Only the primary test owner runs commands, serially:

1. Smallest focused tests for the request mapper, Motion re-export contract,
   UI structure, and acceptance runner wiring.
2. `npm run first-user:local` under `2048 MiB` V8 old-space, `4096 MiB`
   process-tree RSS, and a finite `900000 ms` timeout.
3. One single-window browser walkthrough while the exact local server process
   remains tracked and bounded, followed by exact process-group shutdown.
4. The affected wider tests, then the complete suite and existing local smoke
   only after the focused acceptance passes.

Any timeout, memory breach, unknown transport outcome, missing artifact,
blocking report, Provider availability, or unclosed process group fails the
acceptance. Do not automatically retry a hung or resource-breaching command.

## 6. Preview 3 Decision Gate

The completed acceptance produces a meaningful, user-visible private
engineering delta. The decision is therefore **GO for a separate Preview 3
readiness plan, NO-GO for Preview 3 publication**. The accepted Preview 2
release remains unchanged.

After this acceptance pass:

- keep `preview.2` if no user-visible blocker was fixed or evidence is
  incomplete;
- prepare a separate Preview 3 release-readiness plan only if verified,
  release-safe first-user blockers produce a meaningful public delta;
- never update the public mirror, create a tag/prerelease, or change the Pages
  CTA without fresh approval bound to the exact release candidate commit and
  tree.

## 7. Execution Board

| Phase | Exit condition | Status |
| --- | --- | --- |
| 0. Contract | Baseline, zero-Provider journey, protected boundary, and Preview 3 gate are recorded | Complete |
| 1. UI request truth | Canonical Character options and fixed output-size truth pass focused tests | Complete |
| 2. Motion export closure | Apply evidence gates a real reprocess/re-export action and four ZIP links | Complete |
| 3. Automated acceptance | Guarded end-to-end command passes with parsed artifacts and zero Provider availability | Complete |
| 4. Browser acceptance | One-window UI truth check confirms canonical controls and the gated Motion package affordance | Complete |
| 5. Release decision | Outcome evidence records GO/NO-GO for planning Preview 3; no publication occurs | Complete |

## 8. Verified Outcome

The acceptance completed on 2026-07-18 with these measured facts:

| Evidence | Result |
| --- | --- |
| Clean locked install | `npm ci` passed in a new empty temporary directory in `3015 ms`, peak `209216 KiB`, `6` processes; guarded `npm ls --all` then passed |
| Provider availability and calls | `false`; `0` calls; all Provider credentials and preset configuration blank |
| Local acceptance | `npm run first-user:local` passed in `3204 ms`, peak `659488 KiB`, `3` processes |
| Motion authority | Auto remained effective; Motion Selection v2 and Pixel Grid v2 evidence were bound to the source identity |
| Apply scope | Only cells `16,17,18,19` changed; all non-target cells remained unchanged |
| Reprocess result | The same four target cells remained changed; applied and final full-sheet RGBA were not byte-identical |
| Packages | Character ZIP contained `74` files; Godot, RPG Maker, and OCAD ZIPs parsed and matched their layout contracts |
| Browser truth check | One reused Chrome tab confirmed canonical Character controls, fixed output sizes, and the gated Motion package action; the API harness, not this UI check, proves the complete data journey |
| Focused verification | Final acceptance/UI boundary set `24/24`; earlier new/UI `28/28`; resource guard `12/12`; wider processing chain `30/30`; local-smoke regression `2/2` |
| Website contract | `8/8` passed |
| Full suite | `1555/1555` passed in `138193 ms`, peak `846160 KiB`, `6` processes |
| Independent local smoke | Passed in `3745 ms`, peak `707312 KiB`, `3` processes |

The non-identical reprocess result is recorded evidence, not a hidden failure:
the UI now says that reprocessing may re-encode pixels. Exact repack, inherited
lineage, and atomic package recovery remain outside this approved change and
require a separate protected server/package contract.

The associated decision is recorded in
`docs/decisions/2026-07-18-provider-free-first-user-acceptance.md`. No public
mirror, tag, prerelease, Pages CTA, or package version was changed.
