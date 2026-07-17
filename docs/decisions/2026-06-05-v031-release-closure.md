# v0.3.1 Release Closure

## Status

Accepted on 2026-06-05.

## Scope

v0.3.1 is a small stabilization release after v0.3. It closes the OCAD static-source reuse reporting boundary before v0.4 planning begins.

## Included

- `character_prompt_contract_v1_5` clarifies that OCAD single-region static actions are one source pose, not four source animation frames.
- OpenRouter benchmark Markdown item tables split expected static-source reuse from unexpected duplicate motion.
- `benchmark openrouter-recompute-report` refreshes stored OpenRouter benchmark reports without provider quota.
- The historical OCAD confirmation run can be recomputed into a new local report directory while preserving `source_run_id`.

## Not Included

- No live provider gate rerun.
- No tile, scene, LDtk, WFC, or pixelize pipeline work.
- No new repair or interpolation system for OCAD static regions.

## Verification Plan

Provider-free verification for the release closure:

```text
node --test test/character-pack/cli.test.js test/character-pack/openRouterBenchmark.test.js
npm test
npm run character-pack -- benchmark openrouter-recompute-report --report generated/openrouter-benchmarks/openrouter_bench_20260601_165731/benchmark_report.json --output-dir <tmp> --run-id v031_release_recompute_sanity
git diff --check
```

Live provider verification is deferred because v0.3.1 only packages provider-free prompt/report behavior already validated against stored benchmark data.
