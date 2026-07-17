# Scene Tile Distinctness Gate

**Date:** 2026-06-06
**Status:** Recorded

## Context

The scene tile quality gate already checked metadata seams, visual seams,
self-loops, source-atlas continuity, and palette/style drift. A map can still
look deceptively healthy if different dual-grid masks resolve to the same
runtime tile image: seams pass, but the tileset has not produced useful visual
variety for arrangement.

Before WFC or map-editor work, the gate needs to identify this false confidence.

## Change

Added warning-only `tile_distinctness`:

- compares runtime tile images for the unique masks referenced by the current
  tile map,
- reports duplicate or near-duplicate pairs using average per-pixel channel
  delta,
- adds taxonomy warning `tile.duplicate_runtime_tile`.

The first version checks referenced masks only. It does not inspect unused atlas
masks when the current preview map does not place them.

## Decision

Keep distinctness warning-only for now.

Reasons:

- live provider thresholds are not calibrated yet,
- duplicate masks are quality debt, but not always an export blocker,
- warning-only output gives benchmark reports enough signal to decide whether
  prompt work, tile profile work, or arrangement work should come next.

## Verification

```bash
node --test test/scene-pack/tileQualityGate.test.js test/scene-pack/tileSheetIngestion.test.js test/scene-pack/tileGenerate.test.js test/character-pack/cli.test.js
```
