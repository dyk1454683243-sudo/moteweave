# Generation Quality Closure Benchmark Gate

## Runs

- `openrouter_bench_20260531_120022`: preset `topdown_rpg_v0`, samples `1`, variants `1`, result `pass`.
- `openrouter_bench_20260531_115958`: preset `ocad_motion_v0`, samples `1`, variants `1`, result `warning`.
- `openrouter_bench_20260531_161925`: preset `topdown_rpg_v0`, samples `20`, variants `1`, result `pass=3 warning=0 fail=17`.
- `openrouter_bench_20260531_162434`: preset `ocad_motion_v0`, samples `20`, variants `1`, result `pass=0 warning=19 fail=0 unknown=1`.
- `openrouter_bench_20260601_165731`: preset `ocad_motion_v0`, samples `20`, variants `1`, result `pass=0 warning=20 fail=0 unknown=0`, follow-up gate `quality_gate.status=pass`.

The first four listed runs used `character_prompt_contract_v1_1`. The follow-up OCAD run used `character_prompt_contract_v1_4`.

The two 20-case runs were executed on 2026-06-01 local time; run ids use the benchmark runner timestamp format.

## Observations

- Topdown final gate passed with no blocking errors, no warnings, 16 Row GIF previews, and no failure taxonomy categories.
- OCAD final gate was initially usable with `validation.status = warning`, 21 Row GIF previews, and primary taxonomy `layout.source_region_edge_pressure`.
- OCAD warning categories were initially `layout.source_region_edge_pressure` and `motion.duplicate_frames`; follow-up audits reclassified expected source reuse and source-region edge pressure as diagnostics when normalized runtime frames are safe.
- Benchmark markdown includes the `Failure Taxonomy` section for both final runs.
- Local gallery rendered taxonomy badges for the OCAD warning run and showed the expected OCAD Row GIF preview protocol.

## 20-Case Gate Results

### topdown_rpg_v0

```text
run_id: openrouter_bench_20260531_161925
model: google/gemini-3.1-flash-image-preview
image_size: 1K
aspect_ratio: 1:1
template_file: motion_template_ocha_8x8.png
row_gif_count: 16
pass_rate: 0.15
usable_rate: 0.15
```

Validation:

```text
pass: 3
warning: 0
fail: 17
unknown: 0
```

Primary failure taxonomy:

```text
structure.empty_frame: 8 items
structure.cropped: 9 items
```

Top categories:

```text
structure.cropped: 45 examples
structure.empty_frame: 33 examples
pipeline.post_processing: 17 examples
motion.duplicate_frames: 8 examples
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

Representative artifacts:

```text
generated/openrouter-benchmarks/openrouter_bench_20260531_161925/items/blue_wizard_v1/
generated/openrouter-benchmarks/openrouter_bench_20260531_161925/items/silver_swordswoman_v1/
generated/openrouter-benchmarks/openrouter_bench_20260531_161925/items/forest_ranger_v1/
```

### ocad_motion_v0

```text
run_id: openrouter_bench_20260531_162434
model: google/gemini-3.1-flash-image-preview
image_size: 1K
aspect_ratio: 1:1
template_file: motion_template_ocad_primary.png
row_gif_count: 21
pass_rate: 0
usable_rate: 0.95
```

Validation:

```text
pass: 0
warning: 19
fail: 0
unknown: 1
```

Primary failure taxonomy:

```text
layout.source_region_edge_pressure: 19 items
provider.model_error: 1 item
```

Top categories:

```text
motion.duplicate_frames: 171 examples
layout.source_region_edge_pressure: 19 examples
provider.model_error: 1 example
```

Follow-up audit on 2026-06-02 found that the 171 duplicate-frame examples were expected OCAD fixed-region source reuse during normalization, not true walk/run motion collapse. With that split applied, `motion.duplicate_frames` was removed from the dominant OCAD taxonomy.

Follow-up audit on 2026-06-04 found that `layout.source_region_edge_pressure` was also a diagnostic false-positive for the OCAD gate when normalized runtime frames had no `edge_pressure_high` warning and no `frame_N_cropped` blocking errors. Source-region edge pressure remains recorded in debug metrics, but it no longer changes validation status unless runtime edge/crop risk is present.

Top warning:

```text
source_region_edge_pressure_high: 19
```

Representative artifacts:

```text
generated/openrouter-benchmarks/openrouter_bench_20260531_162434/items/blue_wizard_v1/
generated/openrouter-benchmarks/openrouter_bench_20260531_162434/items/silver_swordswoman_v1/
generated/openrouter-benchmarks/openrouter_bench_20260531_162434/items/forest_ranger_v1/
```

## Decision

Do not proceed to multi-resolution output as the next quality investment before resolving the generation-quality blocker.

The 20-case gate shows that the primary 8x8 generation path is not stable enough: most failures are structural completeness failures, especially empty and cropped frames. This points to layout control and frame repair rather than export polish.

Priority order after this gate:

1. Use OCAD as the default AI generation entry while keeping topdown as the runtime/export profile.
2. Separate expected OCAD source-region reuse from true duplicate-motion debt before changing prompts or validators.
3. Treat `layout.source_region_edge_pressure` as diagnostic unless normalized runtime frames also show edge/crop risk.
4. Keep topdown repair as a fallback for user-provided 8x8 sheets and focused compatibility work, not the main fresh-generation path.
5. Use provider/model comparison only after the current prompt/template contract has a stronger topdown baseline.

Follow-up decision: `docs/decisions/2026-06-01-ocad-generation-default-and-motion-gate.md`.

Follow-up output decision: after the OCAD default route reached usable structural status and source-region pressure was reclassified as diagnostic, multi-resolution output moved into v0.3 output polish rather than generation-quality work. See `docs/decisions/2026-06-04-v03-output-polish-multiresolution.md`.

## Gate Bug Caught

An earlier OCAD gate run exposed that the OpenRouter benchmark passed the OCAD template into generation but did not pass `sourceLayout: ocad_motion_v0` into post-processing. That caused OCAD artifacts to be interpreted as the default 8x8 layout.

The benchmark runner now passes the selected preset or returned prompt-contract layout id into `processSheetBuffer()`. A focused regression test covers this path.

## Verification

```text
npm test
node --test test/character-pack/openRouterBenchmark.test.js
npm run benchmark:openrouter -- --sample-size 1 --variants 1 --image-size 1K --preset topdown_rpg_v0 --yes
npm run benchmark:openrouter -- --sample-size 1 --variants 1 --image-size 1K --preset ocad_motion_v0 --yes
npm run character-pack -- benchmark openrouter --sample-size 20 --variants 1 --image-size 1K --preset topdown_rpg_v0 --yes
npm run character-pack -- benchmark openrouter --sample-size 20 --variants 1 --image-size 1K --preset ocad_motion_v0 --yes
Playwright local gallery check at http://localhost:4173/
```

## Follow-Up

- Add a focused topdown quality plan for empty/cropped frames.
- Compare whether higher generation size, stricter template image handling, or provider prompt changes reduce `structure.empty_frame` and `structure.cropped`.
- Prototype local per-frame repair before investing in broad scene or multi-resolution output.
- For OCAD, inspect source-region pressure visually before adding automatic repair; the 20-case gate is usable and source-region pressure is now debug-only unless runtime validation also sees edge/crop risk.
- Use `openrouter_bench_20260601_165731` as the follow-up OCAD confirmation gate: `quality_gate.status=pass`, average expected source reuse `9`, average unexpected duplicate groups `0`, provider-free reprocess after source-region reclassification `pass=20 warning=0 fail=0`.
