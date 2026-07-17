# Scene Tile Edge Conditioning Prototype

**Date:** 2026-06-05
**Status:** Recorded

## Context

`scene_tile_prompt_contract_v0_2` made the provider-facing seam contract more
explicit, but two comparable live smokes still failed the scene tile quality
gate:

- `scene_tile_live_smoke_v02_20260605_01`
- `scene_tile_live_smoke_v02_20260605_02`

Both runs passed metadata seams. The failure was in generated pixel content:
shared visual edges and single-tile self loops were not compatible.

This made local edge conditioning the smallest next step before WFC, map editor
work, or larger scene-pack claims.

## Change

Added an opt-in local postprocess:

```text
edge_conditioning_v0
```

Implementation:

- `src/scene-pack/tileEdgeConditioning.js`
- `scene tile-ingest --edge-condition --edge-band 3`
- `scene tile-generate --edge-condition --edge-band 3`
- `edge_conditioning.json`
- `quality_gate.json.edge_conditioning`
- `generation.json.edge_conditioning` for live generation

The prototype averages horizontal and vertical runtime tile border bands across
the 16-tile source sheet, writes those bands back into the central `32x32`
runtime tiles, re-encodes the source `tileset.png`, and then runs the normal
quality gate.

It does not call a provider and does not relax quality thresholds.

## Provider-Free Comparison

Raw evidence came from the stored v0.2 live-smoke artifacts. Conditioned runs
used the stored `tileset.png` files as input, so no provider quota was spent.

| Raw run id | Conditioned run id | Raw status | Conditioned status | Raw visual seams | Conditioned visual seams | Raw self-loop axes | Conditioned self-loop axes | Changed pixels |
|---|---|---|---|---:|---:|---:|---:|---:|
| `scene_tile_live_smoke_v02_20260605_01` | `scene_tile_edge_condition_v02_20260605_01` | `fail` | `pass` | `30 / 38`, max `191.8333` | `0 / 38`, max `0` | `32 / 32`, max `191.8667` | `0 / 32`, max `0` | `5568` (`0.3398`) |
| `scene_tile_live_smoke_v02_20260605_02` | `scene_tile_edge_condition_v02_20260605_02` | `fail` | `pass` | `38 / 38`, max `87.8` | `0 / 38`, max `0` | `32 / 32`, max `71.2333` | `0 / 32`, max `0` | `5568` (`0.3398`) |

Aggregate gate result:

- raw gate pass rate: `0 / 2`
- conditioned gate pass rate: `2 / 2`
- raw structural usable rate: `0`
- conditioned structural usable rate: `1`
- raw top taxonomy:
  - `scene_tile_live_smoke_v02_20260605_01`: `tile.self_loop_mismatch=32`, `tile.visual_seam_mismatch=30`
  - `scene_tile_live_smoke_v02_20260605_02`: `tile.visual_seam_mismatch=38`, `tile.self_loop_mismatch=32`
- conditioned top taxonomy: none

## Decision

Keep edge conditioning as an opt-in structural repair and live-gate diagnostic
tool.

It is useful because it proves the local pipeline can make a provider-generated
sheet pass the seam and self-loop gate without another provider call. It also
records the mutation ratio so reviewers can see how invasive the repair was.

Do not promote this to default output yet. Visual inspection shows the prototype
can leave an obvious border band, especially on sheets whose source tiles were
drawn as independent mini-scenes. This means it closes the structural seam gate,
not final scene art quality.

## Next Step

Before WFC or map-editor work, decide whether the next scene-quality unit is:

- a finer edge-aware conditioning pass that preserves edge material identity
  better than the global horizontal/vertical basis, or
- a stricter tile-structure generation route that produces cleaner raw tiles
  before local conditioning.

Only after raw or conditioned outputs pass both the gate and visual inspection
should v0.4 move to arrangement work.

## Follow-Up

The follow-up landed in
`docs/decisions/2026-06-05-scene-tile-edge-aware-conditioning-v1.md`.
`edge_aware_conditioning_v1` reduced changed pixels from `5568` (`0.3398`) to
`1984` (`0.1211`) on the stored v0.2 sheets while preserving structural pass,
but live visual review still warned. The next blocker is raw tile structure, not
WFC.

## Verification

Focused tests:

```bash
node --test test/scene-pack/tileEdgeConditioning.test.js
node --test test/scene-pack/tileGenerate.test.js
node --test test/character-pack/cli.test.js
node --test test/scene-pack/tileSheetIngestion.test.js
node --test test/scene-pack/artifactWriter.test.js
node --test test/scene-pack/tileQualityGate.test.js
```

Provider-free comparison:

```bash
npm run character-pack -- scene tile-ingest --input generated/cli/scene_tile_live_smoke_v02_20260605_01/tileset.png --output-dir generated/cli --job-id scene_tile_edge_condition_v02_20260605_01 --identifier conditioned_scene_v02_01 --width 6 --height 4 --pattern island --edge-condition --edge-band 3
npm run character-pack -- scene tile-ingest --input generated/cli/scene_tile_live_smoke_v02_20260605_02/tileset.png --output-dir generated/cli --job-id scene_tile_edge_condition_v02_20260605_02 --identifier conditioned_scene_v02_02 --width 6 --height 4 --pattern island --edge-condition --edge-band 3
```
