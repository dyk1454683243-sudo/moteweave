# Topdown Horizontal Attack Cropping Follow-Up

## Context

After the topdown occupancy prompt contract, structural template replacement, repair planner, and repair manifest work, a small live quality gate was run against two high-risk cases:

```text
run_id: topdown_quality_live_2case_20260601
cases: blue_wizard, frog_knight
image_sizes: 1K, 2K
variants: 1
provider/model: OpenRouter google/gemini-3.1-flash-image-preview
```

The run used the replacement `motion_template_ocha_8x8.png` template and the prompt contract version current before this decision.

## Live Gate Result

The 2-case live gate did not prove a topdown quality fix:

```text
1K:
pass_rate: 0
usable_rate: 0
validation: pass=0 warning=0 fail=2 unknown=0
top taxonomy: structure.cropped=16, pipeline.post_processing=2
top frames: frame_40=2, frame_41=2, frame_42=2, frame_43=2, frame_44=2

2K:
pass_rate: 0
usable_rate: 0
validation: pass=0 warning=0 fail=2 unknown=0
top taxonomy: structure.cropped=18, pipeline.post_processing=2, composition.edge_pressure=1
top frames: frame_41=2, frame_42=2, frame_43=2, frame_44=2, frame_45=2
```

Interpretation:

- The old empty-frame cluster (`frame_6/7/14/15`) did not dominate this small run.
- Failures concentrated in `frame_40-47`, which are `attack_left` and `attack_right`.
- 2K did not improve the result; it produced slightly more cropped-frame errors in this sample.
- Visual inspection showed long horizontal staff/attack-effect pixels touching cell edges.

## Decision

Add `character_prompt_contract_v1_3` with a narrow topdown horizontal-attack compactness rule:

- name frames 40-43 (`attack_left`) and 44-47 (`attack_right`) as high-risk horizontal attack cells
- require clear left/right padding in those cells
- require weapons, staffs, shields, tools, capes, spell effects, and stretched arms to stay compact
- preserve the existing topdown 8x8 layout and OCAD fixed-region separation

## v1.3 Smoke Result

After adding `character_prompt_contract_v1_3`, a smaller 1K smoke was run:

```text
run_id: topdown_quality_live_v13_2case_1k_20260601
cases: blue_wizard, frog_knight
image_size: 1K
variants: 1
contract_version: character_prompt_contract_v1_3
```

Result:

```text
pass_rate: 0
usable_rate: 0
validation: pass=0 warning=0 fail=2 unknown=0
top taxonomy: structure.cropped=14, pipeline.post_processing=2
repair manifest: 14 tasks, all cropped_frame
repair actions: attack_left=7, attack_right=7
top frames: frame_41=2, frame_42=2, frame_43=2, frame_44=2, frame_45=2, frame_46=2
```

This is a small reduction from the comparable 1K run's 16 cropped-frame issues, but it is not a usable quality fix.

## Next Step

Do not run the full 20-case topdown gate yet. The focused live smoke is still 0 usable.

Use the repair manifest path next:

1. Take the v1.3 smoke run's `topdown-repair-manifest --summary-only` output as the repair target list.
2. Prototype one or two single-cell repaired outputs for `attack_left` / `attack_right`.
3. Paste repaired 96x96 cells back into the normalized sheet and rerun validation plus Row GIF previews.
4. Only if single-cell repair removes the concentrated cropped-frame failures should the project spend quota on another focused live matrix or full 20-case run.

## Local Repair Apply Prototype

The local paste-and-validate loop is now encoded in:

```text
npm run character-pack -- benchmark topdown-apply-repair --report <benchmark_report.json> --repair <task_id>=<repaired_cell.png> --output-dir <dir>
```

It does not call a provider. It:

- reads the repair task from a benchmark report-derived manifest
- replaces the target 96x96 cell on `normalized_sheet.png`
- reruns topdown validation with failure taxonomy
- regenerates the 16 Row GIF previews
- writes `repaired_normalized_sheet.png`, `repair_validation.json`, and GIFs

A stand-in local check was run on the v1.3 smoke output:

```text
report: generated/openrouter-benchmarks/topdown_quality_live_v13_2case_1k_20260601/topdown_quality_live_v13_2case_1k_20260601_1k/benchmark_report.json
task: blue_wizard_v1_frame_40_cropped
stand-in cell: frame_36 extracted from the same normalized sheet
output: generated/topdown-repairs/manual-standin-v13-blue-wizard/apply
resolved_count: 1
before blocking errors: frame_40_cropped, frame_41_cropped, frame_42_cropped, frame_43_cropped, frame_44_cropped, frame_45_cropped, frame_46_cropped, frame_47_cropped
after blocking errors: frame_41_cropped, frame_42_cropped, frame_43_cropped, frame_44_cropped, frame_45_cropped, frame_46_cropped, frame_47_cropped
row_gif_count: 16
taxonomy after paste: structure.cropped=7, motion.duplicate_frames=1
```

This proves the local repair-apply validation loop can remove a targeted structural error on a real failed live sample. It does not prove final art quality, because the stand-in cell is not a semantically correct provider-generated `attack_left` repair and introduces a duplicate-frame warning.

## Live Single-Cell Repair Generation

The single-cell provider path is now encoded in:

```text
npm run character-pack -- benchmark topdown-generate-repair-cell --report <benchmark_report.json> --task-id <task_id> --image-size 1K --output-dir <dir> --yes
```

The generator:

- builds the prompt from the repair manifest task
- sends a same-animation reference strip rather than the full 8x8 sheet
- writes the raw provider output
- removes background, normalizes the pose into a 96x96 cell, and applies `safe_fit` padding when the generated pose still touches cell edges

Live check:

```text
task: blue_wizard_v1_frame_40_cropped
provider/model: OpenRouter google/gemini-3.1-flash-image-preview
first full-sheet-reference attempt: produced a multi-pose contact-sheet-like cell; structurally resolved after paste but visually invalid
same-animation-strip attempt: produced one attack-left pose, but initial postprocess still touched x=0/y=0
safe_fit postprocess: moved bbox from x=0,y=0,right=68,bottom=84 to x=4,y=4,right=72,bottom=88
apply output: generated/topdown-repairs/live-v13-blue-wizard-frame40-apply-strip-safe
resolved_count: 1
after blocking errors: frame_41_cropped, frame_42_cropped, frame_43_cropped, frame_44_cropped, frame_45_cropped, frame_46_cropped, frame_47_cropped
row_gif_count: 16
```

Conclusion:

- The provider can generate a semantically relevant single attack-left cell when conditioned with same-animation reference cells.
- Local `safe_fit` is necessary for the current provider output because the raw repaired pose still tends to touch edges.
- This validates the per-frame repair architecture for one real provider-generated cell, but the asset is not usable until the remaining `attack_left/right` cropped frames are repaired and Row GIFs are visually checked.

## Repair Execution Loop

The repair execution loop is now encoded in:

```text
npm run character-pack -- benchmark topdown-repair-loop --report <benchmark_report.json> --task-id <task_id> [--task-id <task_id>] --image-size 1K --output-dir <dir> --yes
```

It adds the safeguards that the single-cell command intentionally did not own:

- one-sheet preflight: selected tasks must share `item_id`, preset, and `normalized_sheet.png`
- duplicate target-frame rejection before provider calls
- dry-run plan with selected task ids, estimated provider calls, provider preset, image config, and output paths
- output collision checks for generated evidence files before live provider calls
- no final apply if any selected provider generation fails
- final validation gate that requires selected target issues to resolve and no new blocking errors to appear

Dry-run check:

```text
report: generated/openrouter-benchmarks/topdown_quality_live_v13_2case_1k_20260601/topdown_quality_live_v13_2case_1k_20260601_1k/benchmark_report.json
selection: item_id=blue_wizard_v1, action=attack_left
output: generated/topdown-repairs/live-v13-blue-wizard-attack-left-loop-dry
can_run: true
estimated_provider_calls: 4
tasks: frame_40_cropped, frame_41_cropped, frame_42_cropped, frame_43_cropped
```

Live 2-cell batch check:

```text
output: generated/topdown-repairs/live-v13-blue-wizard-frames40-41-loop
tasks: blue_wizard_v1_frame_40_cropped, blue_wizard_v1_frame_41_cropped
provider/model: OpenRouter google/gemini-3.1-flash-image-preview
generated_count: 2
status: passed
validation_gate.passed: true
resolved_count: 2
unresolved_count: 0
new_blocking_errors: 0
before blocking errors: frame_40_cropped, frame_41_cropped, frame_42_cropped, frame_43_cropped, frame_44_cropped, frame_45_cropped, frame_46_cropped, frame_47_cropped
after blocking errors: frame_42_cropped, frame_43_cropped, frame_44_cropped, frame_45_cropped, frame_46_cropped, frame_47_cropped
row_gif_count: 16
```

Visual check:

- Both generated cells are single padded attack-left poses rather than contact-sheet artifacts.
- Both required `safe_fit`; raw provider output still touched the top/left edge before postprocess.
- The two repaired attack-left poses are visually very similar, so this proves the batch repair loop and structural gate, not final animation quality.
- The sheet remains unusable until the remaining `frame_42-47` cropped errors are repaired and the action Row GIFs are inspected.

## Focused Smoke Repair Closure

The repair loop was then used to repair all 14 cropped-frame targets from the v1.3 2-case smoke report.

Blue wizard:

```text
item: blue_wizard_v1
tasks: frame_40_cropped through frame_47_cropped
generation batches:
  generated/topdown-repairs/live-v13-blue-wizard-frames40-41-loop: passed, generated_count=2
  generated/topdown-repairs/live-v13-blue-wizard-frames42-47-loop: failed_generation after 4 generated cells; failed_task_id=blue_wizard_v1_frame_46_cropped; no apply was written
  generated/topdown-repairs/live-v13-blue-wizard-frames46-47-loop: passed, generated_count=2
final apply: generated/topdown-repairs/live-v13-blue-wizard-all-attack-apply
repair_count: 8
resolved_count: 8
validation_before: fail, blocking_errors=8 cropped frames
validation_after: warning, blocking_errors=0
remaining warnings: frame_46_anchor_drift
row_gif_count: 16
```

Frog knight:

```text
item: frog_knight_v1
tasks: frame_41_cropped through frame_46_cropped
generation batch: generated/topdown-repairs/live-v13-frog-knight-attack-loop
status: passed
generated_count: 6
resolved_count: 6
validation_before: fail, blocking_errors=6 cropped frames
validation_after: warning, blocking_errors=0
remaining warnings: frame_44_baseline_drift, frame_46_baseline_drift, edge_pressure_high
row_gif_count: 16
```

Combined focused result:

```text
target cropped repairs attempted: 14
target cropped repairs resolved: 14
provider transient failures observed: 1 fetch failure
failed batch apply behavior: no partial apply
repaired artifact validation statuses: warning=2, fail=0
blocking errors after repair artifacts: 0
```

Visual conclusion:

- The repair loop is now effective at clearing concentrated `structure.cropped` failures on these two smoke artifacts.
- The generated cells are structurally padded and single-pose, but not uniformly animation-quality. Blue wizard attack frames are especially repetitive, and frog knight still has baseline/edge-pressure warnings.
- This supports continuing with repair-loop quality polish before spending quota on a full topdown 20-case rerun. The next improvement should target anchor/baseline consistency and animation variation in repaired attack rows, not another broad prompt-only change.

## Local Repair Cell Alignment And Compacting

The remaining smoke warnings were local postprocess issues rather than provider-call blockers:

- blue wizard: `frame_46_anchor_drift`
- frog knight: `frame_44_baseline_drift`, `frame_46_baseline_drift`, `edge_pressure_high`

The apply step now prepares each repaired cell before paste:

1. If the repaired cell is wider than the topdown comfortable-width threshold, scale its bbox down uniformly and keep its foot anchor near the profile anchor.
2. Nudge the prepared cell toward the profile feet-center anchor.
3. Clamp the nudge so visible pixels stay inside the cell and cannot reintroduce `frame_<n>_cropped`.
4. Record `cell_compaction` and `cell_alignment` metadata in `applied_tasks`.

Local re-apply checks used the same live generated cells, with no provider calls:

```text
blue wizard output: generated/topdown-repairs/live-v13-blue-wizard-all-attack-apply-anchor-aligned
repair_count: 8
resolved_count: 8
validation_after: pass
blocking_errors: 0
warnings: 0
```

```text
frog knight output: generated/topdown-repairs/live-v13-frog-knight-attack-apply-anchor-compact
repair_count: 6
resolved_count: 6
validation_after: pass
blocking_errors: 0
warnings: 0
```

Updated focused smoke result:

```text
target cropped repairs resolved: 14 / 14
final repaired artifact statuses after local apply polish: pass=2, warning=0, fail=0
remaining structural taxonomy: none
```

This is the first evidence that the repair execution loop can turn the v1.3 focused two-case smoke from `fail=2` into two validation-clean repaired artifacts. It still does not prove the original generation path is fixed, and it does not prove animation quality is good enough for release because blue wizard attack frames remain visually repetitive. The next quota-bearing step should be a small focused gate or selected 20-case repair rehearsal, not a claim that topdown generation itself now passes.

## 20-Case Repair Readiness Decision

The original 20-case topdown run is still too large for an unbounded live repair rerun:

```text
run_id: openrouter_bench_20260531_161925
repair task count: 78
affected items: 17
empty_frame tasks: 33
cropped_frame tasks: 45
top frames: frame_6=8, frame_7=8, frame_14=8, frame_15=8, frame_24=7
```

The focused repaired smoke artifacts are validation-clean after local apply polish:

```text
blue_wizard_v1 repaired output: generated/topdown-repairs/live-v13-blue-wizard-all-attack-apply-anchor-aligned
validation_after: pass
attack_left mean_delta: 8.8468
attack_right mean_delta: 16.5356

frog_knight_v1 repaired output: generated/topdown-repairs/live-v13-frog-knight-attack-apply-anchor-compact
validation_after: pass
attack_left mean_delta: 23.2343
attack_right mean_delta: 29.6534
```

Decision:

- Do not spend quota on a full original 20-case repair run yet; 78 provider calls across 17 sheets is too large for the current evidence step.
- Do not rerun the 20-case generation gate as a quality claim; the original generation path has not changed since the v1.3 smoke.
- Treat the topdown structural repair board as closed for the focused `structure.cropped` smoke: the system can plan, generate, stop safely on provider failure, apply, locally align/compact, validate, and document repaired artifacts.
- The next board should be either a selected 3-5 item repair rehearsal from the original 20-case run or a separate animation-quality board that targets visual variation and semantic pose quality beyond validator pass/fail.
