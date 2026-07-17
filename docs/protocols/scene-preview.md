# Scene Preview Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 Scene Preview

## Purpose

Scene preview gives the UI a provider-free way to inspect the first dual-grid
tile profile before live tile generation exists. It builds valid local maps from
shared corner patterns, can render an uploaded real tile sheet, and reuses the
same scene and LDtk export contracts as the artifact pipeline.

## Modules

```text
src/scene-pack/scenePreview.js
src/ui/scenePackPreview.js
```

Public scene-pack entry points:

```text
buildScenePreviewMaskGrid({ width, height, pattern })
buildScenePreviewBundle({ projectId, identifier, width, height, pattern, seed, density, tilesetRelPath })
```

## Patterns

The first preview patterns are deterministic:

```text
island
path
solid
rule
```

They are generated from a shared corner grid, then converted into dual-grid tile
masks. This keeps every adjacent tile edge compatible by construction.

`rule` uses `buildRuleBasedTileMap()` with a deterministic seed and density. The
result includes `rule_based_dual_grid_v0` arrangement metadata and still exports
through the same scene/LDtk project path.

## Bundle

`buildScenePreviewBundle()` returns:

```json
{
  "status": "pass",
  "maskGrid": {},
  "map": {},
  "sceneJson": {},
  "ldtkProjectJson": {},
  "metrics": {
    "width": 6,
    "height": 4,
    "tile_count": 24,
    "unique_mask_count": 8,
    "arrangement_mode": "rule_based_dual_grid_v0"
  }
}
```

The bundle is local-only and can feed:

- canvas preview rendering,
- `scene.json`,
- `project.ldtk`,
- later artifact writer or UI download work.

## UI Contract

The first UI surface lives in the prompt tab and exposes:

```text
scene-preview-width
scene-preview-height
scene-preview-pattern
scene-preview-seed
scene-preview-density
scene-preview-style-snap
scene-preview-style-max-colors
scene-preview-edge-condition
scene-preview-edge-band
scene-preview-edge-condition-mode
scene-preview-tileset-file
scene-preview-render
scene-preview-process
scene-preview-canvas
scene-preview-export-summary
scene-preview-links
```

Without an uploaded tile sheet, the canvas renderer uses simple original pixel
blocks. With an uploaded tile sheet, it renders the central runtime tiles from a
real `192x192` padded source atlas and can call `/api/process-scene-tiles` to
write local scene pack artifacts.

`seed` and `density` are used by the `rule` pattern. The style and edge controls
mirror the CLI order: optional palette snap first, optional edge conditioning
second, then normal tile-sheet ingestion and quality-gate reporting.

## Non-Goals

- No live tile generation.
- No full WFC solver.
- No map editor interactions.
- No direct artifact writer in the browser; downloads come from the local API.

## Verification

```bash
node --test test/scene-pack/scenePreview.test.js
node --test test/localSmokeScript.test.js
```
