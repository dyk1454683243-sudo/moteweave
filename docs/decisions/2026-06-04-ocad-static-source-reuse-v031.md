# OCAD Static Source Reuse Boundary

## Status

Accepted on 2026-06-04.

## Context

After closing v0.3, the next quality question was whether `ocad_motion_v0` still had a real `motion.duplicate_frames` blocker.

The follow-up OCAD confirmation run was read directly:

```text
run_id: openrouter_bench_20260601_165731
preset: ocad_motion_v0
prompt_contract: character_prompt_contract_v1_4
sample_count: 20
usable_rate: 1
quality_gate.status: pass
avg_duplicate_group_count: 9
avg_expected_source_reuse_count: 9
avg_unexpected_duplicate_group_count: 0
```

A representative item, `blue_wizard_v1`, showed that all duplicate groups came from the same fixed source region being reused during normalization:

```text
idledown -> idle_down frames 0-3
idleup -> idle_up frames 4-7
idleL -> idle_left frames 8-11 and flipped idle_right frames 12-15
item0/item1 -> attack_down/talk/happy compatibility slots
defence/die -> hurt compatibility slots
sitdown -> sit frames 56-59
```

No audited group showed two different numbered walk/run/climb/attract/jump source regions collapsing into one identical frame hash.

## Decision

Treat OCAD single-region static reuse as a layout boundary, not as motion debt.

For v0.3.1 work:

- Keep `ocad_motion_v0` as the default AI generation layout.
- Keep `motion_duplicate_frames` as a quality gate only for unexpected duplicate motion.
- Clarify `character_prompt_contract_v1_5` so static single-region actions are described as one source pose, not four source animation frames.
- Keep requiring distinct phases for multi-frame OCAD actions.
- Update benchmark Markdown reports to display expected source reuse and unexpected duplicate groups as separate item-table columns.
- Add a provider-free `benchmark openrouter-recompute-report` command so historical reports can be re-summarized after taxonomy, gate, or Markdown logic changes.

Do not build a repair or interpolation system for static OCAD regions in this step. The current data does not show a structural or multi-frame-motion blocker that justifies that complexity.

## Consequences

- Users reading benchmark Markdown no longer see a raw `Duplicates` column that mixes expected static reuse with real motion debt.
- Provider prompts stop implying that every normalized runtime loop has four independent OCAD source frames.
- Historical live reports can be recomputed into new local report directories without mutating the original run artifacts.
- If future live gates produce `avg_unexpected_duplicate_group_count > 0`, that remains a real v0.3.1+ quality issue.
- If the product later wants animated idle breathing for OCAD single-region actions, that should be a separate interpolation/preview feature, not a generation prompt fix.

## Verification

Provider-free verification:

```text
node --test test/character-pack/promptContracts.test.js
node --test test/character-pack/openRouterBenchmark.test.js
node --test test/character-pack/geminiProvider.test.js test/character-pack/cli.test.js test/serverOpenRouter.test.js
npm run character-pack -- benchmark openrouter-recompute-report --report generated/openrouter-benchmarks/openrouter_bench_20260601_165731/benchmark_report.json --output-dir <tmp> --run-id ocad_static_recompute_sanity
```

Live provider verification was not run in this change because the local environment did not expose an OpenRouter or Gemini API key. The historical OCAD run above remains the evidence source for the duplicate-frame classification.
