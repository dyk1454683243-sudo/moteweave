# Scene Tile Edge Conditioning Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 Scene Tile Quality Closure

## Purpose

Scene tile edge conditioning is an opt-in local postprocess for generated or
uploaded `topdown_tile_dual_grid_v0` tile sheets. It aligns the runtime tile
border bands before the scene tile quality gate runs, so prompt-generated tiles
can be tested against seam and self-loop requirements without another provider
call.

This is a structural quality prototype. It is not semantic inpainting, WFC,
map editing, or a final art-quality pass.

## Module

```text
src/scene-pack/tileEdgeConditioning.js
```

Public entry points:

```text
conditionTileEdges(tiles, { enabled, band, mode })
conditionTileSheetEdges(source, { enabled, band, mode, profile })
writeTilesToTileSheet(source, tiles, { profile })
```

## Behavior

`conditionTileEdges()` clones all input tile images. It does not mutate the
caller-owned tile objects.

The default mode is `edge_aware_conditioning_v1`.

When enabled, `edge_aware_conditioning_v1`:

- groups runtime tile sides by dual-grid edge signature,
- adds self-loop equality constraints for each tile's north/south and west/east
  sides,
- averages only the measured outer `1 px` runtime edges needed by the quality
  gate,
- writes those measured edges back to cloned runtime tiles,
- preserves all interior pixels outside the measured outer edge.

The requested band remains recorded, but v1 applies only the outer edge:

```json
{
  "mode": "edge_aware_conditioning_v1",
  "requested_band": 3,
  "applied_edge_depth": 1
}
```

The previous `edge_conditioning_v0` mode remains available for comparison. It:

- samples all north/south runtime tile border bands into one horizontal edge
  basis,
- samples all west/east runtime tile border bands into one vertical edge basis,
- writes those basis bands back to cloned runtime tiles,
- re-applies the exact outer rows and columns that the quality gate samples,
- preserves interior pixels outside the configured band.

The default band is `3` pixels. For the current `32x32` runtime tiles, that
means v0 mutates the full 3 px edge band, while v1 records the request but only
mutates the measured outer edge.

## Report

Conditioning writes a report when requested:

```json
{
  "schema_version": 1,
  "mode": "edge_aware_conditioning_v1",
  "enabled": true,
  "band": 3,
  "requested_band": 3,
  "applied_edge_depth": 1,
  "tile_count": 16,
  "changed_pixel_count": 1984,
  "changed_pixel_ratio": 0.1211,
  "output_mutation": "measured_runtime_outer_edges_only",
  "constraint_group_count": 2
}
```

The report is attached to:

- `edge_conditioning.json`,
- `tile_conditioning_review.json`,
- `tile_conditioning_review.png`,
- `quality_gate.json.edge_conditioning`,
- `generation.json.edge_conditioning` for live generation runs.

`tile_conditioning_review.json` is a separate visual-review gate. It warns when
the structural quality gate passes but the conditioning mutation ratio remains
high enough to deserve visual inspection:

```json
{
  "mode": "tile_conditioning_review_v0",
  "status": "warning",
  "warnings": ["tile.edge_conditioning_visible_mutation"]
}
```

## CLI

Provider-free conditioning for an existing source sheet:

```bash
npm run character-pack -- scene tile-ingest \
  --input generated/cli/scene_tile_live_smoke_v02_20260605_02/tileset.png \
  --output-dir generated/cli \
  --job-id scene_tile_edge_condition_v02_20260605_02 \
  --identifier conditioned_scene_v02_02 \
  --width 6 \
  --height 4 \
  --pattern island \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1
```

Live generation can opt in with the same flags:

```bash
npm run character-pack -- scene tile-generate \
  --description "mossy cliff path" \
  --output-dir generated/cli \
  --job-id scene_tile_generate_conditioned \
  --identifier generated_scene \
  --width 6 \
  --height 4 \
  --pattern island \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --yes
```

When enabled, `tileset.png` is the re-encoded conditioned source sheet. The
quality gate and exported scene artifacts therefore inspect the same pixels that
are written to disk.

## Non-Goals

- No default mutation of generated or uploaded tiles.
- No semantic repair of paths, rocks, cliffs, props, or terrain intent.
- No inpainting or provider round-trip.
- No WFC, auto-layer rules, map editor, or arrangement changes.
- No relaxation of quality-gate thresholds.

## Verification

```bash
node --test test/scene-pack/tileEdgeConditioning.test.js
node --test test/scene-pack/tileGenerate.test.js
node --test test/character-pack/cli.test.js
```
