# V2 Interactive Runtime Direction

**Date:** 2026-06-22
**Status:** Superseded by the more specific Editor Workspace v0 plan
**Source:** User-provided `GameTool_v2_Upgrade_Plan.docx`
**Scope:** Longer-horizon architecture for turning the current artifact-first asset pipelines into an interactive review and co-edit system.

## Summary

The DOCX plan proposes moving GameTool from a batch pipeline/export tool toward
an AI-native 2D asset creation system with a Canvas runtime, scene graph, state
model, pipeline visual debugger, and AI co-edit loop.

This first-pass direction has now been refined by
`docs/decisions/2026-06-22-editor-workspace-direction.md` and
`docs/superpowers/plans/2026-06-22-editor-workspace-v0-plan.md`. Treat the
Editor Workspace documents as the active plan of record. This file remains as
the earlier direction note that led to that more specific plan.

The direction is sound, but it is too broad to implement as a single rewrite.
The current project already has strong artifact-first character, motion-source,
scene, 2.5D, and project-pack pipelines. V2 should build an interactive runtime
around those artifacts instead of replacing the validated processing contracts.

## Current Fit

- The project already has browser preview surfaces and local artifact manifests,
  but they are feature-specific rather than a shared runtime layer.
- The project has pipeline evidence, debug reports, overlays, preview images,
  Row GIFs, tileset previews, and export packages. These are good inputs for a
  future visual debugger.
- The project has early repair/co-edit behavior through the one-action character
  repair loop, but it is still user-selected and quota-confirmed. That boundary
  should remain until repair quality is more reliable.
- The project does not yet have a general scene graph, unified editor state, or
  Canvas runtime abstraction for sprites, tiles, scenes, and pipeline steps.

## Recommended Phases

### Phase 0: Runtime Contract

- Define a neutral asset-view contract for sprites, strips, sheets, tilesets,
  maps, overlays, anchors, bounding boxes, and debug layers.
- Map existing artifacts into that contract without changing exports.
- Keep current processing modules as the source of truth.

### Phase 1: Canvas Review Runtime

- Build a shared browser runtime for image/sprite/tile previews.
- Support animation playback, frame scrubbing, zoom, pan, selection, anchor
  markers, bounding boxes, grid overlays, and checkerboard/solid backgrounds.
- Start as review-only. Do not add destructive editing in this phase.

### Phase 2: Editor State Layer

- Centralize UI state for selection, current asset, playback, preview options,
  and visible debug overlays.
- Keep provider keys, quota confirmation, and live generation outside persistent
  browser-visible state.
- Preserve existing Character Pack, Motion Source, Sprite Sheet, Scene, 2.5D,
  and Project Pack tabs while sharing preview/runtime state where practical.

### Phase 3: Asset And Scene Graph

- Introduce a neutral graph for assets, entities, transforms, layers, z-order,
  and references to generated artifacts.
- Start with project-pack composition and 2.5D map preview, where scene-like
  structures already exist.
- Avoid claiming a full game editor until import/export and validation evidence
  supports that workflow.

### Phase 4: Pipeline Visual Debugger

- Visualize existing pipeline stages from recorded artifacts: source, cleanup,
  slicing, normalization, repair, finishing, validation, and export.
- Allow safe stage re-run only when an existing local API supports it.
- Record every re-run as a new artifact set rather than mutating prior evidence.

### Phase 5: AI Co-edit Loop

- Route AI edits through explicit structured repair plans, masks or target
  regions, provider-call estimates, and user confirmation.
- Start with one selected action or region, then expand only after tests prove
  stable identity, layout, and background behavior.
- Do not add autonomous multi-action replacement or semantic auto-fixing until
  there is measurable quality evidence.

## Boundaries

- Do not create a broad rewrite branch for all v2 modules at once.
- Do not add product or module names that imply replacement of adjacent tools.
- Do not copy editor/runtime code, templates, or private behavior from external
  products.
- Do not present the v2 runtime as shipped until the browser uses real artifacts
  and tests cover the interaction surface.
- Keep artifact manifests, validation reports, and exports as the durable source
  of truth even after interactive previews are added.

## Earlier First Implementation Candidate

The earlier proposed first slice was the Canvas Review Runtime for Character
Pack previews:

- One shared preview renderer for normalized sheets, Row GIF frames, repaired
  strips, inspection previews, anchors, and bounding boxes.
- Toggleable overlays for grid, anchor, bbox, and background.
- Frame scrubber and playback controls using existing artifacts.
- No provider calls, no destructive edits, and no export-format changes.

The refined plan changes the first concrete step to Phase 0 decision/protocol
work and then Editor Project Core, because scene authoring and persistent
project state must be designed before a broad editor runtime is implemented.

## Verification

- Unit tests for asset-view contract conversion from current artifact manifests.
- Browser smoke test for Character Pack preview controls.
- Visual QA with representative local upload and AI generation jobs.
- `git diff --check` for documentation-only updates.
