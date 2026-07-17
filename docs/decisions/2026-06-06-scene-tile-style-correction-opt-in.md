# Scene Tile Style Correction Opt-In

**Date:** 2026-06-06
**Status:** Recorded

## Context

v0.4 Phase 0 introduced provider-free pixel style primitives and report-only
style drift metrics. Scene tile work now needs a controlled path from measuring
style drift to correcting obvious palette noise, but default mutation would make
quality regressions harder to interpret while raw tile structure is still being
stabilized.

## Change

Added opt-in palette snapping for scene tile ingestion and live generation:

- `applyPixelStyleCorrection(image, { mode: "palette_snap" })`,
- CLI flag `--style-snap`,
- shared `--style-max-colors` support for extracted palettes,
- `style_correction.json` scene pack artifact,
- `quality_gate.json.style_correction`,
- `generation.json.style_correction` for live scene tile generation.

The correction runs before edge conditioning and before scene tile quality
validation. The written `tileset.png` reflects the final corrected pixels.

## Decision

Keep palette snapping opt-in.

Reasons:

- raw tile structure and seam/self-loop quality still need clear unmutated
  evidence,
- palette snapping can help tile consistency, but it is not a semantic repair,
- mutation counts and before/after drift metrics should be reviewed before any
  default correction is considered,
- character-pack `--style-report` remains report-only unless a future decision
  explicitly changes default output behavior.

## Verification

```bash
node --test test/character-pack/stylePipeline.test.js test/scene-pack/artifactWriter.test.js test/scene-pack/tileGenerate.test.js test/character-pack/cli.test.js
```
