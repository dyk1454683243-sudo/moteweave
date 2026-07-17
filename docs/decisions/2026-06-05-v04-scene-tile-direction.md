# v0.4 Scene And Tile Direction

## Status

Accepted on 2026-06-05.

## Context

v0.3 closed the character-pack pipeline, and v0.3.1 closed the OCAD static-source reuse reporting boundary. The next major direction can now move beyond a single character sheet.

The roadmap has two broad v0.4 directions:

- Scene generation: tile profiles, map arrangement, LDtk-style project export, and character plus scene packs.
- Ecosystem expansion: sharing, runtime APIs, editor integration, and repair UX.

The current product risk is that scene and tile generation magnifies pixel-style drift. A character sheet can tolerate small palette or edge variation for a while, but repeated tiles expose mismatched palettes, blurred downsampling, weak outlines, and edge seams immediately.

## Decision

Choose Scene / Tile Generation as the v0.4 direction, but do not start with tile generation itself.

v0.4 Phase 0 must first build a provider-free pixel style pipeline:

- palette extraction,
- palette snapping,
- integer nearest-neighbor downsampling,
- report-only style drift metrics,
- optional/opt-in processing integration.

The first implementation must be report-only or opt-in. It must not change existing normalized character pack outputs by default.

## Consequences

- Tile profile work waits until pixel style metrics exist.
- Scene/tile generation can reuse the same style pipeline as character packs.
- Style metrics become local and provider-free, so they can run in tests and smoke checks without model quota.
- Outline strengthening remains a later Phase 0 step after palette and downsampling primitives are covered.

## Initial Follow-Up Status

After the Phase 0 report-only style pipeline landed, v0.4 started the next
contracts in order:

- Phase 1: a padded 16-tile dual-grid profile and metadata-only edge checks.
- Phase 2: provider-free tile map validation and an LDtk-style JSON skeleton.
- Phase 3: a character plus scene project manifest with a shared style contract.
- Quality gate: provider-free metadata seam, visual seam, self-loop, and style
  drift reporting.

These are starter contracts, not a complete scene generation product.

## Deferred

- Seam repair and automatic tile correction.
- WFC or full rule-based map arrangement.
- Complete LDtk project export compatibility.
- Archive writer for combined character plus scene packs.
- Scene preview UI.

## Verification

The first v0.4 implementation unit must add focused tests for the pixel style pipeline and prove that process/CLI integration is report-only or opt-in.
