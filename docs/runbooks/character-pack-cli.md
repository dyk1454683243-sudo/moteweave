# Character Pack CLI Runbook

The CLI exposes the same local pipeline used by the web UI.

## Process An Uploaded Sheet

```bash
npm run character-pack -- process \
  --input test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png \
  --output-dir generated/cli \
  --job-id cli_sample_hero \
  --name sample_hero \
  --background-mode flood
```

Useful options:

```text
--source-layout topdown_rpg_v0
--source-layout fixed_region_motion_v0
--black-source <png>
--background-tolerance 24
--anchor-offset-x 0
--anchor-offset-y 0
--disable-auto-correct
--disable-motion-stabilization
--locked-animation walk_down
--style-report
--style-max-colors 16
```

The command writes:

```text
source.png
normalized_sheet.png
multi_resolution.json
normalized_sheet_96.png
normalized_sheet_64.png
normalized_sheet_48.png
normalized_sheet_32.png
normalized_sheet_16.png
animations.json
metadata.json
editor_metadata.json
debug_report.json
Row GIF previews
character_pack.zip
godot_npc_pack.zip
rpgmaker_pack.zip
ocad_pack.zip
```

`--style-report` is opt-in. It adds `pixel_style` metrics to
`debug_report.json` without changing `normalized_sheet.png`, export ZIPs, Row
GIF previews, or any other generated image. Use `--style-max-colors` to set the
palette extraction limit for the report.

When `--background-mode auto` is used, non-alpha sources are first processed
with the normal automatic mode. If that resolves to `flood`, the pipeline also
scores an `edge_palette` candidate against the same validation metrics and keeps
the stronger result. The decision is recorded in
`debug_report.json.background_selection`. Explicit `--background-mode flood` or
`--background-mode edge_palette` still forces that mode.

`flood` fallbacks and `edge_palette` also apply local matte cleanup before alpha
cleanup. The flood path uses the flood color plus detected edge colors as the
background palette, removes edge-adjacent residue just outside the flood
tolerance, then lightly decontaminates retained edge pixels toward nearby
foreground colors. These defaults are recorded in `background_options`.

## Benchmark Local Images

Use this provider-free benchmark when live image APIs are unavailable. It reads
only the controlled manifest, not every file in the fixture directory.

```bash
npm run character-pack -- benchmark local-images \
  --output-dir generated/local-image-benchmarks \
  --run-id local_image_check \
  --gate-layer local-golden
```

Default manifest:

```text
test/fixtures/character-pack/local-image-golden/manifest.json
```

Useful options:

```text
--manifest <manifest.json>
--id <sample-id>
--kind single_character
--kind topdown_sheet
--kind ocad_sheet
--kind bad_case
--background-mode auto
--background-sweep
--background-sweep-mode auto
--background-sweep-mode flood
--background-sweep-mode edge_palette
--background-sweep-mode passthrough
--background-tolerance 24
--style-max-colors 16
--downsample-factor 2
--disable-outline
--disable-visual-previews
--gate-layer smoke
--gate-layer local-golden
--gate-layer release
```

Gate layers:

- `smoke`: fast provider-free sanity check. Empty sample selections fail; sample
  warnings remain warnings. Use `npm run quality:smoke`.
- `local-golden`: default controlled local-image regression gate. This supports
  provider-free quality claims only. Use `npm run quality:local-golden`.
- `release`: stricter provider-free gate for publish-before-merge checks.
  Manifest warnings and sample warnings block the gate. Use
  `npm run quality:release`.
- `live`: quota-spending provider gate. Do not use it with
  `benchmark local-images`; live gates must run through explicit live benchmark
  commands with quota consent.

Every local-image report writes `gate_layer` and `quality_gate`. The quality
gate defines the pass/warning/fail interpretation and the claim boundary for
that run, so release notes can cite provider-free evidence without implying live
model quality.
Open `local_image_benchmark.html` for the visual gallery: it shows run mode,
gate checks, per-sample status, before/after previews, warnings, blocking
errors, and key metrics in one deterministic run directory. For release notes,
cite the exact `quality:release` run id, sample count, quality gate status, and
the HTML/JSON report paths.

The command writes:

```text
local_image_benchmark.json
local_image_benchmark.md
local_image_benchmark.html
visuals/*_background_before_after.png
```

`--background-sweep` keeps the primary run intact, then adds compact background
diagnostics for each sample using `auto`, `flood`, `edge_palette`, and
`passthrough`. Use repeated `--background-sweep-mode` flags to compare a custom
mode subset. Sheet sample reports also include
`processing.background_selection` when the primary run used automatic
background selection.

By default, each analyzed sample also writes a compact before/after preview in
`visuals/`. The left pane is the loaded source on a checkerboard; the right pane
is the background-cleaned or normalized output used by the benchmark. Use
`--disable-visual-previews` for report-only runs.

`test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png` is a legacy process
fixture and is excluded from this local-image gate unless someone explicitly
adds it to the new manifest.

Validate the manifest without running image scoring:

```bash
npm run character-pack -- benchmark local-images-validate
```

Add one local image safely:

```bash
npm run character-pack -- benchmark local-images-add \
  --input /absolute/path/to/image.png \
  --id single_warrior_concept \
  --kind single_character \
  --profile quality_character_v0 \
  --source-rights user_provided_for_repository_test_use \
  --expected-check baseline_quality \
  --notes "clean single-character source"
```

The add command copies the single explicit input file into the controlled
fixture directory, corrects the destination extension based on the encoded image
format, records dimensions and SHA-256, and refuses duplicate sample ids.
`--source-rights` must be repository-safe and publishable for test use, such as
`original`, `test_generated`, `generated_by_ai_from_template`, `cc0`,
`public_domain`, `user_provided_for_repository_test_use`, or
`user_provided_with_repository_test_rights`.

## Generate Prompt Dry Run

Use this when checking prompt contracts without spending provider quota:

```bash
npm run character-pack -- generate \
  --description "blue wizard" \
  --dry-run-prompt \
  --output-dir generated/cli \
  --job-id cli_prompt
```

Without `--preset`, generation defaults to `fixed_region_motion_v0`. Pass `--preset topdown_rpg_v0` only when intentionally testing the 8x8 generation path or user-provided topdown layout behavior. Historical `ocad_motion_v0` inputs remain readable as a legacy alias.

Quality single-character prompt dry run:

```bash
npm run character-pack -- generate \
  --description "silver swordswoman" \
  --t2i-mode quality_character_v0 \
  --character-preset rpg_humanoid_v0 \
  --prompt-field outfit="blue cloak and gold shoulder armor" \
  --dry-run-prompt
```

This writes:

```text
prompt.txt
generation.json
```

## Scene Tile Prompt Dry Run

Use this when checking the v0.4 tile source-sheet prompt contract without
spending provider quota:

```bash
npm run character-pack -- scene tile-prompt \
  --description "mossy cliff path" \
  --dry-run-prompt \
  --output-dir generated/cli \
  --job-id scene_tile_prompt
```

This writes:

```text
prompt.txt
generation.json
```

The command is provider-free. It does not generate tile art yet.

## Scene Tile Live Smoke

Use this for live v0.4 scene tile generation smoke. It spends provider quota
and refuses to run unless `--yes` and `--max-provider-calls` are present:

```bash
npm run character-pack -- scene tile-generate \
  --description "mossy cliff path" \
  --output-dir generated/cli \
  --job-id scene_tile_generate_smoke \
  --identifier generated_scene \
  --width 6 \
  --height 4 \
  --pattern island \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --candidate-count 1 \
  --max-provider-calls 1 \
  --yes
```

Optional provider selection:

```bash
--provider-preset openrouter-default
```

Each scene tile candidate consumes one provider call. For multi-candidate runs,
set `--max-provider-calls` at least as high as `--candidate-count`.

Optional local edge conditioning after provider image normalization:

```bash
--edge-condition --edge-band 3 --edge-condition-mode edge-aware-v1
```

Optional local palette snapping before validation:

```bash
--style-snap --style-max-colors 16
```

This writes the provider prompt and metadata, then validates the generated
source sheet through the same ingestion/export path. If the provider returns a
larger square canvas, the live smoke records the original size in
`generation.json.postprocess` and nearest-neighbor resizes it to the profile's
`192x192` source size before validation:

```text
prompt.txt
generation.json
scene.json
tile_atlas.json
tile_map.json
quality_gate.json
style_correction.json (optional)
edge_conditioning.json (optional)
tile_conditioning_review.json (optional)
tile_conditioning_review.png (optional)
project.ldtk
tileset.png
scene_pack.zip
```

Treat the smoke as successful only when the CLI returns `status: "done"` and
`quality_gate.status: "pass"`. A failed quality gate still writes diagnostics for
inspection.

## Scene Tile Sheet Ingest

Use this when you already have a real `topdown_tile_dual_grid_v0` source sheet
and want preview/export artifacts without provider quota:

```bash
npm run character-pack -- scene tile-ingest \
  --input tileset.png \
  --output-dir generated/cli \
  --job-id scene_tile_ingest \
  --identifier uploaded_scene \
  --width 6 \
  --height 4 \
  --pattern island
```

The input must be a `192x192` padded source sheet: `4x4` cells, each `48x48`,
with the central `32x32` runtime tile inside `8px` padding.

Use `--pattern rule --seed 12 --density 0.45` for deterministic rule-based
dual-grid arrangement instead of the fixed `island` / `path` / `solid`
patterns.

To run the opt-in local seam repair before validation:

```bash
npm run character-pack -- scene tile-ingest \
  --input generated/cli/scene_tile_live_smoke_v02_20260605_02/tileset.png \
  --output-dir generated/cli \
  --job-id scene_tile_edge_condition_v02_20260605_02 \
  --identifier conditioned_scene_v02_02 \
  --width 6 \
  --height 4 \
  --pattern island \
  --edge-condition \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1
```

This is provider-free. It writes a conditioned `tileset.png`,
`edge_conditioning.json`, `tile_conditioning_review.json`,
`tile_conditioning_review.png`, and a normal `quality_gate.json` for comparison
against the raw run. The default mode is `edge_aware_conditioning_v1`; pass
`--edge-condition-mode global-v0` only when reproducing the first prototype.

To run opt-in palette snapping before validation:

```bash
npm run character-pack -- scene tile-ingest \
  --input tileset.png \
  --output-dir generated/cli \
  --job-id scene_tile_style_snap \
  --identifier style_snap_scene \
  --width 6 \
  --height 4 \
  --pattern island \
  --style-snap \
  --style-max-colors 16
```

This is provider-free. It writes `style_correction.json`, attaches the same
report to `quality_gate.json.style_correction`, and writes `tileset.png` from
the corrected source sheet.

To compare raw, palette-snapped, and palette-snapped-plus-edge-conditioned
variants from the same source sheet:

```bash
npm run character-pack -- benchmark scene-tile-correction-matrix \
  --input tileset.png \
  --id uploaded_scene \
  --output-dir generated/scene-tile-correction-matrix \
  --run-id uploaded_scene_correction_matrix \
  --width 3 \
  --height 3 \
  --pattern rule \
  --seed 7 \
  --density 0.55 \
  --raw-tile-policy strict \
  --style-max-colors 16 \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1
```

This is provider-free. It writes one standard scene artifact directory per
variant plus `scene_tile_correction_matrix.json` and a normal
`scene_tile_report.json` with `summary.correction_dependency`.

This writes:

```text
scene.json
tile_atlas.json
tile_map.json
quality_gate.json
style_correction.json (only with --style-snap)
edge_conditioning.json (only with --edge-condition)
tile_conditioning_review.json (only with --edge-condition)
tile_conditioning_review.png (only with --edge-condition)
project.ldtk
tileset.png
scene_pack.zip
```

## Build A Project Pack

Combine an existing character artifact directory and scene artifact directory:

```bash
npm run character-pack -- project pack \
  --character-dir generated/cli/hero_pack \
  --scene-dir generated/cli/scene_pack \
  --output-dir generated/cli \
  --job-id project_pack \
  --project-id demo_project
```

The command writes `project_manifest.json`, `project_validation.json`, and
`project_pack.zip`. The ZIP keeps child artifacts under `character/` and
`scene/`, and preserves `character_pack.zip` plus `scene_pack.zip` for
standalone import paths.

## Live Generation

Live generation may spend API credits and requires both `--yes` and
`--max-provider-calls`. For a healthy primary route, set the max to the intended
candidate count; raise it only when you intentionally allow fallback retries.

```bash
npm run character-pack -- generate \
  --description "blue wizard" \
  --image-size 2K \
  --candidate-count 1 \
  --background-mode auto \
  --max-provider-calls 1 \
  --yes
```

By default, text-to-image generation uses `production_sheet_v0`: it generates
one candidate, scores it after sheet validation, and writes normal release
artifacts only if `generation_release_gate_v1` passes. With multiple candidates,
`selected_index` remains the best diagnostic score while
`release_selected_index` is the only publication choice.

Quality-character live generation writes single-image artifacts instead of a
sprite sheet:

```bash
npm run character-pack -- generate \
  --description "jade healer" \
  --t2i-mode quality_character_v0 \
  --character-preset two_to_one_character_v0 \
  --candidate-count 1 \
  --image-size 2K \
  --max-provider-calls 1 \
  --yes
```

This writes `source.png`, `t2i_result.png`, `candidate_<n>.png`,
`t2i_report.json`, `generation.json`, `prompt.txt`, and `t2i_pack.zip`.

For either mode, treat only `status: "done"` plus `release_ready: true` as a
releasable live generation. If the CLI returns `failed_quality_gate`, inspect
`generation_release_gate.json`, the reported candidate selection, and retained
diagnostic images. Quality Character retains all `candidate_<n>.png` files;
Production Sheet retains the selected diagnostic source/result plus the
candidate report, not every generated candidate image.
`artifact_disposition: "diagnostic_only"` means no
Character/T2I ZIP or engine pack is written. This state is not a Provider error
and does not trigger another call. `failed_model_error` remains the Provider,
route, or budget failure class; `failed_post_processing` remains a local
processing/writer exception.

Treat `--job-id` as a unique, single-use identifier within `--output-dir`. The
artifact writer fails if that directory already exists and leaves the existing
run untouched; choose a new job ID instead of reusing a previous release or
diagnostic directory.

Optional reference inputs:

```text
--reference-image reference.png
--palette-image palette.png
--provider-preset openrouter-default
--disable-template
--style-report
--style-max-colors 16
--seed 123
--temperature 1.1
--top-p 0.8
--top-k 32
```

Provider and model configuration:

The simplest local setup is to fill provider-specific keys plus an optional
default provider/model in `.env` or your shell:

```bash
CHARACTER_IMAGE_PROVIDER=openrouter
OPENROUTER_API_KEY=...
CHARACTER_IMAGE_MODEL=google/gemini-2.5-flash-image
```

or:

```bash
CHARACTER_IMAGE_PROVIDER=gemini
GEMINI_API_KEY=...
CHARACTER_IMAGE_MODEL=gemini-3.1-flash-image-preview
```

`CHARACTER_IMAGE_API_KEY` can be used for a single local default key, but it
must stay server-side. `/api/gemini-state` returns provider id, model,
availability, and image config only; it does not return raw keys. If
`CHARACTER_IMAGE_PROVIDER` is omitted and only `GEMINI_API_KEY` is configured,
the default route becomes native Gemini. Supported provider types are
`openrouter` and `gemini`; unknown provider values produce a configuration
error instead of silently changing provider.

For multiple choices, use `CHARACTER_PROVIDER_PRESETS` with key names rather
than raw keys:

```bash
CHARACTER_DEFAULT_PROVIDER=gemini-native
CHARACTER_PROVIDER_PRESETS='[
  {"id":"openrouter-default","label":"OpenRouter default","provider":"openrouter","apiKeyEnv":"OPENROUTER_API_KEY","model":"google/gemini-2.5-flash-image","image_size":"2K"},
  {"id":"gemini-native","label":"Gemini native","provider":"gemini","apiKeyEnv":"GEMINI_API_KEY","model":"gemini-3.1-flash-image-preview","image_size":"2K"}
]'
```

Provider fallback:

When `--provider-preset` is omitted, generation uses the configured default
provider first and then falls back to the next available configured preset if
that route fails. By default fallback stays inside the same provider family, so
an OpenRouter route cannot silently consume native Gemini quota. Set
`CHARACTER_ALLOW_CROSS_PROVIDER_FALLBACK=1` to opt into cross-provider fallback.
Successful generations record sanitized `provider_attempts` in
`generation.json` and candidate-selection metadata. Passing `--provider-preset
<id>` disables fallback and keeps the run pinned to that exact preset.

## Benchmarks

OpenRouter benchmark:

```bash
npm run character-pack -- benchmark openrouter \
  --sample-size 1 \
  --variants 1 \
  --image-size 2K \
  --yes
```

The generic OpenRouter benchmark also defaults to `fixed_region_motion_v0`. Use `--preset topdown_rpg_v0` for focused topdown repair or prompt-regression work.

Text-to-image golden benchmark dry-run plan:

```bash
npm run character-pack -- benchmark t2i-golden \
  --dry-run-plan \
  --sample-size 5 \
  --candidate-count 4
```

The dry-run plan reports `planned_provider_calls` and sanitized
`provider_config` with selected provider type, preset id, model, availability,
and image config. It does not expose raw API keys. For live runs, set
`--max-provider-calls` at or above the planned call count.

Live quality-character golden benchmark:

```bash
npm run character-pack -- benchmark t2i-golden \
  --sample-size 20 \
  --candidate-count 4 \
  --t2i-mode quality_character_v0 \
  --image-size 2K \
  --max-provider-calls 80 \
  --yes
```

The live benchmark records per-case raw images, finished images, candidate
PNGs, prompt text, generation metadata, candidate-selection scores, and the
provider call budget actually used. Reports also include top-level
`provider_config`, `generation_options`, and `failure_taxonomy` so model/config
variants can be compared without changing the golden case set. The cap counts
every real provider attempt, including fallback retries.
If all candidates fail for a case, the benchmark writes a partial report and
stops by default after that first failed case. Increase `--max-case-failures`
only when intentionally collecting more provider-failure evidence.
If the provider returns a route or terms-policy block, the failed item is
recorded as `provider_route_blocked` with `retry_hint:
switch_provider_preset` and `failure_taxonomy: provider.route_blocked`; do not
raise candidate count for that provider route. Switch provider preset or
credentials before rerunning the live gate. Treat live reports as evidence for
the exact provider/model/options/sample size only, not as broad quality claims.

Offline review of an existing text-to-image golden run:

```bash
npm run character-pack -- benchmark t2i-golden-review \
  --run-dir generated/t2i-golden-benchmarks/<run_id>
```

The review command is provider-free. It reads only the explicit run/report,
checks recorded artifacts, and writes:

- `t2i_golden_review.json`
- `t2i_golden_review.md`
- `t2i_golden_review.html`

The JSON and Markdown include `closure_analysis.priority_actions`, a P0/P1/P2
technical queue that separates provider/artifact reliability, prompt-scale
contract issues, pixel-finishing calibration, and candidate-selection/sampling.
Use that queue to choose the next text-to-image change before spending another
live benchmark budget.

Optional thresholds:

```text
--usable-score 615
--warning-score 600
--target-usable-rate 0.8
--min-visible-pixels 1000
--min-unique-colors 8
--max-palette-change 0.7
--max-outline-ratio 0.08
--max-visible-pixels 220000
--max-bbox-width-ratio 0.72
--max-bbox-height-ratio 0.86
--max-bbox-area-ratio 0.42
--max-center-offset-ratio 0.1
--min-edge-margin-ratio 0.035
```

Recompute an existing OpenRouter benchmark report without provider quota:

```bash
npm run character-pack -- benchmark openrouter-recompute-report \
  --report generated/openrouter-benchmarks/<run_id>/benchmark_report.json \
  --output-dir generated/openrouter-benchmarks \
  --run-id <run_id>_recomputed
```

Use this after benchmark taxonomy, quality-gate, or Markdown report logic changes. It reads only the provided `benchmark_report.json`, recomputes summary and `quality_gate` from stored items, and writes a new report directory without mutating the historical run.

Processed sample benchmark:

```bash
npm run character-pack -- benchmark processed \
  --root-dir generated \
  --limit 30
```

## Safety

- The CLI does not accept API keys directly; configure `.env`.
- Live text-to-image generation refuses to run without `--yes` and
  `--max-provider-calls`.
- Live OpenRouter benchmarks refuse to run without `--yes`.
- Use `--dry-run-prompt` for prompt inspection and provider-free tests.
