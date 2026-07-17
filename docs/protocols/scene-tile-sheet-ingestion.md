# Scene Tile Sheet Ingestion Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 Scene Tile Sheet Ingestion

## Purpose

Scene tile sheet ingestion accepts a real source atlas for
`topdown_tile_dual_grid_v0`, extracts the central runtime tiles, runs the scene
tile quality gate, and writes normal scene pack artifacts. It is the bridge
between prompt/live generation and preview/export.

This path is provider-free. It can process a user-uploaded sheet or a local PNG
without spending model quota.

## Module

```text
src/scene-pack/tileSheetIngestion.js
```

Public entry points:

```text
validateTileSheetImage(image)
extractTileSheetTiles(image)
buildScenePackFromTileSheet({ source, tilesetPng, projectId, identifier, width, height, pattern, edgeConditioningReport })
```

## Source Contract

The first accepted source sheet is locked to `topdown_tile_dual_grid_v0`:

```text
192x192 source image
4 columns x 4 rows
16 source cells
48x48 source cell
8 px padding on every side
32x32 central runtime tile
row-major mask order 0-15
```

`extractTileSheetTiles()` uses `getTileSourceRegion()` for every mask, so the
source coordinates remain shared with tile atlas metadata, prompt contracts, and
LDtk export.

The raw source sheet is also passed into the scene tile quality gate. This lets
`quality_gate.json` warn when the `4x4` atlas appears to be one continuous
scene painted across source-cell boundaries instead of an inventory of
independent reusable tiles.

## Validation

`validateTileSheetImage()` returns:

```json
{
  "status": "pass",
  "blocking_errors": [],
  "warnings": [],
  "metrics": {
    "width": 192,
    "height": 192,
    "expected_width": 192,
    "expected_height": 192,
    "tile_count": 16,
    "source_cell_size": { "w": 48, "h": 48, "padding": 8 },
    "runtime_tile_size": { "w": 32, "h": 32 }
  }
}
```

Blocking errors:

- `source_sheet_size_mismatch`
- `source_sheet_data_size_mismatch`
- profile validation errors from `validateTileProfile()`

## Scene Pack Output

`buildScenePackFromTileSheet()` returns a scene result compatible with
`writeScenePackArtifacts()`:

```text
scene.json
tile_atlas.json
tile_map.json
quality_gate.json
style_correction.json (optional)
edge_conditioning.json (optional)
tile_conditioning_review.json (optional)
tile_conditioning_review.png (optional)
project.ldtk
tileset.png
scene_pack.zip
```

The map still comes from the deterministic scene preview pattern. The uploaded
sheet supplies tile pixels only; it does not bypass map validation or change the
export structure.

`pattern: "rule"` uses the deterministic `rule_based_dual_grid_v0`
arrangement. `seed` and `density` may be provided to reproduce a generated map.

`quality_gate.json` may include `source_atlas_structure` and
`tile_distinctness`. By default these raw tile inventory checks run in `warn`
mode and report `tile.source_atlas_continuity` or
`tile.duplicate_runtime_tile` without blocking exploratory uploads. Callers can
pass strict raw-tile policy for release/live gates:

```bash
--raw-tile-policy strict
```

In strict mode, the same raw tile inventory signals become blocking quality gate
errors while seam, self-loop, and style thresholds remain unchanged.

## Optional Style Correction

The CLI ingestion path can opt into local palette snapping before edge
conditioning and quality validation:

```bash
--style-snap --style-max-colors 16
```

When enabled, `applyPixelStyleCorrection(..., { mode: "palette_snap" })`
returns the corrected source sheet plus a `style_correction.json` report. The
written `tileset.png` uses the corrected pixels, and the same report is attached
to `quality_gate.json.style_correction`.

## Optional Edge Conditioning

The CLI ingestion path can opt into local edge conditioning before the quality
gate runs:

```bash
npm run character-pack -- scene tile-ingest \
  --input tileset.png \
  --output-dir generated/cli \
  --job-id scene_tile_ingest_conditioned \
  --identifier uploaded_scene \
  --width 6 \
  --height 4 \
  --pattern island \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1
```

When enabled, the runtime tile edge bands are conditioned, the source
`tileset.png` artifact is re-encoded from the conditioned source sheet,
`edge_conditioning.json` records the structural mutation, and
`tile_conditioning_review.json` plus `tile_conditioning_review.png` record
raw-vs-conditioned visual review evidence. The same edge-conditioning report is
attached to `quality_gate.json.edge_conditioning`.

## CLI

```bash
npm run character-pack -- scene tile-ingest \
  --input tileset.png \
  --output-dir generated/cli \
  --job-id scene_tile_ingest \
  --identifier uploaded_scene \
  --width 6 \
  --height 4 \
  --pattern island
```

## HTTP API

```text
POST /api/process-scene-tiles
```

Request body:

```json
{
  "source_base64": "<png base64>",
  "source_name": "tileset.png",
  "options": {
    "identifier": "uploaded_scene",
    "width": 6,
    "height": 4,
    "pattern": "island",
    "seed": 1,
    "density": 0.5
  }
}
```

The response is a normal async job. When the quality gate fails, diagnostic
artifacts are still written and the job status becomes `failed_quality_gate`.

## Non-Goals

- No live tile generation.
- No semantic image repair.
- No WFC/procedural solver.
- No map editor interactions.
- No automatic palette correction.
- No character-pack normalization or Row GIF generation.

## Verification

```bash
node --test test/scene-pack/tileSheetIngestion.test.js
node --test test/scene-pack/tileEdgeConditioning.test.js
node --test test/character-pack/cli.test.js
node --test test/localSmokeScript.test.js
```
