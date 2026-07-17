# Scene Tile Profile Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 Phase 1

## Purpose

Scene generation needs a stable tile contract before prompts, maps, or exports
are added. The first v0.4 tile profile defines a compact dual-grid atlas with
explicit source padding so generated fixed tiles do not start from crowded or
ambiguous source cells.

## Profile

The executable profile lives in:

```text
src/scene-pack/tileProfile.js
```

`topdown_tile_dual_grid_v0` uses:

```text
tile size: 32x32
source cell: 48x48
source padding: 8 px on every side
source sheet: 192x192
grid: 4 columns x 4 rows
tile count: 16
```

The source region for each tile is row-major:

```text
x = col * source_cell_width + padding
y = row * source_cell_height + padding
w = tile_width
h = tile_height
```

The surrounding padding is part of the provider/source-layout contract. It is
not exported as runtime tile pixels.

## Dual-Grid Masks

The 16 atlas entries use a four-corner bitmask:

```text
nw = 1
ne = 2
se = 4
sw = 8
```

Edges are derived from adjacent corners:

```text
north: nw, ne
east:  ne, se
south: sw, se
west:  nw, sw
```

Two tiles are edge-compatible when the shared edge signatures match. This check
is intentionally metadata-only; image seam scoring comes later after real tile
generation exists.

## Metadata

`buildTileAtlasMetadata()` returns:

```json
{
  "version": "0.1",
  "profile": "topdown_tile_dual_grid_v0",
  "tile_size": { "w": 32, "h": 32 },
  "grid": { "columns": 4, "rows": 4 },
  "source": {
    "sheet": { "w": 192, "h": 192 },
    "cell": { "w": 48, "h": 48, "padding": 8 }
  },
  "tiles": [
    {
      "id": "mask_0",
      "index": 0,
      "row": 0,
      "col": 0,
      "mask": 0,
      "corners": { "nw": false, "ne": false, "se": false, "sw": false },
      "edges": {
        "north": [false, false],
        "east": [false, false],
        "south": [false, false],
        "west": [false, false]
      },
      "source": { "x": 8, "y": 8, "w": 32, "h": 32 }
    }
  ]
}
```

## Validation

`validateTileProfile()` is a local structural check. It fails when:

- source padding is below `thresholds.minSourcePaddingPx`,
- tile size cannot fit inside the padded source cell,
- source sheet dimensions do not match `grid * source_cell`.

## Non-Goals

- No live provider generation.
- No tile prompt contract.
- No image seam scoring.
- No WFC or rule-based map arrangement.
- No LDtk export.
- No scene preview.

These remain later v0.4 work after the source/tile contract is stable.

## Verification

```bash
node --test test/scene-pack/tileProfile.test.js
```
