# Editor Scene Protocol v0

**Status:** Draft, documentation-only  
**Owner:** Editor Workspace  
**Introduced:** 2026-06-22

## Purpose

`editor_scene_v0` describes one editable 2D scene inside an
`editor_project_v0` document. It composes referenced assets into layers with
transforms, render settings, playback settings, and optional interaction data.

It is not a replacement for LDtk, Godot, or existing scene-pack artifacts. It is
the editor-native scene document that can later export to engine-specific
formats.

## Scene Shape

```json
{
  "id": "scene_main",
  "version": "editor_scene_v0",
  "name": "Main Scene",
  "world": {
    "w": 1920,
    "h": 1080
  },
  "viewport": {
    "w": 1280,
    "h": 720
  },
  "camera": {
    "x": 0,
    "y": 0,
    "zoom": 1
  },
  "background": "#101418",
  "state_defaults": {},
  "entities": [
    {
      "id": "spawn_main",
      "type": "spawn_point",
      "position": {
        "x": 100,
        "y": 500
      }
    }
  ],
  "layers": [],
  "created_at": "2026-06-22T00:00:00.000Z",
  "updated_at": "2026-06-22T00:00:00.000Z"
}
```

## Layer Shape

```json
{
  "id": "layer_player",
  "name": "Player",
  "type": "character",
  "asset_id": "asset_character_sample_hero",
  "clip_id": "walk_down",
  "visible": true,
  "locked": false,
  "transform": {
    "position": {
      "x": 640,
      "y": 480
    },
    "scale": {
      "x": 2,
      "y": 2
    },
    "rotation_deg": 0,
    "pivot": {
      "mode": "artifact_anchor",
      "name": "feet",
      "x": null,
      "y": null
    },
    "coordinate_space": "world",
    "flip_x": false,
    "flip_y": false
  },
  "render": {
    "z_index": 20,
    "opacity": 1,
    "parallax": 1,
    "blend_mode": "normal"
  },
  "playback": {
    "activation": "auto",
    "loop_mode": "loop",
    "rate": 1,
    "start_offset_ms": 0,
    "initially_paused": false
  },
  "interaction": null
}
```

## Layer Types

Initial layer types:

- `background`
- `tilemap`
- `character`
- `prop`
- `effect`
- `foreground`
- `ui`

`interaction_zone` is not a visual layer type in v0. Interaction zones live in
`layer.interaction.trigger.zone` or in explicit non-visual entities.
`spawn_point` is an entity type, not a visual layer type.

## Entity Types

Initial non-visual entity types:

- `spawn_point`
- `hotspot`

Entities do not require `asset_id`, render settings, or playback settings.

## Coordinate Model

World coordinates are independent from viewport and camera coordinates.

- `world.w` and `world.h` define editable scene bounds.
- `viewport.w` and `viewport.h` define the intended preview/export viewport.
- `camera.x`, `camera.y`, and `camera.zoom` define the editor view.
- world origin is the top-left corner;
- positive X points right;
- positive Y points down;
- the unit is one world pixel;
- `transform.position.x` and `transform.position.y` are the layer pivot in
  the selected coordinate space;
- scale is explicit per axis in `transform.scale`;
- rotation is degrees in `transform.rotation_deg`;
- flips are explicit booleans `flip_x` and `flip_y`, not negative scale.

Coordinate spaces:

- `world`: affected by camera and parallax.
- `viewport`: UI-space placement; not affected by camera or parallax.

Default pivots:

- `character`: use the feet/bottom anchor from `animations.json` or
  `editor_metadata.json`.
- `background`: top-left.
- `tilemap`: top-left.
- `prop` / `effect`: artifact metadata pivot, or center if no metadata exists.
- `ui`: viewport-space pivot appropriate to the UI asset.

Parallax projection:

```text
screenX = (worldX - cameraX * parallax) * zoom
screenY = (worldY - cameraY * parallax) * zoom
```

Viewport-space UI layers do not apply camera or parallax.

Pixel-art rendering should use nearest-neighbor sampling where the renderer
allows it.

## Export Mapping Boundary

Engine exporters must define how editor pivots map into engine coordinates
before they are treated as production-ready:

- LDtk entity positions should use the editor pivot point unless an exporter
  profile says otherwise.
- Godot `Node2D` positions should use the editor pivot point; sprite offsets
  may compensate for texture top-left origin.
- Character feet anchors must be converted explicitly from artifact frame space
  to scene world space.
- UI layers may export to a separate UI/canvas layer instead of the world scene.
- Rotation is stored as degrees; exporters convert to engine units as needed.

## Playback

Layer playback does not use one global frame index.

Each animated layer may resolve a clip descriptor from its asset reference and
then compute its displayed frame from:

- clip fps;
- layer playback mode;
- layer playback rate;
- layer start offset;
- runtime clock.

Playback separates activation from loop behavior.

Initial activation modes:

- `auto`
- `manual`

Initial loop modes:

- `loop`
- `once`
- `ping_pong`

Validation:

- `rate` must be positive.
- `start_offset_ms` must be non-negative.
- activation must be known.
- loop mode must be known.
- static assets must not auto-loop.
- a layer without a resolved clip must not define animated playback.

## Validation Rules

Reject scene documents when:

- scene id or layer id is malformed;
- entity id is malformed;
- scene version is unknown;
- world or viewport dimensions are not positive integers;
- camera zoom is not positive;
- transform values are not finite numbers;
- transform coordinate space is unknown;
- pivot mode is unknown;
- opacity is outside `0..1`;
- z-index is not an integer;
- layer type is unknown;
- entity type is unknown;
- a layer references a missing asset;
- a layer clip id does not resolve against the referenced asset when required;
- interaction data fails `editor_interaction_v0`;
- an interaction zone with `owner_local` is attached without an owner layer;
- a viewport-space layer uses world parallax;
- playback activation or loop mode is unknown;
- static assets auto-loop;
- a locked layer is mutated by command application without explicit override.

## History Strategy

The first implementation should use scene snapshot history:

- pointer move updates only an ephemeral draft;
- pointer up commits one history entry;
- each drag produces one undo step;
- history limit defaults to `100`;
- animation ticks do not enter history;
- saves do not enter history;
- scene switch isolates history;
- undo/redo restores selection with fallback when the selected layer no longer
  exists.

## Non-goals

- No complete game-engine runtime.
- No shader graph.
- No skeletal or mesh editing.
- No full WFC editor.
- No embedded image data.
