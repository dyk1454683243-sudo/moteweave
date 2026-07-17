# 2.5D Material Source Benchmark Runbook

**Status:** Draft for the next manual/live provider window  
**Scope:** 2.5D material-source benchmark only. No character generation, full
WFC productization, or external editor round-trip claims.

Use this runbook when a human operator will spend provider quota later and the
local pipeline needs a repeatable handoff for review. The provider image is only
a raw material source. The local deterministic pipeline owns source
normalization, material-slot extraction, tile composition, validation, export
shape, and preview artifacts.

## Current State

- `tileset material-source-benchmark` is the guarded live/provider entry point
  for 2.5D material-source candidates.
- Each benchmark candidate plans one material-source generation request. If a
  provider preset is not pinned, configured fallback attempts can still consume
  provider budget.
- Live execution requires both `--yes` and `--max-provider-calls`.
- `--dry-run-plan` spends no provider calls and should be run before any live
  attempt.
- A focused `--description` creates one ad hoc benchmark case. Without
  `--description`, use `--sample-size 1` or explicit `--case-id` values to
  avoid accidentally running the full default case set.
- The provider-free review command can be run by an agent after the human
  operator finishes the live run.

## Budget Profiles

| Profile | Purpose | Planned calls |
|---|---|---:|
| Dry run | Validate provider config, output path, and call count | 0 |
| One-call smoke | Check whether the selected route can return one usable raw source | 1 |
| Three-candidate comparison | Compare candidate-selection behavior for one material description | 3 |
| Larger sampled gate | Broader evidence after a clean smoke and useful local review | case count x candidate count |

Do not increase candidate count when the review reports `provider_blocked`.
That status means route, quota, policy, model, or credentials blocked raw-source
evidence before quality could be judged.

## Step 1: Provider-Free Plan

Run the smoke plan first. It should report `estimated_provider_calls: 1`.

```bash
npm run character-pack -- tileset material-source-benchmark \
  --description "mossy cliff grass blocks with cool stone side walls" \
  --candidate-count 1 \
  --source-image-size 1K \
  --dry-run-plan \
  --output-dir generated/two-point-five-d-material-source-benchmarks \
  --run-id local_2_5d_material_source_1call_smoke
```

For a three-candidate comparison, change only the count and run id:

```bash
npm run character-pack -- tileset material-source-benchmark \
  --description "mossy cliff grass blocks with cool stone side walls" \
  --candidate-count 3 \
  --source-image-size 1K \
  --dry-run-plan \
  --output-dir generated/two-point-five-d-material-source-benchmarks \
  --run-id local_2_5d_material_source_3candidate_plan
```

Expected checks:

- `estimated_provider_calls` equals the intended budget.
- `output_dir` resolves under
  `generated/two-point-five-d-material-source-benchmarks/<run-id>`.
- No raw API key values appear in stdout or generated plan files.
- The plan claim boundary says the provider output is raw material source only.

## Step 2: Human Live Run

Only run this after the dry-run plan looks correct. This command is intended for
the human operator when they choose to spend quota.

One-call smoke:

```bash
npm run character-pack -- tileset material-source-benchmark \
  --description "mossy cliff grass blocks with cool stone side walls" \
  --candidate-count 1 \
  --source-image-size 1K \
  --yes \
  --max-provider-calls 1 \
  --output-dir generated/two-point-five-d-material-source-benchmarks \
  --run-id local_2_5d_material_source_1call_smoke
```

Optional three-candidate comparison for the same description:

```bash
npm run character-pack -- tileset material-source-benchmark \
  --description "mossy cliff grass blocks with cool stone side walls" \
  --candidate-count 3 \
  --source-image-size 1K \
  --yes \
  --max-provider-calls 3 \
  --output-dir generated/two-point-five-d-material-source-benchmarks \
  --run-id local_2_5d_material_source_3candidate
```

Stop rules:

- Stop after a provider route, terms, quota, model, or credential blocker.
- Do not rerun with a higher candidate count until route access is fixed.
- Do not treat provider-access blockers as material-quality evidence.
- Do not commit raw generated provider images unless the repository task
  explicitly requests it and redistribution rights are clear.

## Step 3: Agent Offline Review

After the human live run finishes, the agent can review the explicit run
directory without spending provider quota:

```bash
npm run character-pack -- tileset material-source-benchmark-review \
  --run-dir generated/two-point-five-d-material-source-benchmarks/<run-id>
```

If the exact run id is not handy, review the newest completed run under the
benchmark root:

```bash
npm run character-pack -- tileset material-source-benchmark-review \
  --latest \
  --benchmark-root generated/two-point-five-d-material-source-benchmarks
```

If the run directory contains only `material_source_benchmark_plan.json`, the
review command should stop with a dry-run-only message. Run the live benchmark
first so `material_source_benchmark.json` exists.

The review writes these files next to `material_source_benchmark.json`:

```text
material_source_benchmark_review.json
material_source_benchmark_review.md
material_source_benchmark_review.html
material_source_benchmark_review.png
```

Use `material_source_benchmark_review.png` as the compact screenshot handoff
artifact. Use JSON and Markdown for exact issue taxonomy and next actions.

## Review Status Guide

| Review status | Meaning | Next action |
|---|---|---|
| `provider_blocked` | Provider route or quota prevented usable raw-source evidence | Fix provider access before judging quality |
| `needs_quality_work` | At least one selected candidate failed local deterministic checks | Improve the failing local stage before expanding |
| `review_warnings` | Selected candidates are usable but have warning taxonomy | Review warnings and tune extraction or thresholds |
| `ready_to_expand` | Selected candidates passed local gates with no reported issues | Run a larger sampled benchmark if broader evidence is needed |

## Browser/API Shape

Provider-free dry-run request:

```http
POST /api/two-point-five-d-material-source-benchmark
{
  "dryRunPlan": true,
  "description": "mossy cliff grass blocks with cool stone side walls",
  "candidateCount": 1,
  "imageConfig": { "image_size": "1K", "aspect_ratio": "1:1" }
}
```

Live request shape for the human operator:

```http
POST /api/two-point-five-d-material-source-benchmark
{
  "confirm_live_generation": true,
  "description": "mossy cliff grass blocks with cool stone side walls",
  "candidateCount": 1,
  "imageConfig": { "image_size": "1K", "aspect_ratio": "1:1" },
  "maxProviderCalls": 1
}
```

Increase both `candidateCount` and `maxProviderCalls` together only when the
operator intentionally chooses a larger comparison.

## Claim Boundary

This benchmark answers a narrow question: can the configured provider/model
produce raw material-source candidates that survive the local source normalizer,
material-slot extraction, composer, validator, and review pipeline for the
tested descriptions?

It does not prove arbitrary-source production readiness, WFC quality,
multi-height terrain support, external editor round-trip support, or full
commercial asset readiness by itself.
