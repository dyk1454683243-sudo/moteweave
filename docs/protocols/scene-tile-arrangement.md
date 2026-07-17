# Scene Tile Arrangement Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 Phase 2

## Purpose

Tile arrangement starts as a local validation and export contract. It should be
possible to reject impossible tile adjacency before spending provider quota or
writing game-engine project files.

The first unit is deliberately small:

- build a row-major tile map from dual-grid masks,
- build deterministic rule-based dual-grid maps from seeded corner grids,
- validate east/south shared-edge compatibility,
- export a stable LDtk-style JSON skeleton.

## Tile Map

`buildTileMap({ width, height, masks })` returns:

```json
{
  "profile": "topdown_tile_dual_grid_v0",
  "tile_size": { "w": 32, "h": 32 },
  "width": 2,
  "height": 1,
  "cells": [
    { "index": 0, "x": 0, "y": 0, "mask": 6, "tile_id": "mask_6" },
    { "index": 1, "x": 1, "y": 0, "mask": 9, "tile_id": "mask_9" }
  ]
}
```

`masks.length` must equal `width * height`, and every mask must be valid for the
active tile profile.

## Rule-Based Arrangement

`buildRuleBasedTileMap({ width, height, seed, density })` generates a seeded
corner grid, converts every cell to a dual-grid mask, and returns a normal tile
map with arrangement metadata:

```json
{
  "arrangement": {
    "mode": "rule_based_dual_grid_v0",
    "seed": 42,
    "density": 0.55,
    "corner_grid_size": { "w": 6, "h": 5 }
  }
}
```

Because masks are derived from one shared corner grid, metadata seams are valid
by construction. This is a small deterministic solver, not a full WFC
implementation.

## Validation

`validateTileMap(map)` checks:

- cell count,
- mask range,
- east neighbor edge compatibility,
- south neighbor edge compatibility.

Only east and south are checked because that covers every shared edge exactly
once in a row-major grid.

The result shape is:

```json
{
  "status": "fail",
  "blocking_errors": ["tile_edge_mismatch"],
  "edge_mismatches": [
    {
      "at": { "x": 0, "y": 0, "index": 0, "mask": 6 },
      "neighbor": { "x": 1, "y": 0, "index": 1, "mask": 1 },
      "side": "east"
    }
  ],
  "metrics": {
    "width": 2,
    "height": 1,
    "tile_count": 2,
    "checked_adjacencies": 1
  }
}
```

## LDtk-Style Export

`buildLdtkSceneJson({ map, identifier })` rejects invalid maps and emits a stable
JSON skeleton with:

- top-level format marker,
- scene identifier,
- profile id,
- world pixel size,
- tileset definition,
- one tile layer with `grid_tiles`.

This is an LDtk-style internal interchange shape, not a claim of complete LDtk
project compatibility. Complete single-level LDtk project JSON is handled by
`src/scene-pack/ldtkProjectExport.js`.

## Non-Goals

- No full WFC solver.
- No interactive map editor.
- No image seam scoring.
- No live tile generation.

## Verification

```bash
node --test test/scene-pack/tileArrangement.test.js
```
