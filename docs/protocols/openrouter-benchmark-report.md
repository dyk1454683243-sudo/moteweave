# OpenRouter Benchmark Report Protocol

`benchmark_report.json` records project-three live generation quality data.

## Location

```text
generated/openrouter-benchmarks/<run_id>/benchmark_report.json
generated/openrouter-benchmarks/<run_id>/benchmark_report.md
generated/openrouter-benchmarks/<run_id>/items/<case_id>_v<variant>/
```

## Top Level

```json
{
  "schema_version": 1,
  "run_id": "openrouter_bench_20260525_010203",
  "source_run_id": null,
  "preset": "fixed_region_motion_v0",
  "provider_preset_id": null,
  "template_file": "fixed_region_motion_template_v1.png",
  "image_config": { "image_size": "1K", "aspect_ratio": "1:1" },
  "variants_per_case": 1,
  "summary": {},
  "quality_gate": {},
  "items": []
}
```

## Summary Metrics

```text
summary.total
summary.validation.pass
summary.validation.warning
summary.validation.fail
summary.validation.unknown
summary.failures.model_error
summary.failures.post_processing
summary.failures.unexpected_error
summary.pass_rate
summary.usable_rate
summary.metrics.halo_score
summary.metrics.duplicate_group_count
summary.metrics.duplicate_expected_source_reuse_count
summary.metrics.duplicate_unexpected_group_count
summary.metrics.walk_low_motion_count
summary.metrics.direction_consistency_fail_count
summary.metrics.edge_pressure_severe_frame_count
summary.failure_taxonomy.classified
summary.failure_taxonomy.primary
summary.failure_taxonomy.top_categories
```

`pass_rate` counts only validation pass. `usable_rate` counts pass plus warning.

## Recomputed Reports

When report logic changes, an existing report can be recomputed without provider calls:

```bash
npm run character-pack -- benchmark openrouter-recompute-report \
  --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json \
  --output-dir generated/openrouter-benchmarks \
  --run-id <run_id>_recomputed
```

The command reads only the supplied report JSON, recalculates `summary`, `quality_gate`, item-level `failure_taxonomy`, and Markdown from stored items, then writes a new run directory. Recomputed reports set `source_run_id` to the original run id so historical live data remains traceable.

## Quality Gate

`quality_gate` is a report-level decision aid. It does not replace the raw validation results and does not claim product readiness by itself.

```text
quality_gate.status
quality_gate.gates[].id
quality_gate.gates[].status
quality_gate.gates[].threshold
quality_gate.gates[].observed
```

Current gates:

```text
structural_usability      # fail if usable_rate < 0.9, validation fail count > 0, or post-processing failures > 0
motion_duplicate_frames   # warning if unexpected duplicate groups are present
```

For `fixed_region_motion_v0`, `structural_usability` tracks whether the generation route is usable enough to be the default entry path. `motion_duplicate_frames` separates expected fixed-region source reuse from unexpected duplicate motion. Historical reports that use `ocad_motion_v0` are still readable and recompute to the canonical gate preset:

```text
quality.duplicate_group_count
quality.duplicate_expected_source_reuse_count
quality.duplicate_unexpected_group_count
quality.duplicate_expected_source_reuse_actions
quality.duplicate_unexpected_actions
```

Expected source reuse happens when multiple runtime frames intentionally come from the same fixed region, such as a single idle, defence, die, sit, or item region repeated during normalization. Unexpected duplicate motion happens when different source regions for a multi-frame action collapse to identical normalized frames.

The Markdown item table reports the split explicitly:

```text
Expected reuse      # quality.duplicate_expected_source_reuse_count
Unexpected dupes    # quality.duplicate_unexpected_group_count
```

It does not present `quality.duplicate_group_count` as the primary item-table value, because that total combines expected static-source reuse with real duplicate-motion debt.

Source-region edge pressure is recorded at two layers for fixed-region source layouts:

```text
debug_report.validation.metrics.source_region_edge_pressure
debug_report.source_quality
source_quality_report.json
```

The older `source_region_edge_pressure_high` warning is still only promoted when
normalized runtime validation also reports `edge_pressure_high` or a
`frame_N_cropped` blocking error. The newer source-quality gate can independently
warn with `source_region_edge_pressure:<region>` so provider candidates with
source-level edge risk rank below cleaner fixed-region sources even when
normalization still fits the runtime sheet.

## Item Fields

Each item records:

```text
case.id
case.description
variant
status
generation.provider
generation.provider_preset_id
generation.model
generation.template_file
generation.prompt_contract
validation.status
validation.warnings
validation.blocking_errors
validation.failure_taxonomy
failure_taxonomy.primary
failure_taxonomy.categories
quality.halo_score
quality.duplicate_group_count
quality.duplicate_expected_source_reuse_count
quality.duplicate_unexpected_group_count
quality.walk_low_motion_count
quality.direction_consistency_fail_count
quality.edge_pressure_severe_frame_count
exports.json_grid
exports.rpgmaker_v0
exports.ocad_v0
artifacts.dir
```

If the provider or post-processing fails, `failure.mode` and `failure.reason` preserve that failed sample as benchmark data.

## Failure Taxonomy

`failure_taxonomy` is a stable bucket layer over raw validator messages. It does not replace `validation.warnings` or `validation.blocking_errors`.

Example item shape:

```json
{
  "failure_taxonomy": {
    "primary": "structure.empty_frame",
    "severity": "error",
    "categories": [
      {
        "id": "structure.empty_frame",
        "severity": "error",
        "count": 1,
        "examples": ["frame_6_empty"]
      }
    ]
  }
}
```

Initial buckets:

```text
structure.frame_count
structure.empty_frame
structure.cropped
motion.low_motion
motion.duplicate_frames
alignment.anchor_drift
alignment.baseline_drift
alignment.subpixel_jitter
background.halo
background.dual_matte
layout.source_region_edge_pressure
composition.edge_pressure
provider.model_error
pipeline.post_processing
pipeline.unexpected_error
```

## Local Gallery API

The local server exposes a compact read-only index for benchmark browsing:

```text
GET /api/benchmark-gallery
```

The response is derived from local benchmark reports under:

```text
generated/openrouter-benchmarks/<run_id>/benchmark_report.json
generated/openrouter-benchmarks/<run_id>/items/<case_id>_v<variant>/
```

It returns:

```text
runs[].run_id
runs[].created_at
runs[].preset
runs[].summary
runs[].items[].status
runs[].items[].validation_status
runs[].items[].failure_taxonomy
runs[].items[].source_url
runs[].items[].normalized_sheet_url
runs[].items[].prompt_url
runs[].items[].debug_report_url
runs[].items[].row_gif_previews
```

The gallery API is an index over local artifacts, not a second benchmark report format. It returns the most recent runs first and may cap visible runs/items so the UI does not eagerly load every historical Row GIF.
