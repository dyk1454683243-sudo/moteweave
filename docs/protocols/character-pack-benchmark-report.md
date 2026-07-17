# Character Pack Benchmark Report Protocol

Local compatibility benchmark reports live under:

```text
generated/benchmarks/<run_id>/benchmark_report.json
```

Required fields:

```text
schema_version
run_id
created_at
items[]
```

Each item records input path/name, processing status, validation metrics, export availability, and optional Godot probe results.

This protocol is distinct from:

- `openrouter-benchmark-report.md`, which records live provider generation gates.
- `processed-sample-benchmark.md` outputs, which summarize existing generated debug reports.

## Export Keys

```text
json_grid
rpgmaker_v0
ocad_v0
```

## Probe Keys

```text
items[].godot_probe.json_grid
items[].godot_probe.rpgmaker_v0
items[].godot_probe.ocad_v0
```

Each probe status is `pass`, `fail`, or `skipped`.
