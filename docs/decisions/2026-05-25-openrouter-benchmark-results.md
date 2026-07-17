# Project Three OpenRouter Benchmark Results

Date: 2026-05-25

## Benchmark Gate

Command:

```bash
npm run benchmark:openrouter -- --sample-size 20 --variants 1 --image-size 1K --yes
```

Run:

```text
generated/openrouter-benchmarks/openrouter_bench_20260524_163510/
```

Result:

```text
total: 20
pass: 17
warning: 2
fail: 1
model_error: 0
post_processing: 1
pass_rate: 0.85
usable_rate: 0.95
template: motion_template_ocad_primary.png
```

## What The Data Showed

The primary template is viable enough for the next iteration: no model errors, no halo issues, no duplicate-frame groups, no walk low-motion failures, and no direction-consistency failures in the 20-sample run.

The important failure was `bakery_golem`: the model produced an OCAD-like wider layout, roughly 12 columns, while the post-processing profile expects `topdown_rpg_v0` 8x8. The old validator only caught this when the final frame became empty. A later retry could pass validation while still being visually cut by the 8x8 slicer.

## Changes Made From The Data

Prompt constraint was tightened:

```text
The output must contain exactly 64 cells total.
The profile grid overrides the template canvas if they conflict.
```

Validator coverage was widened with `edge_pressure`:

```text
edge_pressure.severe_frame_count
edge_pressure_high warning
```

This catches sources that are technically non-empty but visually cut apart by wrong grid slicing.

## Follow-Up Evidence

The failed `bakery_golem` case was rerun after the prompt update:

```text
generated/openrouter-benchmarks/openrouter_bench_20260524_164232/
status: pass
```

Visual inspection still showed a too-wide source layout. Reprocessing that source with the updated validator now reports:

```text
status: warning
warning: edge_pressure_high
edge_pressure.severe_frame_count: 46
```

## Decision

Do not add ControlNet or a new provider yet. The next useful work is to keep running real benchmark samples and improve prompt/validator/autocorrection only when a repeated failure mode appears.

Current highest-priority quality issue:

```text
OCAD-like wide layouts can be generated even when the requested output profile is 8x8.
```

The project now has a measurement loop to catch this instead of relying on visual luck.
