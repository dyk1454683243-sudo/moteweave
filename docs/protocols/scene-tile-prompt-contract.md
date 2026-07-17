# Scene Tile Prompt Contract Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 Scene Tile Prompt Dry Run

## Purpose

The scene tile prompt contract defines the provider-facing instructions for the
first padded dual-grid tile source sheet. The dry-run command inspects this
contract without spending provider quota; the guarded live smoke command reuses
the same contract before routing the provider image through tile sheet ingestion.

## Module

```text
src/scene-pack/tilePromptContracts.js
```

Public entry points:

```text
buildSceneTilePromptContract({ description, profile })
compileSceneTilePromptContract(contract)
summarizeSceneTilePromptContract(contract)
```

## Contract

The current contract version is:

```text
scene_tile_prompt_contract_v0_6
```

It locks:

- `topdown_tile_dual_grid_v0`,
- 192x192 source sheet,
- 4 columns by 4 rows,
- exactly 16 source cells,
- 48x48 source cells,
- 8 px padding on every side,
- central 32x32 runtime tile area,
- row-major dual-grid mask order `0-15`,
- visual seam-ready compatible edges,
- self-loop-ready repeated tiles,
- loopable outer border bands in every runtime tile,
- shared edge-signature continuity across compatible masks,
- raw tile structure as independent reusable cells,
- source atlas layout as an inventory sheet rather than a map,
- true `192x192` PNG source-sheet output,
- no visible mask coordinates, row labels, column labels, or legends,
- shared terrain palette/style.

`scene_tile_prompt_contract_v0_6` keeps the v0_5 raw inventory rules and adds
handoff hardening after the first external manual re-test returned
JPEG-encoded `1024x1024` files with `.png` names. The compiled provider prompt
now avoids visible mask-placement coordinate lists, because those can encourage
the model to draw labels into the image. Mask order remains in metadata for the
pipeline, while the image prompt focuses on the tile inventory structure,
seam/self-loop rules, and the final `192x192` PNG output contract.

## Validation Expectations

```text
exact_16_tile_dual_grid_atlas
source_padding_preserved
central_runtime_tile_area_clear
row_major_mask_order_0_15
visual_seam_ready_edges
self_loop_ready_tiles
loopable_runtime_border_bands
shared_edge_signature_continuity
raw_tile_structure_independent_cells
source_atlas_not_single_scene
source_cells_independent_after_shuffle
no_cross_cell_terrain_continuity
self_loop_edges_visible_in_each_tile
no_atlas_scale_composition
edge_signature_motifs_repeated_not_continued
self_loop_edges_have_no_unique_marks
true_png_192_source_sheet
no_preview_scale_or_jpeg_encoded_png
no_visible_mask_coordinates_or_labels
shared_style_palette
no_characters_text_ui_or_watermarks
```

## Raw Structure Rules

The compiled provider prompt requires:

- each central `32x32` runtime tile to read as a complete standalone tile,
- the `4x4` atlas to behave as a tile inventory sheet, not a map screenshot,
- no paths, rivers, cliffs, shadows, or texture strokes painted across
  source-cell boundaries,
- no large terrain shapes that only make sense when the surrounding atlas cells
  are visible,
- each tile must still read correctly if the atlas cells are shuffled,
- source-cell borders are layout dividers, not world-space edges,
- large terrain motifs must stay inside one runtime tile unless repeated by
  edge signature across compatible masks,
- no gradients, lighting, camera depth, or composition across atlas rows or
  columns,
- no road, river, cliff, shadow, highlight, or texture band may rely on adjacent
  source cells to finish its shape.
- no visible mask-placement map, row labels, column labels, coordinates, or
  legends in the image.

## Seam Rules

The compiled provider prompt requires:

- every central `32x32` runtime tile to reserve an outer `3 px` border band for
  seamless tiling,
- first and last pixel columns to be visually compatible for horizontal repeats,
- first and last pixel rows to be visually compatible for vertical repeats,
- tiles with the same edge signature to use the same terrain material, color
  ramp, texture density, and transition shape on the shared edge,
- every tile to visibly prove self-loop readiness: north repeats against south,
  west repeats against east, and no unique edge mark reveals the repeat,
- edge motifs must repeat on every tile with the same compatible edge signature
  instead of continuing a unique line across the atlas,
- opposite borders must not carry unique edge marks, corners, or color jumps
  that reveal a self-loop repeat,
- cells to behave as one tile system, not separate mini-scenes.

## Output Contract

The compiled provider prompt requires:

- a true PNG image file,
- exactly `192x192` pixels,
- no `1024x1024`, `1K`, or preview-scale export,
- no JPEG image data saved with a `.png` filename,
- no preview frame, page border, annotations, labels, or extra whitespace.

## CLI Dry Run

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

The dry-run command is provider-free.

## CLI Live Smoke

```bash
npm run character-pack -- scene tile-generate \
  --description "mossy cliff path" \
  --output-dir generated/cli \
  --job-id scene_tile_generate_smoke \
  --image-size 1K \
  --aspect-ratio 1:1 \
  --yes
```

This command spends provider quota and refuses to run without `--yes`. It writes
the prompt and generation metadata, validates the returned `192x192` source
sheet, and emits the normal scene pack artifacts.

## Non-Goals

- No template image upload.
- No prompt A/B benchmark.
- No scene preview or map editor.

## Verification

```bash
node --test test/scene-pack/tilePromptContracts.test.js
node --test test/scene-pack/tileGenerate.test.js
node --test test/character-pack/cli.test.js
```
