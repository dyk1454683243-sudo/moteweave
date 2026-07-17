# Generation Quality Closure v0.3 Design

## Goal

Turn the first real-generation failures into a repeatable quality loop: stricter prompt contracts, machine-readable failure taxonomy, benchmark summaries, and local UI evidence.

The previous v0.3 observability block made prompts and benchmark artifacts inspectable. This block uses that data to answer a sharper question:

```text
When a generation fails, did the model violate layout, leave required frames blank, crop the character, lose motion, dirty the background, or fail in the provider/pipeline?
```

## Product Outcome

The user should be able to run a small benchmark, open the local gallery, and see:

- Which prompt contract version was used.
- Whether the result respected the selected template layout.
- Which failure family explains the result.
- Which raw validator messages support that classification.
- Whether the failure is a prompt/layout issue, a post-processing issue, or a provider issue.

This is still an internal production workflow, not a public scoring leaderboard.

## Scope

### In Scope

- Upgrade prompt contracts from `character_prompt_contract_v1` to `character_prompt_contract_v1_1`.
- Add explicit non-empty, full-body, no-crop, padding, edge-pressure, and template-priority expectations.
- Keep `topdown_rpg_v0` and `ocad_motion_v0` wording isolated so 8x8 runtime rows and OCAD fixed-region source actions do not cross-contaminate.
- Add a shared failure taxonomy module for validator, processor, OpenRouter benchmark, and processed-sample benchmark reporting.
- Preserve raw `warnings` and `blocking_errors` while adding summarized taxonomy buckets.
- Surface taxonomy in benchmark report JSON, benchmark markdown, and local benchmark gallery cards.
- Run focused tests, full tests, and a small real benchmark gate when credentials are available.

### Out Of Scope

- Automatic per-frame repair, inpainting, or regeneration.
- New asset extraction from arbitrary uploaded sheets.
- Provider/model ranking UI.
- Training, LoRA, embeddings, or dataset scraping.
- Public cloud benchmark publishing.

## Architecture

### Prompt Contract v1.1

`src/character-pack/promptContracts.js` remains the only place where provider-facing layout wording is assembled.

The v1.1 contract adds layout-completeness expectations to metadata:

```text
no_empty_cells
no_blank_or_near_blank_cells
no_cropped_or_edge_cut_character
full_body_visible_in_every_cell
minimum_character_occupancy_per_cell
maximum_edge_pressure_per_cell
consistent_cell_scale
consistent_cell_padding
no_partial_body_closeups
layout_template_has_priority_over_reference_images
reference_images_must_not_override_layout
```

Topdown wording is about equal cells and 64 required poses. OCAD wording is about a single 252x252 fixed-region source sheet and required regions. Both share the same intent, but not the same layout vocabulary.

### Failure Taxonomy

Add a focused module:

```text
src/character-pack/failureTaxonomy.js
  classifyValidationMessages()
  classifyBenchmarkItem()
  summarizeFailureTaxonomy()
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

Each classification keeps examples, counts, and severity. This lets reports show stable categories while still preserving raw validator messages.

### Benchmark Reporting

OpenRouter benchmark items should include:

```json
{
  "failure_taxonomy": {
    "primary": "structure.empty_frame",
    "severity": "error",
    "categories": [
      { "id": "structure.empty_frame", "count": 1, "severity": "error", "examples": ["frame_6_empty"] }
    ]
  }
}
```

The summary should include top taxonomy categories next to existing `top_warnings` and `top_blocking_errors`.

### Gallery

The local benchmark gallery should pass through `failure_taxonomy` from reports and render compact category badges on each item card. The gallery remains a reader; it should not compute or mutate benchmark artifacts.

## Acceptance Criteria

- Prompt contract metadata reports `character_prompt_contract_v1_1`.
- Topdown provider prompts explicitly require all 64 equal cells to contain complete, non-empty character poses.
- Topdown provider prompts reject fixed-region, variable-width, OCAD-style, and non-uniform layouts.
- OCAD provider prompts explicitly require every fixed region to contain a complete, non-empty pose.
- OCAD provider prompts reject 8x8 equal-cell subdivision, runtime rows, attack rows, hurt rows, and 64 uniform frames.
- Provider image guidance states that the written layout contract and structural template override reference and palette images.
- Failure taxonomy maps `frame_N_empty`, `frame_N_cropped`, `frame_count_mismatch`, low motion, drift, halo, edge pressure, source-region pressure, model errors, post-processing errors, and unexpected pipeline errors.
- Processor debug reports include `validation.failure_taxonomy`.
- OpenRouter benchmark items and summary include taxonomy data without removing existing raw warning/error counts.
- Processed-sample benchmark uses the shared taxonomy instead of maintaining a separate substring-only classifier.
- Local benchmark gallery displays taxonomy badges when present.
- Focused tests and `npm test` pass.
- A small real benchmark run is recorded in a decision note when provider credentials are available.

## Commit Strategy

Use coherent checkpoints:

1. `docs: plan generation quality closure`
2. `feat: harden prompt contract quality rules`
3. `feat: add character failure taxonomy`
4. `feat: show benchmark failure taxonomy`
5. `docs: record generation quality benchmark gate`

If implementation naturally combines adjacent slices, commit only after focused tests for the combined slice pass.
