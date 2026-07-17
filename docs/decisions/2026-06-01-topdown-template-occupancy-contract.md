# Topdown Template Occupancy Contract

## Context

The 20-case topdown gate `openrouter_bench_20260531_161925` produced:

```text
preset: topdown_rpg_v0
model: google/gemini-3.1-flash-image-preview
image_size: 1K
samples: 20
pass: 3
warning: 0
fail: 17
pass_rate: 0.15
usable_rate: 0.15
```

Primary taxonomy:

```text
structure.empty_frame: 8 items
structure.cropped: 9 items
```

Top blocking errors:

```text
frame_14_empty: 8
frame_15_empty: 8
frame_6_empty: 8
frame_7_empty: 8
frame_24_cropped: 7
frame_44_cropped: 3
```

## Audit

The failures were not provider errors. All 17 failed samples generated an image and then failed post-processing validation.

The empty frames clustered in fixed topdown slots:

```text
frame 6  = row 0, column 6
frame 7  = row 0, column 7
frame 14 = row 1, column 6
frame 15 = row 1, column 7
```

Representative visual audit of the specified run showed that the attached topdown structural template contains empty-looking cells and uneven occupancy in the same early row/column area. Generated sheets often copied that incompleteness, while cropped failures were mostly poses crossing cell boundaries or filling the cell edge.

## Decision

Treat this as a prompt/template contract failure before changing validation thresholds or building a broad repair system.

The first focused fix is `character_prompt_contract_v1_2`:

- Keep the topdown layout as one exact 8x8 uniform grid with 64 required cells.
- Emit an explicit row/column segment map so columns 0-3 and 4-7 are both required 4-frame animation segments.
- Tell the provider that empty-looking template slots, missing placeholder poses, wide gaps, cropped placeholder art, and uneven columns are template defects, not output permissions.
- Tell the provider not to copy empty template cells and to replace empty-looking template slots with complete character poses.

## Non-Decisions

- Do not loosen empty-frame or cropped-frame validation as part of this fix.
- Do not build a full inpainting or masked repair workflow yet.
- Do not switch the production benchmark baseline to multi-resolution output before proving topdown structural improvement.

## Verification

```text
node --test test/character-pack/promptContracts.test.js test/character-pack/geminiProvider.test.js
node --test test/character-pack/promptContracts.test.js test/character-pack/geminiProvider.test.js test/character-pack/cli.test.js test/serverOpenRouter.test.js
node --test test/character-pack/openRouterBenchmark.test.js
npm test
```

Live OpenRouter gate was not run in this checkout because `OPENROUTER_API_KEY` was not configured. No new live pass-rate or usable-rate claim is made for v1.2.

## Follow-Up

- The topdown structural template was replaced in `docs/decisions/2026-06-01-topdown-structural-template-replacement.md` so every provider-visible template cell is occupied before the next live gate.
- If 1K and 2K differ materially after v1.2, record the comparison and update benchmark defaults separately.
- If only a few frames remain broken after v1.2, prototype a minimal per-frame repair path before larger repair automation.
