# OpenRouter Real Benchmark Runbook

Use this runbook for project three: real generation quality closure.

## Purpose

The benchmark answers whether generated character sheets from OpenRouter can reliably pass through:

```text
OpenRouter -> source.png -> post-processing -> validation -> GIF previews -> Godot/RPGMaker/OCAD exports
```

The current AI generation default is `fixed_region_motion_v0`, using:

```text
templates/fixed_region_motion_template_v1.png
```

Generated fixed-region sources are normalized into the runtime `topdown_rpg_v0` profile after slicing, so exports remain compatible with the existing runtime sheet contract.

The legacy/focused `topdown_rpg_v0` constraint template is:

```text
templates/motion_template_ocha_8x8.png
```

It is an equal-cell pose/action/control template, not a style or character identity reference. Select it explicitly when testing topdown prompt/template regressions or the repair fallback.

## Cheap One-Sample Gate

```bash
npm run benchmark:openrouter -- --sample-size 1 --variants 1 --image-size 1K --yes
```

This proves the benchmark loop works and writes a report.

To run the same one-sample gate against the focused topdown source layout:

```bash
npm run benchmark:openrouter -- --sample-size 1 --variants 1 --image-size 1K --preset topdown_rpg_v0 --yes
```

## Topdown Quality Closure Gate

After prompt or topdown template changes, run the focused high-risk gate before spending quota on the full 20-case gate.

First inspect the plan without provider quota:

```bash
npm run benchmark:topdown-quality -- --dry-run-plan
```

Default focused cases:

```text
blue_wizard
frog_knight
silver_swordswoman
desert_merchant
thunder_drummer
```

Default image-size matrix:

```text
1K
2K
```

Run the live focused matrix when `OPENROUTER_API_KEY` is configured:

```bash
npm run benchmark:topdown-quality -- --variants 1 --yes
```

To override the focused case set:

```bash
npm run benchmark:topdown-quality -- --case-id blue_wizard --case-id frog_knight --image-size 1K --image-size 2K --variants 1 --yes
```

The aggregate report is written to:

```text
generated/openrouter-benchmarks/<topdown_quality_closure_run_id>/quality_closure_report.json
generated/openrouter-benchmarks/<topdown_quality_closure_run_id>/quality_closure_report.md
```

Each matrix child run is written below the aggregate directory with its own `benchmark_report.json` and item artifacts.

Use the matrix to decide whether 2K materially improves `structure.empty_frame` or `structure.cropped` before changing default benchmark size or claiming quality improvement.

Current caution: `topdown_quality_live_2case_20260601` and `topdown_quality_live_v13_2case_1k_20260601` both remained 0 usable. The main live failure shifted to horizontal `attack_left` / `attack_right` cropping, so do not run the full 20-case gate until a focused repair or prompt change clears the small gate.

To inspect repair candidates from any existing topdown benchmark report without spending provider quota:

```bash
npm run character-pack -- benchmark topdown-repair-plan --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json
```

This maps `frame_<n>_empty` and `frame_<n>_cropped` messages to topdown row, column, animation, frame-in-animation, and a single-cell repair strategy. Use it after the focused matrix to decide whether a minimal per-frame repair prototype is warranted.

To emit provider-ready single-cell repair tasks from the same report without calling a provider:

```bash
npm run character-pack -- benchmark topdown-repair-manifest --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json
```

For quick trend checks, print only the manifest summary:

```bash
npm run character-pack -- benchmark topdown-repair-manifest --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json --summary-only
```

Each task includes the target frame rectangle on `normalized_sheet.png`, the feet-center anchor, same-animation reference frames, a single-cell provider prompt, and the expected 96x96 repaired-cell output contract. It still does not spend provider quota or patch image files.

Quality closure repairs use a separate manifest because they target post-validation quality drift rather than structural empty/cropped cells. Use this when a sheet is mostly usable but has white-edge residue, anchor/baseline drift, weak motion, or held-prop side inconsistency. Bbox half-pixel center jitter is recorded in the closure metrics as advisory evidence; it only becomes a local anchor task when validator warnings show actual anchor or baseline drift:

```bash
npm run character-pack -- benchmark quality-closure-repair-manifest \
  --debug-report generated/openrouter-benchmarks/<run_id>/items/<item_id>/debug_report.json \
  --item-id <item_id> \
  --output-dir generated/topdown-repairs/<repair_manifest_run_id>
```

For a whole benchmark report:

```bash
npm run character-pack -- benchmark quality-closure-repair-manifest \
  --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json \
  --output-dir generated/topdown-repairs/<repair_manifest_run_id>
```

This command writes `quality_closure_repair_manifest.json` and `quality_closure_repair_manifest.md` when `--output-dir` is provided. It is provider-free: `estimated_provider_calls` is only the count of future provider repair tasks. If a debug report predates `quality_closure`, reprocess the source with the current pipeline before planning quality repairs.
If an older report contains an animation-only `local_anchor_stabilization` task with no validator anchor/baseline drift warning, the manifest is blocked; reprocess the source so half-pixel bbox jitter stays advisory instead of becoming a false local repair.

To apply provider-free local repairs from that manifest, revalidate the sheet, and write provider dry-run repair prompts for the remaining semantic tasks:

```bash
npm run character-pack -- benchmark quality-closure-repair-loop \
  --manifest generated/topdown-repairs/<repair_manifest_run_id>/quality_closure_repair_manifest.json \
  --output-dir generated/quality-closure-repairs/<repair_loop_run_id>
```

This writes `repaired_normalized_sheet.png`, `quality_closure_before_after.png`,
`quality_closure_repair_report.json`, `quality_closure_repair_report.md`, and
one `provider_tasks/<task_id>/prompt.txt` plus contract JSON per provider task.
The loop is still provider-free; the prompt files are dry-run handoff artifacts
for a later explicit live repair pass.

To select exactly one provider/manual task from a quality-closure repair
manifest and write a strict handoff prompt without spending quota:

```bash
npm run character-pack -- benchmark quality-closure-provider-handoff \
  --manifest generated/topdown-repairs/<repair_manifest_run_id>/quality_closure_repair_manifest.json \
  --output-dir generated/quality-closure-repairs/<handoff_run_id>
```

The selector prefers a near-pass item with few remaining provider/manual tasks,
then prioritizes semantic walk-animation repairs so the first strip can prove
the end-to-end closure loop cheaply. Use `--task-id <task_id>` to override the
selection when a specific animation is being tested.

After a provider/manual repair strip exists for one of those quality-closure
provider tasks, paste it back into the normalized sheet and rerun local
validation plus quality closure:

```bash
npm run character-pack -- benchmark quality-closure-apply-provider-repair \
  --manifest generated/topdown-repairs/<repair_manifest_run_id>/quality_closure_repair_manifest.json \
  --repair <task_id>=<repaired_animation_strip.png> \
  --output-dir generated/quality-closure-repairs/<apply_run_id>
```

The strip may be an exact horizontal or vertical sequence of 96x96 cells. If
the provider returns a non-exact strip size, the command normalizes it to the
target cell contract with nearest-neighbor resizing before paste. This command
does not call a provider; it writes `repaired_normalized_sheet.png`, regenerated
Row GIFs, `quality_closure_provider_repair_report.json`, and
`quality_closure_provider_repair_report.md`.

To spend exactly one provider call on a selected semantic animation strip, use
the provider repair loop. Dry-run first to inspect the prompt and reference
images:

```bash
npm run character-pack -- benchmark quality-closure-provider-repair-loop \
  --manifest generated/topdown-repairs/<repair_manifest_run_id>/quality_closure_repair_manifest.json \
  --task-id <task_id> \
  --dry-run-plan \
  --output-dir generated/quality-closure-repairs/<provider_repair_loop_run_id>
```

When ready, run the live one-call strip repair:

```bash
npm run character-pack -- benchmark quality-closure-provider-repair-loop \
  --manifest generated/topdown-repairs/<repair_manifest_run_id>/quality_closure_repair_manifest.json \
  --task-id <task_id> \
  --image-size 1K \
  --output-dir generated/quality-closure-repairs/<provider_repair_loop_run_id> \
  --yes
```

This loop attaches the full normalized sheet and the current target animation
strip as references. By default it also attaches the built-in
`fixed_region_motion_v0` action template strip so the provider can follow the
template motion, pose rhythm, facing direction, and frame order while using the
generated normalized sheet for character identity. The provider is asked to
repair only that horizontal strip; local code post-processes the returned image
into a strict `N * 96 x 96` strip, applies it, and reruns validation plus quality
closure. It does not auto-detect wrong facing or mix regions from different
generated candidates; choose the task to repair from reviewed evidence.

To use a custom motion/action reference, pass an 8x8 sheet or an already sliced
target-size strip:

```bash
npm run character-pack -- benchmark quality-closure-provider-repair-loop \
  --manifest generated/topdown-repairs/<repair_manifest_run_id>/quality_closure_repair_manifest.json \
  --task-id <task_id> \
  --motion-template <template_or_strip.png> \
  --motion-template-layout topdown_rpg_v0 \
  --dry-run-plan \
  --output-dir generated/quality-closure-repairs/<provider_repair_loop_run_id>
```

Use `--disable-motion-template` to return to the previous two-reference behavior.

To generate one repaired cell from a manifest task, first dry-run the prompt:

```bash
npm run character-pack -- benchmark topdown-generate-repair-cell \
  --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json \
  --task-id <task_id> \
  --dry-run-prompt \
  --output-dir generated/topdown-repairs/<repair_cell_run_id>
```

Then run the live provider call when ready:

```bash
npm run character-pack -- benchmark topdown-generate-repair-cell \
  --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json \
  --task-id <task_id> \
  --image-size 1K \
  --output-dir generated/topdown-repairs/<repair_cell_run_id> \
  --yes
```

The generator uses a same-animation reference strip instead of the full normalized sheet, writes `raw_provider_output.png`, post-processes that output into strict `repaired_cell.png`, and records `safe_fit` metadata when it had to move or fit pixels away from cell edges.

To run a one-sheet repair execution loop for a selected subset, start with the dry-run preflight:

```bash
npm run character-pack -- benchmark topdown-repair-loop \
  --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json \
  --item-id <item_id> \
  --action <action_name> \
  --dry-run-plan \
  --output-dir generated/topdown-repairs/<repair_loop_run_id>
```

For a smaller quota-bounded live subset, select explicit task ids:

```bash
npm run character-pack -- benchmark topdown-repair-loop \
  --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json \
  --task-id <task_id_a> \
  --task-id <task_id_b> \
  --image-size 1K \
  --output-dir generated/topdown-repairs/<repair_loop_run_id> \
  --yes
```

The repair loop is intentionally one-sheet scoped. It rejects mixed `item_id`, mixed preset, mixed normalized sheet paths, duplicate target frames, and existing generated-evidence output files before live provider calls. It writes `loop_plan.json`, per-task generated-cell evidence under `cells/`, and only applies the generated cells if every selected provider call succeeds. During apply, each repaired cell is locally compacted when it is wider than the topdown comfortable-width threshold, then nudged toward the profile feet-center anchor without allowing cropped edges. The final `repair_validation.json` includes `cell_compaction`, `cell_alignment`, and a `validation_gate` that requires all selected target issues to resolve and no new blocking errors to appear. Passing that gate does not mean the entire original sheet is usable; inspect the repaired sheet and Row GIFs before spending quota on the remaining tasks.

After a repaired 96x96 cell exists, paste it into the affected normalized sheet and rerun validation plus Row GIF generation:

```bash
npm run character-pack -- benchmark topdown-apply-repair \
  --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json \
  --repair <task_id>=<repaired_cell.png> \
  --output-dir generated/topdown-repairs/<repair_run_id>
```

The command writes `repaired_normalized_sheet.png`, `repair_validation.json`, and the regenerated Row GIF previews under the output directory. The `resolved_count` only means the target validation message disappeared after paste; inspect the repaired sheet and GIF before treating the asset as usable.

## Project Three Data Gate

```bash
npm run benchmark:openrouter -- --sample-size 20 --variants 1 --image-size 1K --yes
```

Use an explicit run id when recording a decision result:

```bash
npm run benchmark:openrouter -- --sample-size 20 --variants 1 --image-size 1K --run-id <run_id> --yes
```

The default 20-case gate uses `fixed_region_motion_v0`. Run the topdown 8x8 gate separately only when validating topdown-specific prompt/template/repair changes:

```bash
npm run benchmark:openrouter -- --sample-size 20 --variants 1 --image-size 1K --preset topdown_rpg_v0 --yes
```

Budget permitting, use more variants:

```bash
npm run benchmark:openrouter -- --sample-size 20 --variants 3 --image-size 1K --yes
```

If provider presets are needed, use the stable character-pack CLI route:

```bash
npm run character-pack -- benchmark openrouter --sample-size 20 --variants 1 --image-size 1K --preset topdown_rpg_v0 --provider-preset <preset-id> --yes
npm run character-pack -- benchmark openrouter --sample-size 20 --variants 1 --image-size 1K --preset fixed_region_motion_v0 --provider-preset <preset-id> --yes
```

The OpenRouter benchmark command also supports explicit case ids for ad-hoc focused checks:

```bash
npm run benchmark:openrouter -- --case-id blue_wizard --case-id frog_knight --variants 1 --image-size 1K --yes
```

## Optional Godot Probe

```bash
npm run benchmark:openrouter -- --sample-size 5 --variants 1 --image-size 1K --godot --yes
```

## Output

The command prints the run id and writes:

```text
generated/openrouter-benchmarks/<run_id>/benchmark_report.json
generated/openrouter-benchmarks/<run_id>/benchmark_report.md
generated/openrouter-benchmarks/<run_id>/items/<case_id>_v<variant>/
```

Each item directory contains the generated source, normalized sheet, debug report, row GIFs, and export ZIPs.

Expected Row GIF counts:

```text
topdown_rpg_v0: 16
fixed_region_motion_v0: 21
```

## Local Gallery Inspection

Start the local server:

```bash
npm start
```

Open:

```text
http://localhost:4173/
```

Use the Character Pack tab's Benchmark Gallery panel to inspect:

```text
run summary
validation status
failure taxonomy badges
source image
normalized sheet
prompt.txt
debug_report.json
Row GIF previews
```

The gallery is intentionally recent-first and compact. Use the written `benchmark_report.json` when you need to inspect every historical run or every item from a large gate.

For a clean check, compare the Row GIF previews with `debug_report.json.validation.failure_taxonomy`, `debug_report.json.validation.warnings`, and `debug_report.json.validation.blocking_errors`.

## Decision Rule

Do not change templates, prompts, or add auto-correction based on one lucky image.

Use the 20-case gate before claiming:

```text
the template is better
the prompt is stable
auto-correction is necessary
ControlNet or another provider is justified
```

The benchmark should guide the next project by showing the dominant failure taxonomy buckets and the raw messages behind them.

Record the selected provider preset/model, prompt contract version, template file, pass rate, usable rate, quality gate status, top warnings, blocking errors, taxonomy buckets, and representative artifact paths in the generation quality decision note. For OCAD runs, record `quality.duplicate_expected_source_reuse_count` separately from `quality.duplicate_unexpected_group_count`; only the unexpected groups should drive `quality_gate.gates[].id = motion_duplicate_frames`. Also record `debug_report.validation.metrics.source_region_edge_pressure` as a diagnostic; it should become a validation warning only when normalized runtime frames also show edge/crop risk.
