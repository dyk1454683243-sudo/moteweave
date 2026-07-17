# Scene Tile Rule-Based Arrangement

**Date:** 2026-06-06
**Status:** Recorded

## Context

v0.4 already had LDtk export and deterministic preview patterns. Full WFC is
still premature because generated tile art is not yet consistently clean, but
the project needs a better arrangement path than fixed `island`, `path`, and
`solid` masks.

## Change

Added `rule_based_dual_grid_v0`:

- generates a seeded shared corner grid,
- converts corners into dual-grid masks,
- returns a normal tile map with arrangement metadata,
- integrates with scene preview, tile ingestion, API options, CLI options, and
  existing LDtk/scene pack exports.

Because every mask is derived from one shared corner grid, metadata seams are
valid by construction.

## Decision

Use this as the first arrangement solver before full WFC.

Reasons:

- deterministic seed/density parameters make results reproducible,
- the solver is small enough to audit and test,
- it exercises LDtk and scene-pack export paths without hiding tile-art quality
  problems behind a larger algorithm,
- full WFC can still be added later once raw tile quality is stronger.

## Verification

```bash
node --test test/scene-pack/tileArrangement.test.js test/scene-pack/scenePreview.test.js test/scene-pack/tileSheetIngestion.test.js test/character-pack/cli.test.js test/localSmokeScript.test.js
npm test
```
