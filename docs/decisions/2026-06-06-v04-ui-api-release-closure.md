# v0.4 UI/API Release Closure

**Date:** 2026-06-06
**Status:** Recorded

## Context

v0.4 scene and project-pack capabilities were available through domain modules
and CLI, but the browser flow was incomplete. Users could process character and
scene packs, yet could not combine them into a project pack from the UI, and the
scene preview controls did not expose the new rule-based arrangement or local
style/edge correction options.

## Change

Closed the v0.4 release surface by wiring:

- `POST /api/project-pack` for combining generated character and scene job ids,
- a browser Project Pack tab with current-result sync and download links,
- scene tile UI controls for `rule` seed/density,
- scene tile UI controls for optional palette snap and edge conditioning,
- smoke coverage for character + scene + project pack local API flow.

## Decision

Keep this closure work local-first. Browser controls call local API endpoints
and generated artifact URLs; the project still does not introduce remote storage,
accounts, or a hosted backend.

## Live Gate Evidence

The release closure live gate uses the same scene generation path that the UI and
CLI now expose: provider output, palette snap, edge-aware conditioning, tile
ingestion, quality gate, LDtk export, and scene pack ZIP writing.

Run:

```bash
npm run character-pack -- scene tile-generate \
  --description "mossy forest ground dual-grid tiles, reusable topdown terrain, no characters" \
  --output-dir generated/cli \
  --job-id v04_scene_live_gate_20260606_01 \
  --identifier v04_scene_live_gate_01 \
  --width 3 \
  --height 3 \
  --pattern rule \
  --seed 7 \
  --density 0.55 \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --image-size 2K \
  --aspect-ratio 1:1 \
  --yes
```

Result:

| Run id | Status | Pass rate | Usable rate | Top taxonomy | Notes |
|---|---:|---:|---:|---|---|
| `v04_scene_live_gate_20260606_01` | `pass` | `1 / 1` | `1.00` | none | No blocking errors or warnings. |

Gate details from `quality_gate.json`:

- `metadata_seams`: pass, `0 / 12` edge mismatches.
- `visual_seams`: pass, `0 / 12` failed pairs, max edge delta `0`.
- `tile_self_loops`: pass, `0 / 32` failed axes, max edge delta `0`.
- `tile_distinctness`: pass, `0 / 21` duplicate pairs across `7` referenced
  runtime tiles.
- `source_atlas_structure`: pass, `0 / 24` continuous source-cell boundaries.
- `style_drift`: not run because palette correction is attached as
  `style_correction.json`.

Correction artifacts:

- `style_correction.json`: palette snap to `16` colors, off-palette ratio
  `0.9222 -> 0`, changed pixel ratio `0.9222`.
- `edge_conditioning.json`: `edge_aware_conditioning_v1`, band `3`, applied
  edge depth `1`, changed pixel ratio `0.0483`.
- `tile_conditioning_review.json`: pass, no warnings.

This improves the prior live-smoke state, where raw generated tile sheets failed
seam and self-loop checks. It is still a one-case release smoke, not a broad
quality benchmark or a claim that all scene prompts are production-ready.

## Verification

```bash
node --test test/project-pack/projectPack.test.js test/character-pack/cli.test.js test/localSmokeScript.test.js test/scene-pack/scenePreview.test.js test/scene-pack/tileSheetIngestion.test.js test/scene-pack/tileEdgeConditioning.test.js
npm test
```
