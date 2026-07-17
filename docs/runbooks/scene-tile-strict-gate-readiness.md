# Scene Tile Strict Gate Readiness Runbook

**Status:** Draft for the next live scene/tile API window  
**Scope:** Scene tile strict live gates only. No WFC, LDtk auto-layer rules, or
map-editor work.

Use this runbook after provider credentials, route availability, or native quota
changes. The goal is to rerun the 5-case, 4-candidate strict scene tile gate
without spending broad provider budget blindly, and to avoid treating
provider-access blockers as tile-quality evidence.

## Current State

- Scene tile generation uses server-side provider presets; browser code never
  receives provider keys.
- `benchmark scene-tile-live-gate` requires `--yes` and
  `--max-provider-calls`.
- Each scene tile candidate consumes one provider request.
- The selected candidate is routed through tile ingestion, strict raw tile
  policy, style snap, optional edge conditioning, LDtk export, and scene pack
  artifact writing.
- Provider failures before image generation write:
  - `live_gate_plan.json`
  - `live_gate_blocker.json`
  - `live_gate_review.json`
  - `live_gate_review.md`
- A blocked review is a provider-access record only. It is not scene tile
  quality evidence.

## Provider Route Matrix

| Route | Provider family | First check | Known blocker class | Next action |
|---|---|---|---|---|
| `gemini31` | `openrouter` | 1-case, 1-candidate scene tile smoke | `provider_route_blocked` when TOS/policy blocks image generation | Switch route or wait for route availability change. |
| `gemini25` | `openrouter` | 1-case, 1-candidate scene tile smoke | `provider_route_blocked` when TOS/policy blocks image generation | Switch route or wait for route availability change. |
| `gemini-native` | `gemini` | 1-case, 1-candidate scene tile smoke | `provider_quota_blocked` when native quota is 0 | Add usable quota or switch native model/preset. |

Keep real keys in `.env` only. Do not commit `.env`.

## Step 1: Provider-Free Plan Check

Run this first. It spends no provider calls and writes the intended sample
shape plus sanitized provider config.

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --dry-run-plan \
  --run-id strict_scene_tile_gate_next_plan \
  --sample-size 5 \
  --candidate-count 4 \
  --provider-preset <preset-id> \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --raw-tile-policy strict
```

Expected dry-run shape:

- `case_ids`: `mossy_forest_ground`, `dry_cliff_path`,
  `snowy_ruins_floor`, `wet_cave_floor`, `village_dirt_road`
- `candidate_count`: `4`
- `estimated_provider_calls`: `20`
- `gate_policy.raw_tile_quality`: `strict`
- `provider_config.selected_available`: `true`
- No API key values in stdout or `live_gate_plan.json`.

Stop if the selected provider is unavailable or the plan does not estimate 20
provider calls.

## Optional: Manual External Prompt Pack

When the unified provider route is blocked but an external model session can
still generate images, create the same five-case prompt pack without spending
provider quota:

```bash
npm run character-pack -- benchmark scene-tile-manual-prompts \
  --output-dir generated/scene-tile-manual-prompts \
  --run-id gemini_manual_scene_tile_prompt_v06_20260617 \
  --input-dir /tmp/scene-tile-gemini-v06-sheets \
  --sample-size 5
```

Use each generated `prompt.txt` in the external model. Use
`manual_handoff.md` as the save/export checklist. Save returned images as true
`192x192` PNG files using the `expected_input_file` values from
`manual_prompt_pack.json`, for example:

```text
/tmp/scene-tile-gemini-v06-sheets/mossy_forest_ground_192.png
/tmp/scene-tile-gemini-v06-sheets/dry_cliff_path_192.png
/tmp/scene-tile-gemini-v06-sheets/snowy_ruins_floor_192.png
/tmp/scene-tile-gemini-v06-sheets/wet_cave_floor_192.png
/tmp/scene-tile-gemini-v06-sheets/village_dirt_road_192.png
```

Then run the provider-free correction matrix on those explicit files. Manual
external evidence can guide raw-quality work, but it does not replace the live
`5 x 4` gate because it has no unified provider metadata or candidate-selection
distribution.

The shortest readiness check is:

```bash
npm run character-pack -- benchmark scene-tile-manual-retest \
  --input-dir /tmp/scene-tile-gemini-v06-sheets \
  --output-dir generated/scene-tile-correction-matrix \
  --run-id gemini_manual_scene_tile_v06_raw_quality_20260617 \
  --sample-size 5
```

Use its `missing_inputs` list to see which images still need to be generated.
Use its `invalid_inputs` list to catch files that exist but fail the true PNG
or `192x192` source-sheet contract. When both lists are empty, the same command
runs the correction matrix and reports `raw_quality_readiness`.

If the external model returns a larger image or a JPEG-encoded file with a
`.png` name, treat that as a source-sheet contract failure. The helper should
return `invalid_inputs` with `source_sheet_format_mismatch` and/or
`source_sheet_size_mismatch`. A separately normalized copy may be used for
exploratory diagnostics, but it must not be counted as a clean raw contract
pass.

## Step 2: One-Call Route Smoke

Use an explicit provider preset. This should spend at most one provider call.

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --yes \
  --max-provider-calls 1 \
  --run-id strict_scene_tile_gate_<preset-id>_1case_smoke \
  --sample-size 1 \
  --candidate-count 1 \
  --provider-preset <preset-id> \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --raw-tile-policy strict
```

Interpretation:

- If `live_gate_blocker.json` and `live_gate_review.json` are written, the
  provider route is still blocked before image generation. Stop and switch
  provider or fix quota.
- If `scene_tile_report.json` is written, inspect the selected candidate status,
  gate policy, correction paths, and failed-candidate taxonomy before increasing
  sample size.
- Do not proceed to the 5-case gate from a smoke whose selected candidate fails
  strict raw quality.

## Step 3: Full 5-Case Strict Gate

Run only after a one-call smoke returns a scene tile image and produces a
reviewable scene report.

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --yes \
  --max-provider-calls 20 \
  --run-id strict_scene_tile_gate_next_5x4 \
  --sample-size 5 \
  --candidate-count 4 \
  --provider-preset <preset-id> \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --style-snap \
  --style-max-colors 16 \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1 \
  --raw-tile-policy strict
```

Successful output must include:

```text
live_gate_plan.json
scene_tile_report.json
scene_tile_report.md
items/<case_id>_v1/candidate_selection.json
items/<case_id>_v1/quality_gate.json
items/<case_id>_v1/candidates/candidate_XX/generation.json
```

## Decision Criteria

Proceed only from real scene tile image evidence:

- LDtk auto-layer rules may be considered only if selected candidates pass
  strict raw quality reliably and duplicate/source-atlas/seam/self-loop signals
  are not the dominant issue.
- WFC or rule arrangement expansion may be considered only if raw tile quality
  is acceptable and map structure becomes the main gap.
- Another raw tile structure pass is the right next block if duplicate runtime
  tiles, source-atlas continuity, visual seams, or self-loop failures dominate.
- Provider blockers do not support any WFC or LDtk auto-layer decision.

## Verification

Run after code or protocol changes that affect this path:

```bash
node --test test/scene-pack/tileGenerate.test.js
node --test test/scene-pack/sceneTileLiveGate.test.js
node --test test/scene-pack/sceneTileReport.test.js
node --test test/character-pack/cli.test.js
npm test
```
