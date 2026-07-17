# Scene Tile Live Generation Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 Scene Tile Live Smoke

## Purpose

Scene tile live generation is the quota-spending path for v0.4 scene tiles. It
asks the configured image provider for one or more
`topdown_tile_dual_grid_v0` padded source sheet candidates, then routes every
candidate through tile sheet ingestion and the scene tile quality gate. The best
candidate is selected and written through the normal LDtk export and scene pack
artifact path.

This path is evidence, not a broad quality claim. It proves the live provider,
prompt contract, PNG decoding, source-sheet validation, quality gate, candidate
selection, and export writer can work as one chain.

## Module

```text
src/scene-pack/tileGenerate.js
```

Public entry point:

```text
generateSceneTilePack({ description, providerPresetId, imageConfig, candidateCount, width, height, pattern, edgeConditioning })
```

## Provider Contract

The module reuses `scene_tile_prompt_contract_v0_3` from
`tilePromptContracts.js` and sends a text-only image-generation request through
the configured provider preset.

Default output expectations:

```text
aspect_ratio: 1:1
image_size: provider preset default or CLI --image-size
output image: square PNG-compatible source sheet
profile: topdown_tile_dual_grid_v0
```

Missing API keys and unavailable `fetch` are reported as `failed_model_error`
with `manual_inspect` retry guidance. Provider responses without image data are
also model errors.

If the provider returns a different canvas size than the profile source sheet,
the live smoke records the provider source dimensions and nearest-neighbor
resizes the image to the profile's exact `192x192` source size before ingestion.
This keeps the first gate focused on source-layout compliance without requiring
the provider API to support arbitrary small image dimensions.

## CLI

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
  --max-provider-calls 1 \
  --yes
```

`--yes` and `--max-provider-calls` are mandatory because the command may spend
provider quota. For a single generation, set the max at or above
`candidateCount`. Benchmark live gates require the max at or above the dry-run
`estimated_provider_calls`; candidate count is multiplied by case count.

Optional candidate count:

```bash
--candidate-count 4
```

`candidateCount` defaults to `1` and is capped at `8`. Each candidate consumes
one provider request. The selected candidate is exported as the top-level scene
pack, and every candidate keeps local evidence under
`candidates/candidate_XX/`.

Benchmark dry-run example:

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --dry-run-plan \
  --sample-size 5 \
  --candidate-count 4 \
  --raw-tile-policy strict
```

The dry-run response and `live_gate_plan.json` include sanitized
`provider_config`: provider type, model, selected preset id, availability, and
image config. They do not expose raw API keys.

Benchmark live example:

```bash
npm run character-pack -- benchmark scene-tile-live-gate \
  --sample-size 5 \
  --candidate-count 4 \
  --raw-tile-policy strict \
  --max-provider-calls 20 \
  --yes
```

When recovering from provider route or quota blockers, use
`docs/runbooks/scene-tile-strict-gate-readiness.md` before rerunning the full
5-case, 4-candidate strict gate.

`--pattern rule --seed <n> --density <0-1>` uses the deterministic
`rule_based_dual_grid_v0` arrangement after the provider image is accepted.

Optional local seam repair after provider image normalization:

```bash
--edge-condition --edge-band 3 --edge-condition-mode edge-aware-v1
```

Optional local palette snapping before seam repair and validation:

```bash
--style-snap --style-max-colors 16
```

Optional raw tile inventory enforcement:

```bash
--raw-tile-policy strict
```

When style snapping is enabled, the normalized source sheet is palette-snapped
first. When edge conditioning is also enabled, the corrected sheet is
edge-conditioned before tile sheet ingestion. The written `tileset.png`,
`quality_gate.json`, and `generation.json` all describe the final pixels sent to
ingestion. Ordinary live generation defaults to raw tile policy `warn` so users
can inspect near-misses; `benchmark scene-tile-live-gate` defaults to
`strict`, which makes duplicate referenced runtime masks and continuous-source
atlas structure block release/live evidence.

## Output

Successful runs write:

```text
prompt.txt
generation.json
candidate_selection.json
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
candidates/candidate_01/tileset.png
candidates/candidate_01/quality_gate.json
candidates/candidate_01/generation.json
```

If the provider route fails before an image is returned, live benchmark runs
write diagnostic evidence instead of a scene report:

```text
live_gate_plan.json
live_gate_blocker.json
live_gate_review.json
live_gate_review.md
```

`live_gate_blocker.json` records `scene_tile_live_gate_blocker_v0`, the
provider blocker category, sanitized provider config, case ids, estimated
provider calls, provider-call budget, image config, scene options, and the
provider error message. It is a provider-access record, not scene tile quality
evidence. It also records `recovery_runbook` so the next run can resume through
the bounded provider-readiness flow.

`live_gate_review.json` records `scene_tile_live_gate_review_v0` for blocked
runs. It makes the evidence boundary explicit: selected candidate distribution,
failed candidate taxonomy, duplicate/source-atlas/seam/self-loop signals, and
style-snap/edge-conditioning effects are unavailable when the provider is
blocked before image generation. It also records that LDtk auto-layer and WFC or
rule-arrangement expansion are not decision-ready from that run, plus the
`recovery_runbook` to follow after provider route or quota changes.

`generation.json` records:

- provider and provider preset id,
- model,
- image config,
- candidate count and selected candidate id,
- raw tile gate policy,
- provider image postprocess source/output size,
- optional style-correction report,
- optional edge-conditioning report,
- optional tile-conditioning visual review report,
- raw source-atlas structure warnings in `quality_gate.json` when the provider
  draws a continuous scene across source-cell boundaries, or strict failures
  when a release/live gate enables strict raw tile policy,
- prompt contract summary,
- candidate selection summary,
- prompt file,
- generated source file.

`candidate_selection.json` records candidate count, selected candidate id and
index, selected quality status, selection reason, ranked candidate scores, and
each candidate's warnings, blocking errors, and failure taxonomy.

Scene tile reports also include `summary.correction_dependency`. This records
how much of the sample used local correction, style-snap changed-pixel ratios,
edge-conditioning changed-pixel ratios, tile-conditioning review status, and
signals such as heavy palette mutation or visible edge-conditioning mutation.
Use this summary to decide whether the next block should reduce raw-output
correction dependency before WFC, LDtk auto-layer rules, or map-editor work.

For provider-free raw-vs-corrected comparison, use:

```bash
npm run character-pack -- benchmark scene-tile-correction-matrix \
  --input tileset.png \
  --id mossy_forest \
  --raw-tile-policy strict
```

The matrix runs the same source sheet through `raw`, `style_snap`, and
`style_snap_edge_aware` variants. It writes standard scene pack artifacts for
every variant plus `scene_tile_correction_matrix.json`,
`scene_tile_correction_matrix.md`, `scene_tile_report.json`, and
`scene_tile_report.md`. Its summary includes `raw_quality_readiness`,
`raw_quality_diagnostics`, variant validation, `gate_transitions`,
`blocker_taxonomy_by_variant`, and `blocker_transitions` so raw-output quality
work can target the gates that local correction is currently masking.
`raw_quality_diagnostics` records per-sample visual seam, self-loop,
source-atlas continuity, and duplicate runtime tile counts plus the worst raw
seam/self-loop examples.

For manual external model runs, write the standard five-case prompt pack without
calling a provider:

```bash
npm run character-pack -- benchmark scene-tile-manual-prompts \
  --output-dir generated/scene-tile-manual-prompts \
  --run-id gemini_manual_scene_tile_prompt_v06_20260617 \
  --input-dir /tmp/scene-tile-gemini-v06-sheets \
  --sample-size 5
```

This writes `manual_prompt_pack.json`, `manual_handoff.md`, plus one
`prompt.txt` and `generation.json` per case. Each case records an
`expected_input_filename` and `expected_input_file`; save the returned model
images as true `192x192` PNGs with those filenames before running the manual
retest helper.

To check whether the expected manual images are present and run the v0.6 matrix
when they are ready, use:

```bash
npm run character-pack -- benchmark scene-tile-manual-retest \
  --input-dir /tmp/scene-tile-gemini-v06-sheets \
  --output-dir generated/scene-tile-correction-matrix \
  --run-id gemini_manual_scene_tile_v06_raw_quality_20260617 \
  --sample-size 5
```

If any input image is missing, the command returns `status: "missing_inputs"`
and writes `manual_retest_status.json`. If any present input is not a true PNG
or is not exactly `192x192`, the command returns `status: "invalid_inputs"`
with `actual_format`, `actual_size`, and blocking errors before running the
matrix. If all inputs are valid, it writes the normal correction matrix and
exposes `raw_quality_readiness` plus `raw_quality_diagnostics` in stdout.

Selection order is deterministic:

1. `pass` beats `warning`, which beats `fail`.
2. Fewer blocking errors.
3. Fewer warnings.
4. Fewer visual seam failures.
5. Fewer self-loop failures.
6. Fewer duplicate referenced runtime tile pairs.
7. Fewer continuous source-atlas boundaries.
8. Lower max visual/self-loop edge deltas.
9. Earlier candidate index as final tie-break.

The provider image is stored as `tileset.png` because it is the accepted source
atlas consumed by the export pipeline.

## Pass Criteria

A live smoke passes only when:

- at least one provider candidate returns an image,
- each accepted image decodes as PNG-compatible RGBA,
- source-sheet validation accepts the exact padded profile size for the selected
  candidate,
- optional edge conditioning has been applied before artifact writing when
  requested,
- the selected scene tile quality gate returns `status: "pass"`,
- artifact writing returns `status: "done"`.

If the quality gate fails, artifacts are still written for inspection and the
CLI returns `failed_quality_gate`.

## Non-Goals

- No broad benchmark claim from candidate selection alone.
- No prompt A/B matrix.
- No semantic image repair or inpainting.
- No WFC or map editor orchestration.
- No automatic palette correction.
- No character-pack Row GIF validation.

## Verification

```bash
node --test test/scene-pack/tileGenerate.test.js
node --test test/scene-pack/artifactWriter.test.js
node --test test/scene-pack/sceneTileLiveGate.test.js
node --test test/scene-pack/sceneTileReport.test.js
node --test test/character-pack/cli.test.js
```
