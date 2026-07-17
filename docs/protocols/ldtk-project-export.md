# LDtk Project Export Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 LDtk Project Export

## Purpose

The LDtk project export turns a validated scene tile map into a local `.ldtk`
project JSON file. It is an interoperability export for engine/editor workflows;
the implementation is original project code and does not bundle LDtk code,
assets, or editor plugins.

The first exporter is provider-free and single-level:

- one tileset definition for `topdown_tile_dual_grid_v0`,
- one `Tiles` layer with concrete `gridTiles`,
- one empty `Entities` layer,
- optional entity definitions with field definitions,
- required LDtk root project settings needed by downstream tools.

## Module

```text
src/scene-pack/ldtkProjectExport.js
```

Public entry points:

```text
buildLdtkProjectJson({ projectId, identifier, map, tilesetRelPath, entityDefs })
validateLdtkProjectJson(project)
```

## Project Shape

The exporter emits LDtk JSON version:

```text
1.5.3
```

The root includes `jsonVersion`, `iid`, `defs`, `levels`, `worlds`, `toc`,
`externalLevels`, project defaults, export flags, and `nextUid`.

The scene level includes:

```json
{
  "identifier": "meadow_scene",
  "pxWid": 64,
  "pxHei": 32,
  "layerInstances": []
}
```

The tileset definition points at the padded source atlas:

```json
{
  "identifier": "topdown_tile_dual_grid_v0_tileset",
  "relPath": "tileset.png",
  "tileGridSize": 32,
  "padding": 8,
  "spacing": 16,
  "__cWid": 4,
  "__cHei": 4
}
```

`padding` and `spacing` preserve the 48x48 source cells with a central 32x32
runtime tile. Tile layer instances use explicit `src` coordinates so consumers
do not have to infer padded source regions.

## Tile Layer

Each tile map cell becomes one LDtk tile payload:

```json
{
  "px": [0, 0],
  "src": [104, 56],
  "t": 6,
  "f": 0,
  "a": 1,
  "d": [0, 0, 0]
}
```

`px` is the target pixel coordinate, `src` is the padded atlas coordinate,
`t` is the dual-grid mask, `f` is the flip flag, `a` is opacity, and `d` stores
cell `x`, `y`, and row-major index for stable traceability.

## Entity Definitions

The first exporter supports entity definitions and field definitions, but not
entity placement. This lets the project file describe expected scene entities
before the UI exposes placement tools.

Example input:

```json
{
  "identifier": "SpawnPoint",
  "fields": [
    { "identifier": "Kind", "type": "String", "defaultValue": "hero" }
  ]
}
```

## Validation

`buildLdtkProjectJson()` rejects invalid tile maps before writing project JSON.

`validateLdtkProjectJson()` checks:

- root identity and required project fields,
- tileset, `Tiles`, and `Entities` definitions,
- level identifier and pixel size,
- LDtk tile payload shape.

## Artifact Writer Integration

Scene pack artifact writing includes `project.ldtk` when `result.ldtkProjectJson`
is present. The file is also included in `scene_pack.zip`.

## Non-Goals

- No live tile generation.
- No multi-level world writer.
- No entity instance placement.
- No auto-layer rule authoring.
- No WFC/procedural arrangement.
- No UI preview.

## Verification

```bash
node --test test/scene-pack/ldtkProjectExport.test.js
node --test test/scene-pack/artifactWriter.test.js
```
