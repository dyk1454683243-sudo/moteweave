# Sprite Tool Research Notes

## Purpose

This document captures neutral research notes about browser-first sprite utility patterns that are useful for implementation, but too detailed for the main protocol spec. The protocol spec should define the asset contract. This file can hold implementation references and workflow comparisons.

## Sprite Sheet Split And GIF Assembly

FrameRonin's public site and repository show a practical browser-first approach for sprite sheet utilities:

- Split a sheet by rows and columns with Canvas `drawImage`.
- Calculate cumulative integer split boundaries from the full width and height so non-divisible source dimensions do not drop pixels.
- Optionally detect transparent row or column gaps and split loose sprite regions.
- Export split PNG frames as ZIP files.
- Assemble selected frames or each row into GIF previews.
- Decode GIFs into frames when needed.
- Allow manual frame selection, row preview, and re-ordering as workflow helpers.

Reference component names for organizational inspiration only, not real paths in this repository:

```text
SpriteSheetTool     sheet -> split frames / row GIF preview
GifFrameConverter  GIF -> frames, frames -> GIF, multiple images -> one sheet
SpriteSheetAdjust  split preview, selected frames, animation preview
```

Dependency policy:

```text
v0.1 dependencies:
  gifenc     GIF encoding
  jszip      ZIP export
  Canvas     slicing, composing, ImageData extraction; browser native

v0.1 optional if GIF import is implemented:
  gifuct-js  GIF decoding

reserved for later; do not bundle in the first upload pipeline:
  image-q    palette and pixel color tooling
  opencv-js  advanced image processing; large browser bundle
```

GIF preview pattern:

```text
frame canvas list
-> ImageData list
-> palette quantization
-> indexed pixels
-> gifenc frame writes
-> Blob URL preview
-> optional ZIP of all row GIFs
```

GIF decode pattern:

```text
GIF file
-> gifuct-js parseGIF
-> decompressFrames
-> composite disposal frames onto a full canvas
-> PNG frame export
```

Adopt the workflow, not the exact UI:

```text
source or normalized sheet
-> grid slice
-> frame list
-> selectable animation rows
-> browser preview
-> optional GIF preview
-> ZIP export with PNG + JSON metadata
```

Important distinction:

Frame splitting and GIF assembly do not solve character drift by themselves. They assume that the sheet is already correctly aligned. Our pipeline must normalize anchor, baseline, scale, and cross-cell bleed before using the split/GIF utility path.

Use fixed profile metadata before transparent-gap auto-detection when the user selected a known character template. Transparent-gap splitting is useful as a recovery or helper tool, but a production character pack should still export a deterministic grid and animation index.

## Cell Geometry Adjustment

FrameRonin also has useful expand and shrink style tools. The important behavior is cell-level geometry repair, not AI image outpainting:

```text
source sheet
-> split by N x M cells
-> crop from each cell center to a requested cell width/height
-> if a source cell is smaller than the requested output cell, center it and fill the rest with transparency
-> recompose the sheet
```

This is useful for:

- Increasing per-frame canvas size before slicing when weapons or effects need extra room.
- Shrinking oversized source cells into a tighter game profile.
- Converting a loose AI sheet into a deterministic cell size.
- Adding transparent padding between frames without changing the character pixels.
- Creating manual recovery tools when an automatic profile guess is wrong.

Automation should use this as a repair stage with explicit policy:

```text
if source cells are too tight:
  expand each authoring cell to a larger transparent cell

if source cells are too large but content is safe:
  center-crop each source cell to the requested authoring cell

if final export is required:
  normalize from authoring cell to profile cell with anchor rules
```

Do not use center-crop as the main alignment strategy for playable output. Center-crop is only geometry repair. Final playable frames still need bottom-center anchor normalization and baseline validation.

## Youth/RM Plugin ZIP Review

Reviewed locally on 2026-06-18 from a user-supplied ZIP at:

```text
<npc-plugin-zip>
```

Read-only findings:

- The package is a Godot `AI资源库` plugin plus sample NPC resources.
- It includes local resource-library scanning, NPC JSON validation, card
  previews, scene drag-in, dialogue/shop/runtime helpers, and protagonist
  wiring.
- It includes a local `252 x 252` fixed-region slicer for one-image motion
  sheets and a separate `144 x 192` RPG Maker slicer.
- One reviewed sample named like a Gemini workflow contains a `252 x 252` RGBA
  `sprite.png`, which supports the interpretation that external AI may produce
  the raw fixed-region source image while the plugin consumes it locally.
- The package review did not reveal a provider-side strict-template generation
  algorithm, model-control method, benchmark gate, candidate-selection report,
  halo gate, or source-action-motion quality gate.
- GitHub API license lookup for the related public repository returned no
  license file during review, so do not copy source, bundled assets, templates,
  or UI text into this repository.

Implication for this project:

- Keep learning from the broad workflow shape: raw AI source image -> local
  fixed-region slicing -> preview/runtime/export.
- Use neutral internal naming such as `fixed_region_motion_v0` for our own
  source layout instead of adjacent tool names.
- Add source-level quality gates for real provider outputs before making new
  claims about Gemini/API character-sheet reliability.
