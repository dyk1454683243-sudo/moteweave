# Topdown Structural Template Replacement

## Context

The `character_prompt_contract_v1_2` fix made the written topdown contract explicit, but provider image conditioning still receives `templates/motion_template_ocha_8x8.png`.

The prior topdown 20-case gate `openrouter_bench_20260531_161925` failed mostly on structural completeness:

```text
pass_rate: 0.15
usable_rate: 0.15
primary taxonomy: structure.empty_frame, structure.cropped
common empty frames: frame_6, frame_7, frame_14, frame_15
```

Local template audit showed that the old topdown structural image itself had empty or sparse slots near the same early row/column area and many placeholder poses touching cell edges. Because provider submission upscales the template with nearest-neighbor, those defects are preserved as strong visual conditioning.

## Decision

Replace `templates/motion_template_ocha_8x8.png` with an original neutral structural template that:

- Keeps the exact 256x256, 8x8, 32px-cell source template size.
- Uses pure white background to match generation background expectations.
- Occupies every one of the 64 cells with a complete placeholder pose.
- Keeps all placeholder silhouettes padded away from cell edges.
- Uses neutral grayscale placeholder art and no product/competitor branding or third-party assets.
- Avoids explicit grid lines, labels, frame numbers, props, scenery, or UI that providers might copy into generated sheets.

Add `scripts/create-topdown-structural-template.mjs` so the source asset can be regenerated from original local code instead of being an opaque hand-edited binary.

## Verification

The new template quality gate is covered by `test/character-pack/templateStore.test.js`.

Offline template audit after replacement:

```text
width: 256
height: 256
min foreground pixels per cell: 234
max foreground pixels per cell: 400
edge-touching cells: 0
```

Commands:

```text
node scripts/create-topdown-structural-template.mjs
node --test test/character-pack/templateStore.test.js
node --test test/character-pack/cli.test.js test/character-pack/openRouterBenchmark.test.js test/character-pack/topdownQualityClosureGate.test.js
npm run benchmark:topdown-quality -- --dry-run-plan --run-id npm_topdown_quality_check --case-id blue_wizard --case-id frog_knight --image-size 1K --image-size 2K
```

Live OpenRouter verification was not run for this replacement because neither `OPENROUTER_API_KEY` nor `GEMINI_API_KEY` is configured in this checkout.

## Gate Runner

The follow-up live workflow is now encoded in `npm run benchmark:topdown-quality`.

The runner defaults to the high-risk case matrix:

```text
blue_wizard
frog_knight
silver_swordswoman
desert_merchant
thunder_drummer
```

It runs the same cases at both `1K` and `2K` and writes an aggregate `quality_closure_report.json` plus child benchmark reports. Use `--dry-run-plan` to inspect the exact run plan without spending provider quota.

## Repair Planning Prototype

The follow-up local repair planning layer is encoded in:

```text
npm run character-pack -- benchmark topdown-repair-plan --report <benchmark_report.json>
```

It does not edit images. It maps `frame_<n>_empty` and `frame_<n>_cropped` validation messages to:

- row and column
- runtime animation
- frame index inside that animation
- single-cell repair scope
- strategy hint: `regenerate_missing_pose_in_cell` or `regenerate_pose_with_more_padding`

Applied to the historical failed run `openrouter_bench_20260531_161925`, the repair planner reports:

```text
items: 20
items_with_repairs: 17
repair issues: 78
empty_frame: 33
cropped_frame: 45
top repair frames: frame_6=8, frame_7=8, frame_14=8, frame_15=8, frame_24=7, frame_44=3
```

## Repair Manifest Prototype

The next local repair prototype is encoded in:

```text
npm run character-pack -- benchmark topdown-repair-manifest --report <benchmark_report.json>
```

It still does not call providers or edit image files. It converts each topdown repair-plan issue into a single-cell task with:

- target frame, row, column, animation, frame-in-animation, and normalized-sheet rectangle
- feet-center anchor and same-animation reference frames
- item artifact paths for `source.png`, `normalized_sheet.png`, `debug_report.json`, and `prompt.txt`
- a provider payload with a focused 96x96 repaired-cell prompt
- post-repair validation expectation: paste into the target rectangle, then rerun character-pack validation and Row GIF previews

Use `--summary-only` for trend checks without printing all task payloads.

Applied to `openrouter_bench_20260531_161925`, the manifest summary is:

```text
tasks: 78
items: 17
regenerate_missing_pose_in_cell: 33
regenerate_pose_with_more_padding: 45
empty_frame: 33
cropped_frame: 45
top frames: frame_6=8, frame_7=8, frame_14=8, frame_15=8, frame_24=7, frame_44=3
top actions: idle_up=18, idle_right=18, walk_left=8, attack_right=7
```

This confirms that the remaining local repair path should start with single-cell replacement tasks, not a broad full-sheet inpainting system.

## Required Live Follow-Up

When provider credentials are available:

1. The small replacement-template topdown gate was run as `topdown_quality_live_2case_20260601`; it stayed 0 usable and shifted the dominant failure to horizontal `attack_left` / `attack_right` cropping.
2. The focused follow-up is recorded in `docs/decisions/2026-06-01-topdown-horizontal-attack-cropping.md`.
3. Do not run the full 20-case `topdown_rpg_v0` gate until a focused prompt or single-cell repair path clears the small gate.
4. Use the repair manifest output as the input contract for the minimal per-frame repair path.
