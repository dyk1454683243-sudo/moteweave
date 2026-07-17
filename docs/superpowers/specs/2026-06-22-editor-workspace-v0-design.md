# Editor Workspace v0 Design

**Date:** 2026-06-22  
**Status:** Draft design, Phase 0 documentation  
**Decision:** `docs/decisions/2026-06-22-editor-workspace-direction.md`

## Product Goal

Editor Workspace v0 turns the current asset compiler into an interactive 2D
game content workspace without replacing the existing pipelines.

The product path is:

```text
AI or upload
-> existing character, motion, scene, and tileset pipelines
-> quality gates and artifact manifests
-> artifact registry
-> persistent editor project
-> scene authoring, timeline, visual repair, interaction
-> editor project export
```

The workspace is not a full pixel editor, not a generic drawing app, and not a
complete game engine.

## User Jobs

- Register a generated or uploaded character as a reusable project asset.
- Register a scene pack, 2.5D tile map, static image, prop, or effect as an
  asset.
- Keep asset revisions for generated, imported, and repaired versions without
  overwriting old artifacts.
- Compose assets into one or more scenes.
- Select, move, scale, hide, lock, reorder, and inspect layers.
- Preview independent animation clips in the same scene.
- Inspect source, normalized, onion, debug, and quality artifacts when a frame
  or action is wrong.
- Save project state separately from generated job artifacts.
- Export an editor project pack for downstream game tools.

## First Product Slice

The first implemented slice after Phase 0 should be Editor Project Core, not UI.

Phase 3 later adds a parallel editor shell. The old `/` app must remain
reachable.

## Layout Direction

Later UI phases should use this general layout:

```text
+-------------------------------------------------------+
| Project / Scene / Save / Undo / Redo / Play / Export  |
+--------------+-------------------------+--------------+
| Asset Library| Scene Stage             | Inspector    |
|              |                         |              |
| Characters   |                         | Transform    |
| Tilemaps     |                         | Render       |
| Props        |                         | Animation    |
| Effects      |                         | Interaction  |
+--------------+-------------------------+--------------+
| Layers / Timeline / Quality / Logs                    |
+-------------------------------------------------------+
```

## Rendering Direction

Start with a hybrid renderer:

- Tile maps use Canvas.
- Background, entities, and UI elements may use DOM where practical.
- Selection, grid, anchor, bbox, and interaction overlays use SVG DOM nodes.
- No raw SVG `innerHTML`.
- Pixel-art images use nearest-neighbor rendering.
- Animation uses one requestAnimationFrame loop with independent per-layer
  clocks.

PixiJS or WebGL is deferred until performance evidence shows the hybrid renderer
cannot meet the target.

## State Model

Keep four states separate:

- persistent project state: `editor_project_v0`;
- ephemeral editor state: selection, tool, hover, zoom, pan, clipboard, modal;
- runtime simulation state: current scene, flags, inventory, player, camera,
  interaction activation, temporary layer overrides;
- processing job state: queued, generating, post-processing, done, failure
  statuses, artifact URLs, quality results.

## Asset Library

Asset cards should eventually show:

- thumbnail;
- name;
- kind;
- profile;
- quality status;
- source job;
- provenance;
- animation/clip count;
- used scene count;
- inspect, add to scene, repair, and export actions.

Asset quality and production readiness are separate. Failed-quality assets must
be visibly marked and should be `blocked` by default. Warning or unknown assets
should be `review_required` unless the user records an explicit override reason.

Durable project assets should live in project-managed immutable storage:

```text
workspace/projects/<project-id>/assets/<asset-id>/<revision-id>/
```

Project JSON references those files; it does not embed binaries.

## Scene Stage

Scene Authoring Canvas v0 should support:

- real project/asset data;
- click selection;
- drag;
- resize handles;
- visibility and lock controls;
- layer reorder;
- z-index;
- opacity;
- parallax;
- snap and grid;
- anchor visualization;
- undo/redo;
- save/reload.

No mock data or fake pipeline results should appear in the stage.

Coordinate rules:

- world origin is top-left;
- positive X points right;
- positive Y points down;
- positions are world pixels unless a layer uses viewport coordinates;
- layer position is the pivot position, not the top-left image corner;
- character pivots default to the feet anchor from artifact metadata;
- background and tilemap pivots default to top-left;
- UI layers use viewport coordinate space;
- flip is explicit through `flip_x` / `flip_y`.

## Timeline

The timeline must support independent clips per layer. It must not use a single
global frame index for all layers.

The first timeline can inspect and scrub clips. More advanced keyframe editing
can wait.

## Visual Repair

Visual Repair Workspace should make the existing repair/correction pipeline
visible:

```text
source view
+ normalized view
+ onion skin
+ debug overlay
+ frame strip
+ anchor/nudge/cut controls
+ before/after quality metrics
```

Repair must create a new job and new asset revision. It must not overwrite old
generated artifacts.

## Interaction And Playtest

Interaction and playtest are candidates after the core editor path is stable.

Initial interaction targets:

- show text;
- play animation;
- toggle layer;
- set state;
- pickup item;
- scene link.

Initial triggers:

- auto;
- near click;
- near key;
- state condition.

Interaction zones are stored on the owning layer interaction trigger by
default, using `owner_local` coordinates. Non-visual spawn points and hotspots
belong in `scene.entities`.

## Safety

- Provider keys stay server-side.
- Project JSON forbids base64 image payloads.
- Paths are controlled relative paths only.
- Generated artifacts are immutable inputs.
- Static asset import must validate file type and sanitize names.
- New editor UI is parallel, not replacement.
- Existing pipelines and APIs stay unchanged until explicitly authorized.
- Phase 2 must update `.gitignore` before writing `/workspace/`.

## Open Questions

- Should the first `/editor` route be hidden behind a feature flag?
- Should asset deletion be allowed in v0, or only unlink from scenes?
- Which fixture jobs should become the first provider-free editor smoke inputs?
