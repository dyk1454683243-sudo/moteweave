# OCAD Generation Default And Motion Gate

## Status

Accepted on 2026-06-01.

## Context

The 20-case quality closure benchmark showed a split between generation layouts:

- `topdown_rpg_v0`, run `openrouter_bench_20260531_161925`: 3 pass, 17 fail, usable rate 0.15. Primary failures were `structure.empty_frame` and `structure.cropped`.
- `ocad_motion_v0`, run `openrouter_bench_20260531_162434`: 0 pass, 19 warning, 0 fail, 1 model error, usable rate 0.95. Primary warnings were `layout.source_region_edge_pressure` and `motion.duplicate_frames`.

The later topdown repair loop proved that selected bad topdown cells can be repaired locally, but the original 8x8 generation target still starts from a much less reliable structural baseline than OCAD.

## Decision

Use `ocad_motion_v0` as the default AI generation layout for the CLI, server generation endpoint, web UI generation control, and generic OpenRouter benchmark command.

Keep `topdown_rpg_v0` as:

- the runtime export profile after normalization,
- the default upload/manual-cut-line source layout,
- a focused compatibility path for user-provided 8x8 sheets,
- a repair fallback and prompt-regression target.

Add a report-level OpenRouter benchmark `quality_gate`:

- `structural_usability`: requires usable rate at least 0.9, zero validation fails, and zero post-processing failures.
- `motion_duplicate_frames`: warns when unexpected duplicate motion remains after OCAD fixed-region source reuse has been separated.

This makes OCAD the default structural entry path without hiding true multi-frame motion collapse.

## Follow-Up Audit

On 2026-06-02, the historical OCAD 20-case run `openrouter_bench_20260531_162434` was re-audited by reading only that run's benchmark report and item debug reports.

The 171 duplicate-frame taxonomy examples were not caused by walk/run/action frames becoming static. Every successful item had the same pattern:

```text
duplicate_group_count: 9
expected_source_reuse_count: 9
unexpected_duplicate_group_count: 0
```

The duplicate groups came from fixed OCAD source regions intentionally reused during normalization:

```text
idle: 76 groups
item: 38 groups
defence: 19 groups
death: 19 groups
sit: 19 groups
```

After separating expected OCAD source reuse, the historical run's dominant remaining taxonomy is `layout.source_region_edge_pressure`, plus the single provider model error already recorded in the original benchmark.

## Live Gate Confirmation

On 2026-06-02, the OCAD default route was rerun as a 20-case live gate:

```text
run_id: openrouter_bench_20260601_165731
preset: ocad_motion_v0
prompt_contract: character_prompt_contract_v1_4
template_file: motion_template_ocad_primary.png
image_size: 1K
pass_rate: 0
usable_rate: 1
```

Validation:

```text
pass: 0
warning: 20
fail: 0
unknown: 0
```

Quality gate:

```text
status: pass
structural_usability: pass
motion_duplicate_frames: pass
avg_duplicate_group_count: 9
avg_expected_source_reuse_count: 9
avg_unexpected_duplicate_group_count: 0
duplicate_examples: 0
```

The remaining top taxonomy is:

```text
layout.source_region_edge_pressure: 20
```

This confirms that the previous `motion.duplicate_frames` warning was mostly a reporting/modeling issue around expected fixed-region source reuse, not evidence that OCAD walk/run motion collapsed to static frames.

The attempted command included `--run-id ocad_motion_gate_v14_20case_20260602`, but the npm shortcut did not pass that option through before this change. The actual measured run id above is the timestamped runner id and is the authoritative artifact.

## Source-Region Edge Pressure Follow-Up

On 2026-06-04, the OCAD confirmation run `openrouter_bench_20260601_165731` was re-audited by reading only that run's benchmark report and item debug reports.

The stored report showed `source_region_edge_pressure_high` on all 20 items, but runtime-normalized output did not show actual crop risk:

```text
source_region_edge_pressure_high: 20 items
runtime edge_pressure_high: 0 items
frame_N_cropped blocking errors: 0 items
edge_pressure_severe_frame_count > 0: 0 items
quality_gate.status: pass
```

The old warning was caused by evaluating tight fixed source regions with 0/1 px margins and then promoting that diagnostic into validation status even when the normalized runtime frames were safe.

Decision: keep source-region pressure in `debug_report.json.validation.metrics.source_region_edge_pressure`, but only emit `source_region_edge_pressure_high` when the normalized runtime validation also reports `edge_pressure_high` or a `frame_N_cropped` blocking error. This preserves the diagnostic without turning a structurally usable OCAD sheet into a warning-only result.

Provider-free reprocess of the stored `source.png` artifacts from the same run under this rule:

```text
items: 20
pass: 20
warning: 0
fail: 0
source_region_edge_pressure_warning: 0
runtime_edge_warning: 0
cropped_blocking_items: 0
usable_rate: 1
```

## Consequences

- Existing exporters continue to receive `topdown_rpg_v0` runtime data.
- UI upload behavior remains conservative: uploaded sheets still default to the 8x8 source layout, while AI generation defaults to OCAD.
- Generic benchmarks now answer "is the default generation path healthy?" rather than "is the old 8x8 prompt healthy?"
- Duplicate-frame metrics are split into expected OCAD source reuse and unexpected duplicate motion.
- Source-region edge pressure remains a debug metric; it is no longer a validation warning unless the normalized runtime frames also show edge/crop risk.
- Topdown repair code remains useful but is no longer the main strategy for making fresh AI generations usable.

## Verification

Provider-free verification in this change:

```text
node --test test/character-pack/geminiProvider.test.js
node --test test/character-pack/openRouterBenchmark.test.js
node --test test/character-pack/cli.test.js
```

The original default-route decision did not rerun a live 20-case gate. The follow-up audit below records the live OCAD confirmation gate and the split between expected source reuse and unexpected duplicate motion.

Additional provider-free verification for the follow-up audit:

```text
node --test test/character-pack/promptContracts.test.js
node --test test/character-pack/openRouterBenchmark.test.js
node --test test/character-pack/geminiProvider.test.js test/character-pack/cli.test.js test/serverOpenRouter.test.js
```

Live provider verification for the follow-up audit:

```text
npm run benchmark:openrouter -- --sample-size 20 --variants 1 --image-size 1K --run-id ocad_motion_gate_v14_20case_20260602 --yes
```

The shortcut ignored `--run-id` before this change, so it wrote `openrouter_bench_20260601_165731`.
