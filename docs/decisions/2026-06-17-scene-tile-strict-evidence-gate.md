# Scene Tile Strict Evidence Gate

**Date:** 2026-06-17  
**Status:** Recorded; live quality sample blocked by provider access  

## Context

After bounded multi-candidate scene tile generation shipped, the next intended
step was to run a strict live gate and use real candidate evidence to decide
whether scene/tile work should move toward LDtk auto-layer rules, WFC/rule
arrangement expansion, or another raw-quality pass.

This decision records the evidence gathered for that gate. It does not make a
scene tile quality claim because no provider route returned an image.

## Planned Gate

Dry-run plan:

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --dry-run-plan \
  --run-id strict_scene_tile_gate_20260617_01 \
  --sample-size 5 \
  --candidate-count 4 \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --raw-tile-policy strict
```

Plan output:

- Plan file: `generated/scene-tile-live-gates/strict_scene_tile_gate_20260617_01/live_gate_plan.json`
- Cases: `5`
- Candidates per case: `4`
- Estimated provider calls: `20`
- Gate policy: `raw_tile_quality: strict`
- Image config: `1K`, `1:1`
- Correction path: `style:palette_snap + edge:edge-aware-v1`

The planned cases were:

- `mossy_forest_ground`
- `dry_cliff_path`
- `snowy_ruins_floor`
- `wet_cave_floor`
- `village_dirt_road`

## Live Attempts

These attempts were run before the scene live budget guard was added.
Equivalent reruns now require `--max-provider-calls`.

### Default Preset: `gemini31`

Command shape:

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --yes \
  --run-id strict_scene_tile_gate_20260617_01 \
  --sample-size 5 \
  --candidate-count 4 \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --raw-tile-policy strict
```

Result:

- Provider: OpenRouter
- Model: `google/gemini-3.1-flash-image-preview`
- Artifacts: none beyond the dry-run plan
- Failure class: provider route/TOS block before image generation

### Native Preset: `gemini-native`

Smoke command:

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --yes \
  --run-id strict_scene_tile_gate_20260617_native_smoke \
  --sample-size 1 \
  --candidate-count 1 \
  --provider-preset gemini-native \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --raw-tile-policy strict
```

Result:

- Provider: Gemini API
- Model: `gemini-3.1-flash-image-preview`
- Artifacts: none
- Failure class: provider quota block before image generation
- Observed quota message: free-tier `generate_content` limits were `0`

### OpenRouter Preset: `gemini25`

Smoke command:

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --yes \
  --run-id strict_scene_tile_gate_20260617_gemini25_smoke \
  --sample-size 1 \
  --candidate-count 1 \
  --provider-preset gemini25 \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --raw-tile-policy strict
```

Result:

- Provider: OpenRouter
- Model: `google/gemini-2.5-flash-image`
- Artifacts: none
- Failure class: provider route/TOS block before image generation

## Evidence Review

The strict live gate could not produce selected scene tile candidates. Therefore:

- Selected candidate pass/warning/fail distribution: unavailable.
- Failed candidate taxonomy from tile quality gates: unavailable.
- Duplicate referenced runtime tile signal: unavailable.
- Source-atlas continuity signal: unavailable.
- Visual seam/self-loop signal: unavailable.
- Style snap and edge-conditioning effect: unavailable for this gate.

The only supported conclusion is provider-access readiness:

- The configured OpenRouter routes are currently blocked for these image
  requests before any tile image is returned.
- The native Gemini route is configured but has no usable quota for this model
  in the current account state.
- Scene tile quality remains unproven for the 5-case, 4-candidate strict gate.

## Manual External Gemini Image Review

After the provider-access blocker was recorded, five scene tile images were
generated outside the unified adapter and placed under the local Gemini scratch
directory:

```text
<home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/dual_grid_mossy_forest_1781633376132.png
<home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/dual_grid_dry_rocky_1781633385302.png
<home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/dual_grid_snowy_ruins_1781633393172.png
<home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/dual_grid_wet_cave_1781633402758.png
<home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/dual_grid_village_dirt_1781633415192.png
```

They were 1024x1024 JPEG-encoded images with `.png` names, so they were resized
to 192x192 PNG files under `/tmp/scene-tile-gemini-sheets/` and ingested through
the provider-free scene tile path with:

```bash
npm run character-pack -- scene tile-ingest \
  --input /tmp/scene-tile-gemini-sheets/<case>_192.png \
  --output-dir generated/cli \
  --job-id scene_tile_gemini_<case>_strict_20260617 \
  --identifier gemini_<case> \
  --width 3 \
  --height 3 \
  --pattern rule \
  --seed <7-11> \
  --density 0.55 \
  --raw-tile-policy strict \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1
```

Aggregated report:

- Report: `generated/scene-tile-reports/gemini_manual_scene_tile_strict_20260617/scene_tile_report.json`
- Correction dependency report:
  `generated/scene-tile-reports/gemini_manual_scene_tile_correction_dependency_20260617/scene_tile_report.json`
- Raw/style/edge matrix:
  `generated/scene-tile-correction-matrix/gemini_manual_scene_tile_raw_style_edge_matrix_20260617/scene_tile_correction_matrix.json`
- Sample size: `5`
- Selected candidate distribution: unavailable; this was one manual image per
  case, not a multi-candidate live gate.
- Strict quality status: `5 / 5` pass.
- `visual_seams`: `5 / 5` pass.
- `tile_self_loops`: `5 / 5` pass.
- `tile_distinctness`: `5 / 5` pass, `0` duplicate referenced runtime pairs.
- `source_atlas_structure`: `5 / 5` pass, `0` continuous source-cell
  boundaries.
- Failure taxonomy: none.
- Correction path: `style:palette_snap+edge:edge_aware_conditioning_v1` for all
  five cases.
- Correction dependency: `high`.
- Style snap changed-pixel ratio: average `0.9952`, range `0.9917-0.9983`.
- Edge-conditioning changed-pixel ratio: average `0.0971`, range
  `0.0118-0.1211`.
- Edge-conditioning visible mutation warnings: `4 / 5`.
- Correction dependency signals:
  `all_items_use_correction`, `style_snap_heavy_mutation`, and
  `edge_conditioning_visible_mutation`.
- Matrix result across `15` provider-free variant artifacts:
  - `raw`: `0 / 5` pass.
  - `style_snap`: `1 / 5` pass.
  - `style_snap_edge_aware`: `5 / 5` pass.
  - `raw -> style_snap`: `1` improved, `4` same, `0` regressed.
  - `style_snap -> style_snap_edge_aware`: `4` improved, `1` same, `0`
    regressed.
- Raw readiness: `not_ready`.
- Raw readiness blockers: `raw_variant_failures`,
  `raw_source_atlas_continuity`, `raw_visual_seam_failures`,
  `raw_self_loop_failures`, `correction_masks_visual_seams`, and
  `correction_masks_self_loops`.
- Raw matrix blockers:
  - `tile.source_atlas_continuity`: `5 / 5`.
  - `tile.self_loop_mismatch`: `4 / 5`.
  - `tile.visual_seam_mismatch`: `4 / 5`.
- Gate transition detail:
  - `raw -> style_snap`: `source_atlas_structure` improved `5 / 5`, but
    `visual_seams` and `tile_self_loops` stayed blocked in `4 / 5`.
  - `style_snap -> style_snap_edge_aware`: `visual_seams` and
    `tile_self_loops` improved `4 / 5`.

Quality boundary:

- This is useful external-manual scene evidence and proves the local strict
  ingest/report path can evaluate the five planned scene themes without using
  in-app provider quota.
- It is not the original `5 x 4` live gate: there is no candidate-selection
  distribution, no failed-candidate taxonomy, and no unified provider adapter
  metadata.
- Style snapping was heavy (`changed_pixel_ratio` about `0.9917-0.9983`), and
  `4 / 5` tile-conditioning reviews warned about visible edge-conditioning
  mutation. Treat the pass as corrected structural gate evidence, not proof
  that raw provider output is production-ready.
- The next local scene-quality block should make this dependency measurable on
  every report before changing arrangement/export scope.
- The matrix makes the next block sharper: raw generation must reduce visual
  seam, self-loop, and source-atlas continuity failures before WFC or LDtk
  auto-layer work can make a product-quality claim.
- Raw-output quality execution plan:
  `docs/superpowers/plans/2026-06-17-scene-tile-raw-output-quality-pass.md`.

## Raw Quality Closure v0.5 Gate

- Prompt pack:
  `generated/scene-tile-manual-prompts/gemini_manual_scene_tile_prompt_v05_20260617/manual_prompt_pack.json`
- Prompt contract: `scene_tile_prompt_contract_v0_5`.
- Re-test image status: five external Gemini images were supplied under
  `/tmp/scene-tile-gemini-v05-sheets/`, but the files were JPEG-encoded
  `1024x1024` images with `.png` names instead of contract-compliant
  `192x192` PNG tile sheets.
- Original-input retest:
  `benchmark scene-tile-manual-retest` rejected the supplied files with
  `Cannot ingest invalid tile sheet: source_sheet_size_mismatch`.
- Normalized diagnostic retest:
  the supplied sheets were copied to
  `/tmp/scene-tile-gemini-v05-sheets-normalized/` as `192x192` PNG files and
  run through the same provider-free helper for exploratory diagnostics.
- Normalized matrix:
  `generated/scene-tile-correction-matrix/gemini_manual_scene_tile_v05_raw_quality_20260617_normalized/scene_tile_correction_matrix.json`.
- Normalized `raw_quality_readiness.status`: `not_ready`.
- Normalized raw validation: `0` pass, `0` warning, `5` fail.
- Normalized raw diagnostics:
  - `visual_seam_failures`: `41`.
  - `self_loop_failures`: `98`.
  - `source_atlas_continuities`: `33`.
  - `duplicate_runtime_tile_pairs`: `0`.
- Normalized raw readiness blockers: `raw_variant_failures`,
  `raw_source_atlas_continuity`, `raw_visual_seam_failures`,
  `raw_self_loop_failures`, `correction_masks_visual_seams`, and
  `correction_masks_self_loops`.
- Expected input files:
  `mossy_forest_ground_192.png`, `dry_cliff_path_192.png`,
  `snowy_ruins_floor_192.png`, `wet_cave_floor_192.png`, and
  `village_dirt_road_192.png`.
- Decision: WFC and LDtk auto-layer expansion remain gated until the v0.5
  manual matrix or a live `5 x 4` gate shows `raw_quality_readiness.status` is
  `ready`. The normalized run is useful for diagnosing output structure, but it
  does not count as a clean raw contract pass because the original files failed
  the source sheet format and size contract.

## Prompt And Handoff Hardening v0.6

The v0.5 failure was not treated as a user misunderstanding. It exposed two
separate failure classes:

- Source-sheet delivery contract failure: the external model returned
  JPEG-encoded `1024x1024` files with `.png` names.
- Raw tile structure failure: after normalization, the sheet still had visual
  seam, self-loop, and source-atlas continuity issues.

The follow-up hardening upgrades the active prompt contract to
`scene_tile_prompt_contract_v0_6`:

- The provider-facing prompt no longer includes a visible `Mask placement:
  mask 0: row ...` coordinate list. Mask order stays in metadata, but those
  row/column details are not shown to the image model because they can invite
  labels or coordinate artifacts.
- The prompt now explicitly requires a true `192x192` PNG and rejects preview
  scale, `1024x1024`, `1K`, and JPEG data saved with a `.png` filename.
- `benchmark scene-tile-manual-prompts` writes `manual_handoff.md` beside the
  prompt pack so the external save/export step is separate from the image
  prompt itself.
- `benchmark scene-tile-manual-retest` now preflights present files and returns
  `invalid_inputs` with `actual_format`, `actual_size`, and blocking errors
  before running the matrix when a file exists but fails the image contract.

The next manual re-test should use `/tmp/scene-tile-gemini-v06-sheets/` and a
v0.6 run id. WFC and LDtk auto-layer expansion remain gated until a
contract-compliant v0.6 manual matrix or a live `5 x 4` gate reaches raw
readiness.

## Implementation Follow-Up

The failed run exposed a quota-safety gap: `scene tile-generate` and
`benchmark scene-tile-live-gate` had `--yes` guards, but did not require an
explicit provider-call cap like the text-to-image benchmark path.

The CLI now requires `--max-provider-calls` for both scene tile live generation
and scene tile live gates, and the scene tile candidate loop consumes the shared
provider-call budget once per candidate request.

Live gate failures before image generation now write:

```text
live_gate_plan.json
live_gate_blocker.json
live_gate_review.json
live_gate_review.md
```

The blocked review records that selected candidate distribution, failed
candidate taxonomy, duplicate/source-atlas/seam/self-loop signals, and
style-snap/edge-conditioning effects are unavailable when no image is returned.
It also records that LDtk auto-layer and WFC/rule-arrangement expansion are not
decision-ready from the blocked run.

Confirmed blocker artifact:

- Run id: `strict_scene_tile_gate_20260617_native_smoke_budgeted_v2`
- File: `generated/scene-tile-live-gates/strict_scene_tile_gate_20260617_native_smoke_budgeted_v2/live_gate_blocker.json`
- Mode: `scene_tile_live_gate_blocker_v0`
- Blocker category: `provider_quota_blocked`
- Provider call budget: `1 / 1` used

## Decision

Do not proceed to WFC or LDtk auto-layer rules based on the blocked live gate or
the manual external image review.

The manual external Gemini branch is now part of this goal's evidence review:
it is enough to continue planning and local quality work, but it is not enough
to claim live multi-candidate readiness. The next executable scene/tile block
should reduce correction dependency by comparing raw, style-snapped, and
edge-conditioned outputs and tightening the prompt/gate/correction boundary.

The original live-gate action remains: unblock a provider route that can return
scene tile images under explicit budget caps, then follow
`docs/runbooks/scene-tile-strict-gate-readiness.md` and rerun:

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --yes \
  --max-provider-calls 20 \
  --run-id strict_scene_tile_gate_20260617_01 \
  --sample-size 5 \
  --candidate-count 4 \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --raw-tile-policy strict
```

Only after that rerun produces per-case candidate artifacts should the project
decide between:

- LDtk auto-layer rules, if selected candidates pass strict raw quality
  reliably.
- WFC/rule arrangement expansion, if raw tile quality is acceptable and map
  structure is the main gap.
- Another raw tile structure pass, if duplicate tiles, source-atlas continuity,
  visual seams, or self-loop failures dominate.

## Verification

```bash
node --test test/scene-pack/tileGenerate.test.js test/character-pack/cli.test.js
npm test
```
