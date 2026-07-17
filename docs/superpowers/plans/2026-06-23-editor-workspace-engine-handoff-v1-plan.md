# Editor Workspace Engine Handoff v1 Plan

**Date:** 2026-06-23
**Status:** Implemented on `codex/editor-workspace-engine-handoff-v1`
**Depends on:** `docs/runbooks/editor-workspace-v0-closeout.md`

## Goal

Turn the Editor Workspace project pack into a reviewed engine handoff surface.
The v1 exporter should make engine import expectations explicit, preserve every
existing v0 endpoint, and avoid pretending that preview payloads are complete
engine-native scenes.

## Non-Goals

- No full pixel editor.
- No broad multi-level scene productization.
- No arbitrary Wave Function Collapse feature expansion.
- No provider calls.
- No copying engine plugin code or bundled third-party templates.
- No changes to legacy `/api/project-pack` behavior.
- No replacement of existing character, scene, or 2.5D pipeline exports.

## Phase 1: Export Mapping Protocol Tightening

Define the handoff contract before adding new output files.

Deliver:

- formal mapping notes for world coordinates, UI coordinates, pivot/anchor,
  parallax, layer order, `flip_x`, `flip_y`, and animation playback;
- action mapping notes for `show_text`, `scene_link`, `emit_event`,
  `set_flag`, and unsupported actions;
- Godot and LDtk profile capability tables;
- fixtures that prove unsupported data becomes warnings or explicit omissions.

Acceptance:

- documentation and protocol tests only;
- no generated artifact mutation;
- no changes to existing exporter URLs;
- focused tests and full `npm test` pass.

Implementation:

- `docs/protocols/editor-engine-handoff-v1.md`
- `ENGINE_EXPORT_MAPPING` in `src/editor-project/engineHandoff.js`
- mapping tests in `test/editor-project/editorEngineHandoff.test.js`

## Phase 2: Neutral Engine Handoff Manifest

Add `engine_handoff_manifest_v1` as the stable bridge from editor project data to
engine-specific importers.

Deliver:

- scene list, layer list, entity list, asset references, interaction list, and
  unsupported item list;
- deterministic ids and paths;
- per-engine capability summaries;
- validation that rejects dangling project references before export.

Acceptance:

- the manifest is engine-neutral JSON;
- it can be included in project pack ZIPs without removing current files;
- old project pack consumers can ignore it safely.

Implementation:

- `engine_handoff_manifest.json` in `editor_project_pack_v1`
- `validateEngineHandoffManifest()`

## Phase 3: Godot Scene Handoff Prototype

Produce a reviewable Godot-oriented handoff package without shipping plugin code.

Deliver:

- project-owned JSON manifest for Godot importers;
- scene node/layer ordering, positions, pivots, sprite asset refs, spawns,
  hotspots, and scene-link metadata;
- explicit preview/review status in validation output;
- a manual import checklist.

Acceptance:

- no bundled Godot executable, plugin, or copied engine code;
- unsupported interactions are visible as warnings;
- existing Godot character ZIP payload copying remains unchanged.

Implementation:

- `engines/godot/scene_handoff.json`
- claim boundary `preview_metadata_only_no_godot_plugin_or_scene_file_generated`

## Phase 4: LDtk Single-Level Scene Handoff Prototype

Add a conservative LDtk-oriented handoff only for the parts that map cleanly.

Deliver:

- one level per supported editor scene, where possible;
- layer and entity metadata aligned to the neutral handoff manifest;
- preservation of existing scene-pack LDtk payload copying;
- explicit unsupported-item reporting.

Acceptance:

- no claim of complete multi-level LDtk production support;
- no WFC expansion;
- unsupported editor data is listed rather than silently dropped.

Implementation:

- `engines/ldtk/scene_handoff.json`
- claim boundary `single_level_preview_metadata_not_complete_ldtk_world_export`

## Phase 5: Consumer Validation And Runbook

Close the v1 exporter round with repeatable review steps.

Deliver:

- static validation tests for handoff manifests and prototype payloads;
- a manual Godot import review checklist;
- a manual LDtk import review checklist;
- release-note language that distinguishes preview handoff from production
  engine-native export.

Acceptance:

- `git diff --check` passes;
- focused handoff/export tests pass;
- full `npm test` passes;
- `npm run smoke:local` passes if any UI entry point changes;
- legacy `/api/project-pack` and `/api/editor/*` v0 behavior remain covered.

Implementation:

- `docs/runbooks/editor-workspace-engine-handoff-v1.md`
- pack ZIP assertions in `test/editor-project/editorEngineHandoff.test.js`
