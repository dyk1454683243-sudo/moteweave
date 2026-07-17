# Editor Workspace v0 Implementation Plan

**Date:** 2026-06-22  
**Status:** Implemented through Phase 10 on main; see
`docs/runbooks/editor-workspace-v0-closeout.md` for the v0 closeout record.
**Decision:** `docs/decisions/2026-06-22-editor-workspace-direction.md`

## Summary

Build a parallel 2D Editor Workspace around the existing artifact-first
pipelines. The editor must use real pipeline artifacts, keep old UI reachable,
and advance through small verified stages.

Do not implement all phases in one branch.

## Current Integration Baseline

Phase 0 started from `codex/two-point-five-d-tileset-pipeline` at `df8f30b`.
The v0 implementation sequence is now merged into main, followed by Engine
Handoff v1, Export Review UI, and Consumer Evidence layers. For current work,
start new branches from latest `main` and use:

- `docs/runbooks/editor-workspace-v0-closeout.md` for shipped v0 scope;
- `docs/runbooks/editor-workspace-engine-handoff-v1.md` for preview engine
  handoff review;
- `docs/runbooks/editor-workspace-consumer-evidence-review.md` for the consumer
  evidence merge record.

## Phase 0: Decision And Protocols

Status: this documentation pass.

Deliver:

- `docs/decisions/2026-06-22-editor-workspace-direction.md`
- `docs/protocols/editor-project-v0.md`
- `docs/protocols/editor-asset-ref-v0.md`
- `docs/protocols/editor-scene-v0.md`
- `docs/protocols/editor-interaction-v0.md`
- `docs/protocols/processing-recipe-v0.md`
- `docs/superpowers/specs/2026-06-22-editor-workspace-v0-design.md`
- roadmap updates
- attribution or clean-room boundary update

Acceptance:

- no business source code changes;
- no UI changes;
- no provider calls;
- no generated/output scanning;
- docs do not conflict with existing roadmap;
- protocols list version, migration, validation, artifacts, and stable API
  boundaries;
- `git diff --check` passes;
- `npm test` passes.

Existing artifacts to reuse:

- Character Pack: `normalized_sheet.png`, `animations.json`,
  `metadata.json`, `editor_metadata.json`, `debug_report.json`, Row GIFs,
  inspection previews, and ZIP exports.
- Motion Source: normalized strips, contact sheets, selected-frame evidence,
  source reports, identity reports, and editor handoff manifests.
- Scene Pack: scene JSON, tile atlas/map metadata, quality gate reports,
  preview PNGs, LDtk payloads, and ZIP exports.
- 2.5D Tileset: strict/runtime atlases, validation reports, rule maps,
  material evidence, Tiled/LDtk payloads, import-readiness evidence, and
  package ZIPs.
- Project Pack: project manifest, project validation, and current combined ZIP
  exports.

Existing APIs that remain unchanged in Phase 0:

- `POST /api/generate-character`
- `POST /api/process-sheet`
- `POST /api/repair-character-action`
- `POST /api/build-frame-gif`
- `POST /api/process-scene-tiles`
- `POST /api/generate-scene-tiles`
- `POST /api/build-two-point-five-d-tileset`
- `POST /api/two-point-five-d-material-source-benchmark`
- `POST /api/project-pack`
- `GET /api/jobs/:id`
- `GET /api/gemini-state`
- `POST /api/provider-config`
- `GET /api/benchmark-gallery`

## Phase 0.1: Protocol Tightening And Guardrails

Status: required before Phase 1.

Deliver:

- valid default `editor_project_v0` example with a real active scene;
- map-key and internal-id consistency rules;
- asset revision schema with `active_revision_id`, revision map, parent
  revision, per-revision quality/production state, and recipe references;
- project-managed immutable asset storage policy under `/workspace/`;
- asset-kind required artifact matrix;
- separate `quality_status` and `production_status`;
- explicit scene coordinates, pivots, anchors, UI coordinate space, flips, and
  export mapping boundary;
- playback split into `activation` and `loop_mode`;
- interaction zone ownership and action discriminated schemas;
- complete `processing_recipe_v0` mapping for current character processing
  controls;
- `docs/guardrails/editor-workspace-guardrails.md`;
- `AGENTS.md` and UI guardrail updates for editor paths;
- Phase 2 note requiring `.gitignore` update before `/workspace/` writes.

Acceptance:

- documentation-only;
- no business source changes;
- no UI changes;
- no API changes;
- `git diff --check` passes;
- the complete `npm test` suite passes with the actual pass/fail count reported.

## Phase 1: Editor Project Core

Add `src/editor-project/*` modules:

- project defaults;
- project validator;
- migration;
- serializer;
- asset reference helpers;
- scene document helpers;
- layer document helpers;
- interaction document helpers;
- processing recipe helpers;
- command history;
- coordinate math.

Tests:

- validation;
- migration;
- serialization round trip;
- asset reference resolution;
- path safety;
- dangling asset/scene/layer/clip references;
- command history limit and grouping;
- coordinate conversion.

Boundary:

- do not modify old UI;
- do not modify server endpoints;
- do not modify character/scene/project pipeline contracts.

## Phase 2: Artifact Registry And Project Store

Add:

- artifact registry;
- project path helper;
- project store;
- editor project API handler.

Server integration:

- keep existing endpoints unchanged;
- use a thin route delegation from `server.js`;
- do not introduce Express.

Required behavior:

- atomic save;
- backup;
- revision checks;
- autosave separation;
- path traversal rejection;
- import real character and scene job artifacts;
- fail-quality asset policy;
- no generated artifact mutation.

Storage policy:

- first implementation uses project-managed immutable asset storage at
  `workspace/projects/<project-id>/assets/<asset-id>/<revision-id>/`;
- project JSON references managed files and never embeds binary data;
- generated job artifacts remain immutable import sources;
- Phase 2 must update `.gitignore` with `/workspace/` before writing local
  project assets.

## Phase 3: Parallel Editor UI Shell

Add later:

- `editor.html`;
- `src/editor-app.js`;
- `src/ui/editor/*`;
- `/editor` route.

Boundary:

- old `/` app remains active;
- no mock pipeline data;
- no provider keys in browser state;
- `npm run smoke:local` required for UI phases.

## Phase 4: Scene Authoring Canvas MVP

Use real project assets and the hybrid renderer:

- Canvas tile maps;
- DOM entities where practical;
- SVG DOM overlays;
- independent per-layer animation clocks.

MVP actions:

- select;
- drag;
- resize;
- visibility;
- lock;
- reorder;
- z-index;
- opacity;
- parallax;
- snap;
- grid;
- anchor overlay;
- undo/redo;
- save/reload.

## Phase 5: Animation Runtime And Timeline

Add:

- clip resolver;
- independent animation clocks;
- timeline inspection;
- play/pause/scrub;
- playback activation and loop-mode controls.

Do not use one global active frame for every layer.

## Phase 6: Visual Repair Workspace

Expose existing repair/correction paths visually:

- source frame view;
- normalized frame view;
- onion skin;
- debug overlay;
- frame strip;
- anchor/nudge/cut controls;
- processing recipe panel;
- before/after quality comparison.

Repair must produce new jobs and asset revisions. Do not mutate old artifacts.

## Phase 7: Project Asset Library

Support:

- characters;
- tilemaps;
- backgrounds;
- static props;
- animated props;
- effects;
- UI;
- imported sheets.

Add usage tracking and safe asset deletion/unlink behavior.

## Phase 8: Interaction And Playtest

Add only after the core editor path is stable:

- interaction zones;
- triggers;
- actions;
- runtime state;
- simple playtest controls.

### Phase 8.1: Editor Canvas Playtest MVP

**Status (2026-07-10):** Implemented and locally verified in
`89cf7b2`; merged into `main`.

Implemented scope:

- real Scene Pack tile-map and Character Pack spritesheet rendering in the
  existing Stage Canvas, with nearest-neighbor sampling and revision/artifact
  caching;
- continuous normalized WASD and arrow-key movement, directional
  `walk_*`/`idle_*` clip resolution, bounded player movement, and critically
  damped runtime camera follow;
- Basic controls for player layer, move speed, camera zoom, Start, and Stop;
- an Advanced disclosure for animation rate, moving/stopped camera response,
  camera clamp, and ephemeral defaults reset;
- Stage focus ownership, Escape/blur/visibility cleanup, one RAF loop, hidden
  edit overlays while running, and a live HUD for clip, direction, position,
  and Stop;
- blocked/loading/partial/missing-clip diagnostics, hidden-player and quality
  gate enforcement, retryable partial/error asset loads, and visible results
  for the existing Interaction runtime;
- safe Scene Link behavior: continue only through a visible target player
  layer backed by the same Character Pack; otherwise stop the playtest with an
  accessible diagnostic instead of leaving an invisible player runtime;
- runtime-only player, camera, options, diagnostics, flags, inventory, and
  layer overrides. Playtest does not write project JSON, command history,
  selection, or persistent scene camera state.

Verified locally:

- Editor tests: `88/88` passing;
- full suite: `592/592` passing;
- `npm run smoke:local` passing against a running local server;
- browser QA at `1440x900` and `390x844`: no relevant console errors or
  warnings, no horizontal overflow, real Canvas assets visible, WASD movement
  and directional animation state observed, form arrow keys isolated, Escape
  restored editing controls, and Interaction results rendered;
- `git diff --check`, syntax checks, and independent read-only code review
  passing.

Design and clean-room deviation record:

- the external WASD archives were behavior references only; no source code,
  UI, audio, or art assets were copied or imported;
- the existing Interaction controls remain in a separate collapsed section so
  a shipped capability is not hidden, and their real runtime effects are now
  visible;
- a target scene without a compatible visible player layer stops safely rather
  than synthesizing or persisting a new project layer;
- collision, physics, Y-sort, shadows, surface audio, touch controls, gamepad,
  parameter persistence, new server endpoints, schema migration, and PixiJS
  remain out of scope;
- request cancellation for in-flight image/JSON loads, device-pixel-ratio
  backing-store scaling, and cache eviction remain documented MVP residual
  risks. Token/signature guards prevent stale load results from mutating the
  active render state.

## Phase 9: Scene Flow Board

Add:

- scene cards;
- scene links;
- duplicate/copy/paste;
- validation badges;
- orphan link warnings;
- persisted board layout.

## Phase 10: Editor Project Pack v1

Export:

- `project.json`;
- validation report;
- asset references;
- scene documents;
- engine-specific payloads where supported.

Keep existing Project Pack available.

## Test Policy

Every phase:

- `git status --short`;
- `git diff --check`;
- the complete `npm test` suite, reporting the actual pass/fail count;
- stage only files for that phase;
- create one coherent commit;
- stop and report before starting the next phase.

Reports must distinguish local verification from independent GitHub status
checks. Do not claim CI passed unless a separate status check exists for the
commit.

UI phases also require:

- `npm run smoke:local`;
- manual browser verification steps.

## Commit Boundaries

Recommended sequence:

```text
docs: select editor workspace direction
feat: add editor project core
feat: add editor project persistence API
feat: add parallel editor shell
feat: add scene stage and layer transforms
feat: add editor history and keyboard workflow
feat: add independent animation runtime
feat: add timeline and clip inspection
feat: add visual repair workspace
feat: add project asset library
feat: add interaction protocol and playtest
feat: add scene flow board
feat: add editor project pack v1
```

## Unresolved Questions

- Whether `/editor` starts hidden behind a feature flag.
- First provider-free fixture set for editor smoke tests.
- Whether v0 allows asset deletion or only unlinking from scenes.
