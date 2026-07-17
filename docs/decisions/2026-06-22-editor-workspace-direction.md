# Editor Workspace Direction

## Status

Accepted on 2026-06-22 as the v0.5 direction. Implementation has not started.

## Context

The project already has strong artifact-first pipelines:

- character pack generation, upload processing, validation, Row GIF previews,
  repair artifacts, and multi-engine exports;
- motion-source extraction and strip application;
- scene and 2.5D tileset pipelines with local validation, preview artifacts,
  LDtk/Tiled outputs, and project-pack composition;
- provider adapters, benchmark reports, quality gates, and local API jobs.

The missing layer is not basic Canvas drawing. The missing layer is an Editor
Workspace that can register real artifacts, compose them into scenes, inspect
layers and clips, visually debug pipeline stages, and eventually run lightweight
interactions.

A user-provided editor/canvas upgrade plan compared this project with a public
2D editor workflow. That reference is treated as clean-room behavior research:
it may inform product structure, but no external source code, assets, templates,
private behavior, names, or implementation details may be copied.

## Decision

Make Editor Workspace the v0.5 main direction.

The first step is Phase 0 documentation and protocol work only:

- decision record,
- editor project protocol,
- asset reference protocol,
- scene protocol,
- interaction protocol,
- processing recipe protocol,
- design spec,
- implementation plan,
- roadmap and attribution boundary updates.

No business source code, existing UI, server endpoint, provider adapter,
pipeline contract, exporter, or generated artifact is changed in Phase 0.

## Scope Classification

Core for v0.5:

- Scene Authoring Workspace.
- Artifact Registry and Project Store.
- Asset Library.
- Layer Editor and Inspector.
- Timeline and independent animation runtime.
- Visual Repair Workspace.
- Editor Project export path.

Candidate after the Core path has evidence:

- Interaction authoring.
- Playtest runtime.
- Scene Flow board.
- Expanded engine scene export.

Deferred:

- PixiJS or WebGL renderer, unless performance measurements require it.
- Skeletal rig editor.
- Mesh deformation.
- Multiplayer/cloud/editor marketplace features.

Not Planned:

- Full Pixel Editor. Visual Repair Workspace is Core, but rebuilding a general
  brush/pencil/eraser pixel-art editor is outside this product direction.

## Architecture Boundary

The Editor Workspace must wrap existing artifacts. It must not replace the
validated pipelines.

```text
Existing generation/upload pipelines
-> quality gates and artifact writers
-> artifact registry
-> editor project core
-> scene authoring, timeline, visual repair, interaction
-> editor project export
```

Existing pipeline contracts stay the source of truth for generated assets:

- `src/character-pack/*` remains responsible for character processing,
  validation, generation contracts, exports, and artifact writing.
- `src/scene-pack/*` and `src/two-point-five-d/*` remain responsible for scene
  and tileset processing, validation, and exports.
- `src/project-pack/*` remains responsible for existing character plus scene
  composition.
- Future editor modules should register and reference artifacts, not mutate
  generated job directories in place.

## UI Boundary

The new editor UI must be parallel, not replace.

- Keep the existing `/` application reachable.
- Add a later `/editor` route only when Phase 3 begins.
- Do not keep expanding `index.html` with the full editor.
- Do not use mock pipeline results.
- Do not expose provider keys in browser-visible state.

The first editor renderer should use a measured hybrid approach:

- tile maps: Canvas;
- background/entities/UI: DOM where practical;
- selection, grid, anchor, and interaction overlays: SVG elements created
  safely through DOM APIs, not raw SVG string injection;
- animation: one requestAnimationFrame loop with independent per-layer clocks.

PixiJS or another high-performance renderer is performance-gated.

## Data Boundary

The project must separate four state layers:

- persistent project state in `editor_project_v0`;
- ephemeral editor UI state such as selection, hover, zoom, pan, tool, and
  clipboard;
- runtime simulation state such as active scene, flags, inventory, player,
  camera, and temporary overrides;
- processing job state from existing local API jobs.

Do not collapse these into one global object.

## Clean-room And Attribution Boundary

Allowed:

- learn from public product behavior and common editor patterns;
- implement original protocols and code in this repository;
- interoperate with public game formats already covered by repository policy.

Not allowed:

- copy external source code, bundled assets, templates, private APIs, or runtime
  implementation;
- use adjacent product names as module names, class names, file names, API
  identifiers, UI branding, or replacement claims;
- import a new dependency without a clear reason, tests, and attribution update.

## Consequences

- Phase 1 can implement `src/editor-project/*` only after Phase 0 docs are
  reviewed.
- Phase 2 can add artifact registry and project persistence without touching
  old APIs.
- Phase 3 can add a parallel editor shell after the project core and store are
  tested.
- Scene Authoring Canvas should arrive before broad playtest or scene-flow work.
- Visual Repair should use recorded artifacts and processing recipes, creating
  new artifact revisions rather than overwriting old jobs.

## Verification

Phase 0 is complete when:

- all planned decision, protocol, spec, and plan documents exist;
- roadmap classifications are updated;
- clean-room behavior reference is documented without implying source reuse;
- existing APIs and artifacts that stay unchanged are listed;
- `git diff --check` passes;
- `npm test` passes;
- the work is committed as a documentation-only unit.
