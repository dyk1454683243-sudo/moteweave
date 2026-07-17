# Character Pack Benchmark Runbook

Run:

```bash
npm run benchmark:character-pack
```

The default run uses only the tracked deterministic `sample_hero` fixture.
Additional local inputs are explicit and repeatable:

```bash
npm run benchmark:character-pack -- \
  --input <input-file> \
  --input <second-input-file>
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
GODOT_BIN=<godot-bin> \
NPC_PLUGIN_ZIP=<npc-plugin-zip> \
npm run benchmark:character-pack -- --godot
```

The report includes:

```text
items[].godot_probe.json_grid
items[].godot_probe.rpgmaker_v0
items[].godot_probe.ocad_v0
```

Each probe status is `pass`, `fail`, or `skipped`. A probe is skipped when
`GODOT_BIN` or `NPC_PLUGIN_ZIP` is not configured, the configured file is not
available, or the requested export is not present.
