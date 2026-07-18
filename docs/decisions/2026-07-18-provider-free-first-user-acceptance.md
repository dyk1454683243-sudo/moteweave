# Provider-Free First-User Acceptance Decision

**Date:** 2026-07-18

**Status:** Accepted for private engineering integration

## Decision

The provider-free first-user journey is accepted as a verified private
engineering delta.

- **Preview 3 readiness planning:** GO.
- **Preview 3 publication:** NO-GO until an exact candidate commit and tree pass
  the release gates and the project lead gives fresh publication approval.
- **Preview 2:** remains the accepted public release without modification.
- **Provider budget:** `0`; no Gemini or other Provider call was made.

## Accepted Evidence

The exclusive branch starts from private Preview 2 publication record
`7ff88c16fa6c2d6c018260a44748454a3c14af5d` and proves the following:

1. Character UI requests use implemented background modes, canonical cleanup
   and stabilization fields, the real `0–4` shift range, and fixed
   `96/64/48/32/16` package sizes.
2. A successful, current, unblocked single-strip Motion Apply can explicitly
   start local reprocessing and expose Character, Godot, RPG Maker, and OCAD
   packages. Stale or incomplete Apply evidence fails closed.
3. The guarded acceptance journey imports the original tracked `sample_hero`,
   runs Motion Selection v2 and Pixel Grid v2, applies only `walk_down`, parses
   every package, stays on the local origin, and records zero Provider calls.
4. Apply changed only cells `16–19`. Character reprocessing retained changes in
   those target cells but re-encoded the sheet, so the UI truthfully avoids an
   exact-repack claim.
5. Full verification passed `1555/1555`; the independent local smoke and
   website checks also passed within their resource ceilings.

## Boundaries And Follow-Up

- The private semantic-evidence Draft PR remains a separate experiment and is
  not automatically included in a Preview 3 candidate.
- Exact pixel-preserving repack, inherited lineage/metadata, embedded Apply
  evidence, and atomic recovery are separate protected product contracts.
- Preview 3 work may begin only as a release-readiness exercise that selects an
  exact private integration commit, audits the public snapshot delta, reruns
  release checks from a clean tree, and requests publication approval.
- No public mirror, tag, prerelease, website CTA, package version, npm package,
  installer, or hosted processing surface is changed by this decision.

Implementation and verification details are recorded in
`docs/superpowers/plans/2026-07-18-provider-free-first-user-acceptance.md`.
