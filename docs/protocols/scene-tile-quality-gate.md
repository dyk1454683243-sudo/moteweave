# Scene Tile Quality Gate Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 Scene Tile Quality Gate

## Purpose

The scene tile quality gate decides whether local tile images are ready for
prompt work, arrangement, preview, or export. It runs without providers and
without model quota.

The first gate covers:

- metadata seams from the dual-grid tile map,
- visual seams between adjacent map tiles,
- self-loop checks for repeated single-tile fills,
- duplicate runtime tile policy checks for different referenced masks that produce
  identical or near-identical tile images,
- source-atlas structure policy checks for sheets that read as one continuous scene,
- shared palette/style drift,
- taxonomy for blocking tile quality failures.

## Module

```text
src/scene-pack/tileQualityGate.js
```

Public entry points:

```text
measureSharedEdgeDelta(sourceTile, neighborTile, side)
evaluateSceneTileQualityGate({ map, tiles, source, palette, thresholds, gatePolicy, rawTilePolicy, profile })
```

`tiles` may be a plain object or `Map` keyed by tile mask.

## Edge Comparison

`measureSharedEdgeDelta()` compares touching borders:

```text
east  -> west
west  -> east
north -> south
south -> north
```

The gate compares the body of the edge and skips corners when an edge has more
than two pixels. This avoids double-counting corner pixels that belong to both a
horizontal and vertical edge.

Edge delta is the per-pixel maximum channel difference across RGBA channels,
averaged over the compared edge pixels.

## Gate Report

```json
{
  "schema_version": 1,
  "profile": "topdown_tile_dual_grid_v0",
  "status": "fail",
  "blocking_errors": ["tile.metadata_seam_mismatch", "tile.visual_seam_mismatch"],
  "warnings": ["tile.style_drift"],
  "thresholds": {
    "maxVisualSeamDelta": 8,
    "maxSelfLoopDelta": 8,
    "maxOffPaletteRatio": 0.1
  },
  "gate_policy": {
    "raw_tile_quality": "warn"
  },
  "gates": [
    {
      "id": "metadata_seams",
      "status": "fail",
      "threshold": { "max_edge_mismatch_count": 0 },
      "observed": {
        "edge_mismatch_count": 1,
        "checked_adjacencies": 1,
        "width": 2,
        "height": 1,
        "tile_count": 2
      },
      "details": { "edge_mismatches": [] }
    },
    {
      "id": "visual_seams",
      "status": "fail",
      "threshold": { "max_average_edge_delta": 8 },
      "observed": {
        "checked_pair_count": 1,
        "failed_pair_count": 1,
        "missing_image_count": 0,
        "max_edge_delta": 180
      },
      "details": { "failed_pairs": [], "missing_images": [] }
    },
    {
      "id": "tile_self_loops",
      "status": "pass",
      "threshold": { "max_average_edge_delta": 8 },
      "observed": {
        "checked_tile_count": 1,
        "checked_axis_count": 2,
        "failed_tile_count": 0,
        "max_edge_delta": 0
      },
      "details": { "failed_tiles": [] }
    },
    {
      "id": "tile_distinctness",
      "status": "warning",
      "policy": { "raw_tile_quality": "warn" },
      "threshold": {
        "max_duplicate_pair_count": 0,
        "max_average_tile_delta": 1
      },
      "observed": {
        "checked_tile_count": 2,
        "checked_pair_count": 1,
        "duplicate_pair_count": 1
      },
      "details": {
        "duplicate_pairs": [
          { "a": "mask_6", "b": "mask_15", "average_delta": 0, "max_delta": 0 }
        ]
      }
    },
    {
      "id": "source_atlas_structure",
      "status": "warning",
      "policy": { "raw_tile_quality": "warn" },
      "threshold": {
        "max_continuous_boundary_count": 0,
        "max_average_boundary_delta": 8,
        "min_opaque_pair_ratio": 0.75,
        "min_boundary_color_count": 4
      },
      "observed": {
        "checked_boundary_count": 24,
        "continuous_boundary_count": 3,
        "max_opaque_pair_ratio": 1,
        "min_continuous_average_delta": 1.5
      },
      "details": { "continuous_boundaries": [] }
    },
    {
      "id": "style_drift",
      "mode": "report_only",
      "status": "warning",
      "threshold": { "max_off_palette_ratio": 0.1 },
      "observed": {
        "checked_tile_count": 1,
        "max_off_palette_ratio": 1,
        "max_average_nearest_palette_distance": 12,
        "max_nearest_palette_distance": 48
      },
      "details": { "output_mutation": "none", "reports": [] }
    }
  ],
  "edge_conditioning": {
    "mode": "edge_aware_conditioning_v1",
    "enabled": true,
    "band": 3
  },
  "style_correction": {
    "mode": "palette_snap",
    "output_mutation": "palette_snap"
  },
  "failure_taxonomy": [
    {
      "category": "tile.self_loop_mismatch",
      "count": 2,
      "examples": ["mask_6 horizontal", "mask_6 vertical"]
    }
  ],
  "metrics": {}
}
```

`metrics` repeats gate payloads under stable keys for internal convenience; new
report consumers should prefer `gates[]`.

`gate_policy.raw_tile_quality` controls whether raw tile inventory problems are
release-blocking. The default is `warn`, which keeps upload and preview
workflows usable while surfacing quality debt. `strict` upgrades
`tile_distinctness` and `source_atlas_structure` issues to gate failures and
adds their taxonomy ids to `blocking_errors`. Live/release benchmark runners use
`strict` by default; ad hoc ingestion and generation remain `warn` unless the
caller opts in.

`edge_conditioning` is present only when the tile sheet was explicitly processed
through the opt-in local edge-conditioning path before the gate ran. It is
reporting metadata, not a relaxed threshold.

`style_correction` is present only when the tile sheet was explicitly processed
through the opt-in pixel style correction path before the gate ran. It records
mutation evidence; it does not relax seam, self-loop, source-atlas, or style
thresholds.

## Failure Semantics

Blocking errors:

- `tile.metadata_seam_mismatch`: dual-grid masks are incompatible at a shared
  map edge.
- `tile.visual_seam_mismatch`: adjacent map tiles have visually incompatible
  touching edges.
- `tile.self_loop_mismatch`: a tile cannot be repeated against itself on one or
  both axes.
- `tile.missing_image`: the map references a tile mask that has no image.
- `tile.duplicate_runtime_tile`: in strict raw-tile policy, two or more
  distinct referenced masks resolve to identical or near-identical runtime tile
  images.
- `tile.source_atlas_continuity`: in strict raw-tile policy, source-cell
  boundaries in the `4x4` atlas look like a continuous painted scene rather than
  an inventory sheet of independent reusable tiles.

Warnings:

- `tile.duplicate_runtime_tile`: two or more distinct masks referenced by the
  current map resolve to identical or near-identical runtime tile images.
- `tile.source_atlas_continuity`: source-cell boundaries in the `4x4` atlas
  look like a continuous painted scene rather than an inventory sheet of
  independent reusable tiles.
- `tile.style_drift`: tile colors exceed the allowed off-palette ratio for the
  shared palette.

## Source Atlas Structure

When `source` is provided, the gate inspects the raw `192x192`
`topdown_tile_dual_grid_v0` source sheet before considering map arrangement.
It compares adjacent source-cell boundaries across the atlas grid. A boundary is
treated as suspicious when:

- enough paired boundary pixels are opaque,
- the boundary has enough color variety to look like art rather than a flat
  blank separator,
- the average color delta across the source-cell boundary is below the
  continuity threshold.

This gate is governed by `gate_policy.raw_tile_quality`. In `warn` mode it
reports `tile.source_atlas_continuity`; in `strict` mode the same signal becomes
a blocking error. It does not mutate pixels and does not relax seam or self-loop
thresholds. WFC and map-editor work should treat repeated
`tile.source_atlas_continuity` results as evidence that raw tile generation
needs more prompt or provider-side improvement first.

## Tile Distinctness

`tile_distinctness` compares runtime tile images for the unique masks referenced
by the current tile map. It warns when different masks are identical or
near-identical according to the average per-pixel channel delta threshold.

This gate is governed by `gate_policy.raw_tile_quality`. In `warn` mode it
avoids false confidence without blocking exploratory work; in `strict` mode it
fails release/live gates when distinct referenced masks collapse to the same
visual tile. It does not inspect unused masks when the current preview map does
not place them.

## Non-Goals

- No live tile generation.
- No prompt contract changes.
- No WFC or procedural solver.
- No complete image seam repair.
- No UI preview.

## Verification

```bash
node --test test/scene-pack/tileQualityGate.test.js
```
