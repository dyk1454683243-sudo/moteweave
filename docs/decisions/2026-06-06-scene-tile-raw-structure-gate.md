# Scene Tile Raw Structure Gate

**Date:** 2026-06-06
**Status:** Recorded

## Context

`edge_aware_conditioning_v1` reduced visible mutation compared with the first
global edge-conditioning prototype and preserved structural seam/self-loop
passes. The fresh live gate still produced a visual review warning, though. The
remaining issue is upstream: providers can draw a larger terrain image that is
sliced into the `4x4` atlas, instead of producing 16 independently reusable
runtime tiles.

Moving to WFC, map-editor work, or broader scene-pack claims before detecting
this raw structure problem would hide the real blocker behind arrangement code.

## Change

Added a first provider-free raw-structure unit:

- upgraded the prompt contract to `scene_tile_prompt_contract_v0_3`,
- added explicit tile-inventory language to the provider prompt,
- added validation expectations:
  - `raw_tile_structure_independent_cells`,
  - `source_atlas_not_single_scene`,
- passed the raw source sheet into `evaluateSceneTileQualityGate()`,
- added warning-only `source_atlas_structure` reporting,
- added taxonomy warning `tile.source_atlas_continuity`.

The new gate compares adjacent source-cell boundaries across the `192x192`
atlas. It flags suspicious continuity only when enough paired boundary pixels
are opaque, the boundary has enough color variety to look like art, and the
average boundary delta is low enough to suggest a continuous painted scene.

## Decision

Keep the new raw-structure gate warning-only for this first unit.

Reasons:

- It gives benchmark and live-smoke reports a place to record the current
  blocker without changing image output.
- It avoids failing existing provider-free ingestion paths solely because the
  project has not yet calibrated live thresholds.
- It creates a concrete signal for deciding whether the next unit should tune
  prompt wording, add a structure template/reference, or change the source
  profile.

Do not treat this as WFC readiness. The next quality step should run a small
live gate with `scene_tile_prompt_contract_v0_3` and inspect whether
`tile.source_atlas_continuity`, visual seams, self-loops, and visual review
warnings improve.

## Verification

```bash
node --test test/scene-pack/tilePromptContracts.test.js test/scene-pack/tileQualityGate.test.js test/scene-pack/tileSheetIngestion.test.js
node --test test/scene-pack/tileGenerate.test.js test/character-pack/cli.test.js test/scene-pack/artifactWriter.test.js
```
