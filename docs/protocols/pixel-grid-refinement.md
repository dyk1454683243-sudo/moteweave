# Pixel Grid Refinement

**Date:** 2026-07-06
**Status:** Active; v1 implemented, v2 focused guarded-verified
**Scope:** Local, deterministic layer that converts near-pixel-art RGBA frames into grid-perfect, palette-locked pixel art. Serves all three character tracks (provider generation, upload processing, motion source) plus scene/tileset outputs later.

## Why

AI-generated "pixel art" is usually fake pixel art: antialiased edges, drifting palettes, and pixel clusters that do not sit on one grid. Today the pipeline guesses (`downsampleFactor: 2` in quality finishing) instead of measuring. Frame sequences are worse: each frame quantizes independently, so animations flicker in color and grid phase.

This layer makes pixel-perfection a deterministic guarantee instead of a model behavior:

- detect the real pixel grid (cell size + offset) from the image itself,
- lock one shared palette across all frames of a sequence,
- snap every cell to one dominant color on the shared grid,
- harden alpha to 1-bit,
- report everything, and refuse to force-snap when no reliable grid exists.

Zero provider calls. Pure CPU. Deterministic and idempotent.

## Claim Boundary

- This is refinement of near-pixel-art inputs, not photo-to-pixel-art stylization. Photo-like inputs must degrade to an explicit `no_reliable_grid` passthrough, never a forced ugly snap.
- Readability hand-tuning at very small sizes (16 px) is out of scope; the layer preserves what the source has, it does not invent limb readability.
- Algorithms are re-implemented from public technique descriptions (run-length grid estimation, FFT periodicity, shared-palette-across-frames). No external code is copied. Add `ATTRIBUTIONS.md` entries for the behavior research sources (perfectPixel, proper-pixel-art, perfectpixel-studio) per Rule 5.

## Module

New file: `src/character-pack/pixelGridRefinement.js`

Naming note: the repo already has an unrelated `src/pixelPipeline.js` (scene prompt presets). Do NOT reuse that name or place this module at top level. `character-pack` is the established shared home (`motion-source` and t2i already import `imageCodec`, `normalizer`, `stylePipeline` from it).

### Reuse map (do not rewrite these)

| Need | Existing function | Path |
|---|---|---|
| palette extraction | `extractPalette(image, { maxColors, alphaThreshold })` | `src/character-pack/stylePipeline.js` |
| palette snap semantics | nearest locked-palette color; v2 keeps one palette-index buffer so distance is evaluated once per visible pixel | this module |
| nearest downsample | `downsampleNearest(image, { factor })` | same |
| drift measurement | `measureStyleDrift(image, { palette })` | same |
| style report | `buildPixelStyleReport(image, { maxColors })` | same |
| RGBA codec | `loadRgba` / `encodeRgbaPng` | `src/character-pack/imageCodec.js` |
| bbox | `detectAlphaBBox` | `src/character-pack/normalizer.js` |

### New API

```js
// 1. Grid detection (the genuinely new algorithm)
detectPixelGrid(image, {
  minCell = 2, maxCell = 32,
  alphaThreshold = 8,
} = {})
// -> {
//   cell_size: 6 | null,
//   offset: { x: 2, y: 2 },
//   confidence: 0.0..1.0,
//   method: 'run_length_mode' | 'autocorrelation' | 'none',
//   candidates: [{ cell_size, score }],   // top 3, for the report
// }

// 2. Shared palette across a frame sequence (the anti-flicker key)
buildSharedPalette(frames, {
  maxColors = 16,
  sampleLimit = 12,       // sample first/last + evenly spaced middles
  alphaThreshold = 8,
} = {})
// -> { colors: [[r,g,b],...], sampled_frame_count, source_color_count }

// 3. Single-frame refinement against a locked grid + palette
refinePixelFrame(image, {
  grid,                    // from detectPixelGrid (required)
  palette,                 // from buildSharedPalette (required)
  alphaHardenThreshold = 128,
  emptyCellCoverage = 0.5, // cell alpha coverage below this -> fully transparent
  emitLogical = true,      // also emit 1px-per-cell logical image
})
// -> { image, logicalImage|null, report }

// 4. Sequence orchestrator (what the tracks actually call)
refinePixelFrames(frames, {
  recipe: 'pixel_grid_v1_compat',
    // or pixel_grid_v2_balanced / pixel_grid_v2_detail_safe /
    // pixel_grid_v2_oklab
  maxColors = 16,
  minConfidence = 0.6,     // below this: passthrough + warning, no snap
  ...gridOptions
})
// -> {
//   status: 'refined' | 'passthrough_no_grid' |
//           'passthrough_refinement_budget',
//   frames,                // refined (or untouched on passthrough)
//   logicalFrames|null,
//   grid, palette,
//   report,                // see Report
// }

// 5. Sequence grid consensus (v2)
detectPixelGridSequence(frames, {
  minCell = 2,
  maxCell = 32,
  sampleLimit = 12,
  harmonicRejection = true,
})
// -> cell/phase consensus + support + harmonic/frame evidence

// 6. Cancellable sequence path used by Motion Source
await refinePixelFramesAsync(frames, {
  ...recipeOptions,
  signal,
})
```

### Algorithm v1

**Grid detection — `run_length_mode`:**
1. Collect same-color run lengths along all rows and all columns (colors compared after coarse quantization, step 8; runs shorter than `minCell` and longer than `maxCell` ignored; fully transparent spans skipped).
2. For each candidate cell size `c` in `[minCell, maxCell]`, score = share of run lengths that are integer multiples of `c` (weight by run length). Take the mode; ties prefer larger `c`.
3. Offset search: for `dx, dy` in `[0, c)`, score alignment by how much color variance falls strictly inside cells vs across cell boundaries; pick the offset minimizing intra-cell variance.
4. Confidence = winning score, normalized. `< minConfidence` → `method: 'none'`, orchestrator returns `passthrough_no_grid`.

The implemented v1 includes an autocorrelation fallback (FFT-free: direct
shifted-difference autocorrelation) for inputs whose antialiasing defeats
run-length voting.

**Shared palette:** pool visible pixels from sampled frames, run the pooled pixels through `extractPalette` semantics once, return the locked color list. Every frame is then snapped with `snapToPalette` against this same list — identical palette per frame **by construction**, which is the no-flicker guarantee.

**Cell consolidation:** for each grid cell (at detected offset; partial edge cells included), harden alpha (`>= alphaHardenThreshold` → 255 else 0), then take the alpha-weighted dominant palette color among the cell's visible pixels and fill the cell uniformly. Coverage below `emptyCellCoverage` → cell fully transparent. `emitLogical` writes the 1-pixel-per-cell image alongside the display-scale image.

**Idempotence:** refined output re-entering the layer must detect the same grid and change zero pixels. This is an acceptance test, not an aspiration.

### v2 Recipe And Consensus

Legacy `true` or an option object without `recipe` remains
`pixel_grid_v1_compat`. New callers must choose one of:

- `pixel_grid_v2_balanced`;
- `pixel_grid_v2_detail_safe`;
- `pixel_grid_v2_oklab`.

v2 aggregates candidate cell sizes and circular phase across deterministic
first/last/evenly spaced frame samples. It records support ratio, per-frame
detections, phase agreement, and harmonic aliases rejected through stronger
boundary evidence. If consensus is weak, the input frames pass through
unchanged.

Balanced/detail-safe recipes protect complex source cells instead of flattening
them. The OKLab recipe changes nearest-palette distance only; palette extraction
remains the existing RGB implementation. Requested outer outlines run after
cell consolidation. The outline color is reserved inside the locked palette,
and only non-outline foreground cells can seed new outer-outline cells. This
keeps re-entry byte-idempotent even when the source already contains the same
outline color.

Safety ceilings are fixed and callers cannot raise them:

- cell size: `2..32`;
- one frame inside a multi-frame sequence: at most 1,048,576 detection pixels
  (4 MiB RGBA);
- a single-frame finishing request: at most 4,194,304 detection pixels
  (16 MiB RGBA), still under the same autocorrelation work ceiling;
- aggregate sequence detection: at most 4,194,304 sampled pixels;
- autocorrelation: at most 8,388,608 sampled comparisons per detected frame;
- palette sampling: at most 256K pixels;
- one refinement frame: at most 4,194,304 pixels;
- aggregate refinement: at most 8,388,608 pixels;
- palette distance: at most 67,108,864 color comparisons;
- aggregate refinement grid: at most 262,144 cells.

Motion uses the async sequence path, checks its `AbortSignal` between frames,
and yields between sampled detection frames as well as refinement frames so
cancellation can be observed. Run-length evidence uses a bounded length
histogram rather than retaining every run; autocorrelation increases a
deterministic sample stride when its full comparison estimate would exceed the
fixed ceiling. Exceeding a
refinement ceiling returns unchanged frames with
`passthrough_refinement_budget`; it does not partially refine the sequence.
If bounded palette sampling observes no visible source color, refinement also
passes through even when an outline color was reserved; a reserved-only palette
can never recolor the source.

### Report

```json
{
  "schema_version": 1,
  "mode": "pixel_grid_refinement_v1",
  "status": "refined",
  "grid": { "cell_size": 6, "offset": { "x": 2, "y": 2 }, "confidence": 0.91, "method": "run_length_mode" },
  "palette": { "max_colors": 16, "color_count": 11 },
  "frames": [
    { "index": 0, "changed_pixel_ratio": 0.041, "alpha_hardened_pixel_count": 210, "empty_cell_count": 388 }
  ],
  "sequence": { "frame_count": 8, "shared_palette": true, "flicker_guarantee": "palette_and_grid_locked" },
  "warnings": []
}
```

v2 uses `schema_version: 2`, `mode: "pixel_grid_refinement_v2"`, and adds:

- canonical `recipe`;
- `consensus` candidates, support, phase, per-frame detection, and rejected
  harmonic evidence;
- palette `color_distance` and bounded sample counts;
- per-frame detail-protection and outline evidence;
- canonical effective `settings` and `resource_budget` evidence;
- factual sequence `invariants` instead of expanding the v1
  `flicker_guarantee` claim.

`passthrough_no_grid` keeps original frames, sets `status`, adds warning `no_reliable_grid_detected` — that honesty rule is what keeps this layer safe to run on arbitrary uploads.

`passthrough_refinement_budget` likewise keeps the original frame objects and
records the exact exceeded pixel/comparison/cell ceiling. Motion additionally
uses `passthrough_normalization_incompatible` when source-coordinate refinement
cannot survive integer-cell, phase-aligned normalization. In that case the
final strip is rebuilt from the cleaned source frames, and the final report
must not retain `shared_grid` or outline-output claims.

## Integration points (versioned opt-in, parallel not replace)

1. **t2i quality finishing** — `finishQualityCharacterImage` in `src/character-pack/textToImageGeneration.js`: when the caller passes `pixelFinishing.gridRefinement: true`, use `detectPixelGrid` to replace the hardcoded `downsampleFactor: 2` guess (only when `confidence >= minConfidence`); attach the report next to the existing `pixel_finishing` report.
   Quality finishing caps the grid palette at 16 colors even when the wider
   finishing palette allows 32, keeping a 2048×2048 single frame within the
   fixed 64M comparison ceiling.
2. **Motion source strips** — strip building in
   `src/motion-source/stripBuilder.js`: cleanup and selection happen first; v1
   compatibility keeps normalize-then-refine ordering, while v2 refines selected
   source-coordinate frames before grid-aware normalization and strip
   composition.
3. **Upload processing / Editor Workbench** — not integrated in v2. The current
   protected `processing_recipe_v0` cannot accept this field and the existing
   Editor control remains `Coming later`. A future integration requires its own
   recipe migration contract.
4. **CLI** — expose the flag in `scripts/character-pack-cli.mjs` for the existing commands; no new top-level command needed in v1.

## Tests (`test/character-pack/pixelGridRefinement.test.js`, synthetic fixtures only)

Fixture recipe (build programmatically, no IP): draw a small logical image (e.g. 12x12, 5 colors), upscale nearest by `c` (e.g. 6), then corrupt: blur edge pixels toward neighbors (fake antialiasing), shift by `(2,2)` onto a larger canvas, add slight per-frame color noise for sequence cases.

1. **Grid recovery:** detection returns `cell_size = c`, offset `(2,2)`, `confidence >= 0.8`; refined logical image matches the ground-truth logical image on ≥ 98% of pixels.
2. **No flicker:** two corrupted frames sharing identical regions → after `refinePixelFrames`, those regions are byte-identical and both frame reports reference the same palette.
3. **Idempotence:** `refine(refine(x))` output is byte-equal to `refine(x)`.
4. **Honest degrade:** a gradient/noise image with no grid → `status: 'passthrough_no_grid'`, frames untouched, warning present.
5. **Edge cases:** fully transparent frame, 1-pixel image, cell size equal to image size — no crash, sane reports.
6. **Alpha hardening:** semi-transparent AA ring becomes 0/255 only; interior opaque pixels keep their snapped color.

## Acceptance criteria

- `npm test` green including the new suite; no changes to default behavior of any existing track (flags off).
- Deterministic: same input bytes → same output bytes, across runs.
- Zero new dependencies; zero provider calls.
- `ATTRIBUTIONS.md` updated (behavior-research entries, re-implementation noted).
- Report shape stable and consumed by at least one caller (t2i finishing or motion-source strip report).

## Phasing

- **v1:** implemented module, autocorrelation fallback, tests, Quality Character
  and Motion direct-call opt-in wiring, and CLI flag.
- **v2:** sequence consensus, harmonic rejection, detail protection, optional
  OKLab distance, outline-last, bounded work, canonical recipes, browser/server
  Motion binding, and owned synthetic benchmark.
- **Later:** processSheet/Editor recipe migration, scene/tileset integration,
  and any default-on decision after owned benchmark evidence.
