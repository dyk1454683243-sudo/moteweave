---
name: generate-terrain-tiles
description: >-
  Generates clean, text-free, 16-bit 4x4 dual-grid terrain tiles based on a specific theme using a standardized structure.
---

# Generate Terrain Tiles

## Overview
This skill generates structured dual-grid terrain tile sheets (4x4 layout, 192x192 resolution) suitable for auto-tiling setups. It specifically ensures that the generated images do not contain characters, weapons, or errant text labels—a common failure mode when AI attempts to draw map layouts. It supports batch generation and user-review workflows.

## Dependencies
None.

## Quick Start
User: "Generate a dual-grid terrain tile sheet for a dark volcanic path."
Agent: "I'll use the `generate-terrain-tiles` skill to generate that without any UI overlays or text."

## Workflow

### 1. Identify Themes
Determine the terrain theme(s) the user wants to generate (e.g., "mossy forest", "dry rocky cliff"). If the user asks for multiple themes, prepare to generate them concurrently.

### 2. Format the Prompt
For each theme, replace `{SUBJECT}` in the following strictly tested base prompt. **Do not modify the structural instructions of this prompt, and do NOT add positional mask references (like `mask 0 row 0 column 0`) as they cause the model to mistakenly draw text labels.**

**Base Prompt:**
> A precise pixel art terrain tile source sheet of: {SUBJECT}.
> Profile: topdown_tile_dual_grid_v0.
> Canvas: square 1:1. exactly 192x192 pixels.
> Use exactly 4 columns by 4 rows with exactly 16 source cells total.
> Each source cell represents a 48x48 cell with 8 px padding on every side.
> Only the central 32x32 area of each cell is runtime tile art.
> This is a tile inventory sheet, not a map screenshot.
> Each central runtime tile must read as a complete standalone reusable tile.
> Do not paint paths, rivers, cliffs, shadows, roots, or texture strokes across source-cell boundaries.
> Do not create one continuous scene sliced into cells.
> Every runtime tile must be self-loop ready: repeating the same tile horizontally or vertically should not create a visible hard seam.
> Keep the outer 3 px border band of each runtime tile simple, continuous, and loopable.
> Style: Clean 16-bit topdown pixel art terrain. Consistent palette, outline weight, texture density, lighting direction, and pixel density across every tile. No blur, no painterly gradients, no antialias-heavy rendering.
> Negative rules: Do not draw characters, creatures, portraits, weapons, props, text, letters, alphabets, labels, UI, borders, frame numbers, watermarks, or decorative callouts. Do not draw a completed map, room, scene, perspective illustration, or single large painting. Do not add grid lines, captions, legends, or mask numbers inside the image. Only output the tile source sheet image.

### 3. Generate Image(s)
Call your `generate_image` tool using the formatted prompt. Run concurrently if multiple themes were requested.

### 4. Self-Correction & Error Handling
After generation, review the output if possible. If the image obviously contains letters (e.g., TL, TR, A, B) or breaks the 4x4 grid by drawing a single continuous scene, **discard the result silently and run the generation again**.

### 5. Create Review Document
Do not show raw paths. Create an artifact file (e.g., `terrain_preview.md`) using your `write_to_file` tool to embed all generated images into a single markdown preview document. Set `RequestFeedback: true` so the user can perform a one-time visual inspection of the entire batch.

## Common Mistakes
- **Adding explicit coordinate mappings to the prompt**: Attempting to help the AI by specifying "mask 0 is at row 0 column 0" almost always causes the AI to draw those text labels literally into the image. Stick to the base prompt.
- **Skipping the unified review**: Do not just spit out the image URLs in chat. Create a clean artifact report so the user can easily view the 16-cell grids together.
- **Mimicking a named game's assets**: Keep `{SUBJECT}` a generic terrain description ("mossy forest", "dark volcanic path"). Do not target a specific copyrighted game's tileset or recognizable assets (e.g. "Zelda overworld", "Stardew Valley farm"). If any generated sheet is later ingested into a committed tileset/evidence set, the same `AGENTS.md` Rule 3 applies: original or public-domain only, and a user-authorized named-IP image must stay local and gitignored.
