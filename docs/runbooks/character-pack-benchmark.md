# Character Pack Benchmark Runbook

Run:

```bash
npm run benchmark:character-pack
```

Protocol:

```text
docs/protocols/character-pack-benchmark-report.md
```

The stable CLI route for processed sample benchmarks is:

```bash
npm run character-pack -- benchmark processed --root-dir generated --limit 30
```

Open the generated report under:

```text
generated/benchmarks/<run_id>/benchmark_report.json
```

With Godot probe enabled:

```bash
npm run benchmark:character-pack -- --godot
```

The report includes:

```text
items[].godot_probe.json_grid
items[].godot_probe.rpgmaker_v0
items[].godot_probe.ocad_v0
```

Each probe status is `pass`, `fail`, or `skipped`. `skipped` is acceptable only when Godot or `$HOME/Downloads/NPC插件青春rmversion.zip` is not available.
