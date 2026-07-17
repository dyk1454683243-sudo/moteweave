# Scene Tile Edge-Aware Conditioning v1

**Date:** 2026-06-05
**Status:** Recorded

## Context

`edge_conditioning_v0` proved that local edge conditioning can make generated
scene tiles pass the structural seam/self-loop gate, but it mutated a full
`3 px` runtime border band:

- changed pixels per 16-tile sheet: `5568`
- changed pixel ratio: `0.3398`
- visual issue: an obvious border band on some sheets

The next step was to reduce mutation and add an explicit visual-review artifact
before deciding whether v0.4 could move to WFC or map-editor work.

## Change

Added:

- `edge_aware_conditioning_v1`
- `tile_conditioning_review.json`
- `tile_conditioning_review.png`
- `scene tile-ingest --edge-condition-mode edge-aware-v1`
- `scene tile-generate --edge-condition-mode edge-aware-v1`

`edge_aware_conditioning_v1` groups tile sides by dual-grid edge signature,
adds self-loop constraints, and mutates only the measured outer `1 px` edges
used by the scene tile quality gate. It records the requested band separately:

```json
{
  "requested_band": 3,
  "applied_edge_depth": 1
}
```

The review gate writes a raw-vs-conditioned contact sheet and warns when a
structural pass still has visible mutation risk:

```text
tile.edge_conditioning_visible_mutation
```

## Provider-Free Comparison

The stored v0.2 live-smoke source sheets were reprocessed without provider
quota.

| Raw run id | v1 conditioned run id | Raw status | v1 structural status | Raw visual seams | v1 visual seams | Raw self-loop axes | v1 self-loop axes | v1 changed pixels | Review |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| `scene_tile_live_smoke_v02_20260605_01` | `scene_tile_edge_aware_v1_v02_20260605_01` | `fail` | `pass` | `30 / 38`, max `191.8333` | `0 / 38`, max `0` | `32 / 32`, max `191.8667` | `0 / 32`, max `0` | `1984` (`0.1211`) | `warning` |
| `scene_tile_live_smoke_v02_20260605_02` | `scene_tile_edge_aware_v1_v02_20260605_02` | `fail` | `pass` | `38 / 38`, max `87.8` | `0 / 38`, max `0` | `32 / 32`, max `71.2333` | `0 / 32`, max `0` | `1984` (`0.1211`) | `warning` |

Compared with v0, v1 preserves the structural pass while reducing changed
pixels from `5568` to `1984`.

## Live Gate

One live gate was run with:

- run id: `scene_tile_edge_aware_v1_live_20260605_01`
- provider preset: `gemini25`
- image config: `1K`, `1:1`
- prompt subject: `mossy cliff path terrain tiles, grass, stone edge, dirt transition`
- conditioning: `edge_aware_conditioning_v1`, `band=3`

Result:

- CLI status: `done`
- structural quality gate: `pass`
- visual seams: `0 / 38`, max `0`
- self-loop axes: `0 / 32`, max `0`
- changed pixels: `1984` (`0.1211`)
- review status: `warning`
- warning: `tile.edge_conditioning_visible_mutation`

Visual inspection showed the live provider still tends to draw larger terrain
regions that are sliced into tiles. v1 makes those slices structurally seam-safe,
but the output is not yet a clean tile set ready for arrangement work.

## Decision

Keep v1 as the default opt-in edge-conditioning mode.

Do not move generated scene tiles to WFC or map-editor work yet. The structural
gate is closed, but visual review is still warning on historical and fresh live
outputs. The next scene-quality block should improve raw tile structure before
arrangement:

- make the provider produce 16 cleaner independent runtime tiles instead of
  large terrain regions sliced by the source atlas,
- preserve edge-signature semantics in the prompt/source contract,
- keep v1 as a diagnostic and fallback repair, not as the main art-quality
  solution.

## Verification

```bash
node --test test/scene-pack/tileEdgeConditioning.test.js
node --test test/scene-pack/tileConditioningReview.test.js
node --test test/scene-pack/tileGenerate.test.js
node --test test/character-pack/cli.test.js
node --test test/scene-pack/artifactWriter.test.js
```

Provider-free comparison:

```bash
npm run character-pack -- scene tile-ingest --input generated/cli/scene_tile_live_smoke_v02_20260605_01/tileset.png --output-dir generated/cli --job-id scene_tile_edge_aware_v1_v02_20260605_01 --identifier conditioned_scene_v1_01 --width 6 --height 4 --pattern island --edge-condition --edge-band 3
npm run character-pack -- scene tile-ingest --input generated/cli/scene_tile_live_smoke_v02_20260605_02/tileset.png --output-dir generated/cli --job-id scene_tile_edge_aware_v1_v02_20260605_02 --identifier conditioned_scene_v1_02 --width 6 --height 4 --pattern island --edge-condition --edge-band 3
```

Live gate:

```bash
npm run character-pack -- scene tile-generate --description "mossy cliff path terrain tiles, grass, stone edge, dirt transition" --output-dir generated/cli --job-id scene_tile_edge_aware_v1_live_20260605_01 --identifier generated_scene_edge_aware_v1 --width 6 --height 4 --pattern island --provider-preset gemini25 --image-size 1K --aspect-ratio 1:1 --edge-condition --edge-band 3 --edge-condition-mode edge-aware-v1 --yes
```
