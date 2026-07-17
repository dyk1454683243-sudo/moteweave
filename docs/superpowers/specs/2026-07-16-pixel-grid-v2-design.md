# Pixel Grid Refinement v2 Design

**Date:** 2026-07-16
**Status:** Implementation authorized by the project lead
**Owner:** Project lead
**Target surface:** Provider-free character finishing and Motion Source strip refinement

## 1. Decision Summary

Pixel Grid v2 upgrades the existing opt-in deterministic refinement layer. It
does not replace passthrough, add a Provider call, or make arbitrary images into
pixel art. The feature remains disabled unless a caller chooses a versioned
recipe.

The v2 unit delivers:

1. sequence-wide cell-size and phase consensus instead of choosing one best
   frame;
2. explicit harmonic-alias rejection before consolidation;
3. detail protection for cells whose source evidence is too complex to flatten;
4. an optional OKLab palette-distance path;
5. one outline-last ordering rule for grid-refined output;
6. stable recipe ids, report evidence, CLI options, and one real Motion Source
   UI binding.

## 2. Source Of Truth And Lineage

Normative sources:

- `docs/superpowers/plans/2026-07-16-character-production-quality-master-plan.md`
- `docs/protocols/pixel-grid-refinement.md`
- `src/character-pack/pixelGridRefinement.js`
- `test/character-pack/pixelGridRefinement.test.js`

The implementation baseline is
`d7b1cd2fdb9fbe9d09c45efa1c44adbb3293b872` on
`codex/frame-repair-live-quality-gate`.

Lineage audit:

- prior Pixel Grid implementation commit `a00b80c` is an ancestor of the
  baseline;
- prior Motion Source entry, preview, set-apply, and B safety work are inherited;
- the older `codex/motion-source-frame-selection-quality` head is not an
  ancestor, but the relevant selector/test files are byte-equivalent to the
  current baseline, so no cherry-pick or manual port is required;
- the exclusive Frame Repair implementation worktree is not a source or target
  for this unit.

No external UI, code, algorithm implementation, prompt, or asset is copied.
OKLab math is re-implemented from the public color-space definition and
documented in `ATTRIBUTIONS.md`.

## 3. Goals

1. Select one explainable grid for a sampled sequence.
2. Reject integer-multiple/divisor aliases when boundary evidence identifies a
   better fundamental grid.
3. Preserve source detail rather than flattening ambiguous high-entropy cells.
4. Make RGB versus OKLab palette matching explicit and deterministic.
5. Apply any requested outer outline after grid consolidation.
6. Preserve byte-for-byte passthrough when no reliable sequence grid exists.
7. Keep the entire feature opt-in and provider-free.

## 4. Non-Goals

- Photo-to-pixel-art stylization.
- Learned/semantic detail classification.
- Default-on mutation of upload, generation, or Motion Source output.
- Provider calls, adaptive candidates, or repair retries.
- Scene/tileset integration in this unit.
- A broad Character Pack UI redesign.
- Guided Motion Source workflow changes; those belong to E.

## 5. Versioned Recipes

The canonical recipe ids are:

| Recipe id | Consensus | Harmonic rejection | Detail protection | Palette distance | Outline |
| --- | --- | --- | --- | --- | --- |
| `pixel_grid_v1_compat` | best sampled frame | off | off | RGB | caller-owned legacy order |
| `pixel_grid_v2_balanced` | sequence | on | balanced | RGB | after refinement when requested |
| `pixel_grid_v2_detail_safe` | sequence | on | conservative | RGB | after refinement when requested |
| `pixel_grid_v2_oklab` | sequence | on | conservative | OKLab | after refinement when requested |

Passing an option object without `recipe`, or passing legacy `true`, selects
`pixel_grid_v1_compat`. New UI/CLI paths send an explicit v2 recipe. Passing
`false` or the UI value `disabled` performs no refinement. This preserves
existing opt-in behavior while making v2 adoption explicit; default product
behavior remains unchanged.

Recipe resolution is canonical and fail-closed. Unknown ids return a controlled
`invalid_pixel_grid_recipe` error.

## 6. Sequence Consensus

`detectPixelGridSequence(frames, options)` samples first, last, and evenly
spaced middle frames using the existing deterministic sample rule. A recipe
caps cell size at 32, each frame inside a multi-frame sequence at 1,048,576
detection pixels (4 MiB RGBA), aggregate sequence detection at 4,194,304
sampled pixels, and palette sampling at 256K pixels. A single-frame finishing
request may use up to 4,194,304 detection pixels while retaining the same
autocorrelation work ceiling.

Run-length evidence is accumulated in a bounded length histogram. The
autocorrelation fallback has a fixed 8,388,608-comparison ceiling per detected
frame and raises its deterministic X/Y sample stride when the full comparison
estimate is larger.

For every sampled frame it records:

- single-frame detection confidence and method;
- candidate cell size, offset, source score, offset score, extent-fit score,
  and boundary-contrast score;
- visible-pixel weight.

Candidates are grouped by cell size. The sequence score combines:

- mean candidate score;
- sampled-frame support ratio;
- mean boundary contrast;
- phase agreement.

For the selected cell size, the sequence offset is the confidence-weighted
circular phase mode for X and Y. The report retains every sampled frame's
detected phase and distance from consensus.

If no cell size reaches `minSequenceSupport` and `minConfidence`, the
orchestrator returns `passthrough_no_grid`, leaves input frame objects untouched,
and emits `no_reliable_grid_detected` plus
`insufficient_sequence_grid_support` when support is the failing condition.

## 7. Harmonic Rejection

Two candidates are harmonic relatives when one positive integer cell size
divides the other. Candidates close enough to the top sequence score form the
harmonic review set.

Within that set, stronger mean boundary contrast wins because true cell
boundaries should carry more color/alpha change than subcell boundaries inside
uniform blocks. A rejected candidate records:

```json
{
  "cell_size": 12,
  "reason": "harmonic_alias",
  "alias_of": 6,
  "score": 0.88,
  "boundary_contrast": 0.41
}
```

This is deterministic evidence, not a semantic claim. When evidence is not
strong enough to distinguish relatives, normal sequence score ordering remains
authoritative and the report records no forced rejection.

## 8. Detail Protection

Before uniform cell fill, the refiner measures:

- visible palette-color count;
- dominant palette weight ratio;
- local color-transition density;
- hardened-alpha coverage.

A cell is protected when it meets the selected recipe's complexity threshold.
Protected cells keep their palette-snapped pixels and hardened alpha rather
than being flattened to one color. The report records protected cell count,
pixel count, and the reason `source_detail_preserved`.

The balanced recipe requires stronger complexity evidence than the detail-safe
recipe. Detail protection never invents pixels and never changes transparent
cells into visible content.

Protected-cell ratio is evidence, not a hidden whole-sequence bypass. A
detail-safe recipe remains active when many cells are protected; logical frames
are omitted and `logical_output_safe` becomes false when the protected pixels
cannot be represented by one color per logical cell.

## 9. Optional OKLab Distance

`pixel_grid_v2_oklab` converts source and palette RGB colors into OKLab for
nearest-palette comparison. Palette extraction remains the existing repository
implementation; only distance evaluation changes.

The report records `color_distance: "oklab"`. RGB remains the default. No new
dependency is added.

## 10. Outline-Last Contract

When `outlineMode: "outer"` is requested, the outer outline is computed from
the consolidated logical-cell image and then projected only into previously
empty grid cells. It does not overwrite detail-protected visible cells.

The canonical outline color is reserved inside the shared palette before
refinement. Only non-outline foreground cells can seed a new outer-outline
cell, so existing/generated outline cells never grow another ring on re-entry.
This also covers sources that already use the same outline color and palettes
that are already at `maxColors`.

Quality Character finishing passes its existing `outline` request into the grid
recipe and does not pre-outline an image that will be refined. Non-refined
finishing retains the existing order.

The report records:

```json
{
  "outline": {
    "stage": "after_refinement",
    "mode": "outer",
    "outline_cell_count": 12
  }
}
```

## 11. Report Contract

v2 emits:

```json
{
  "schema_version": 2,
  "mode": "pixel_grid_refinement_v2",
  "recipe": {
    "id": "pixel_grid_v2_balanced",
    "color_distance": "rgb",
    "detail_protection": "balanced",
    "outline_stage": "after_refinement"
  },
  "status": "refined",
  "grid": {
    "cell_size": 6,
    "offset": { "x": 2, "y": 2 },
    "confidence": 0.91,
    "method": "sequence_consensus"
  },
  "consensus": {
    "sampled_frame_count": 8,
    "supporting_frame_count": 7,
    "support_ratio": 0.875,
    "candidates": [],
    "rejected_harmonics": [],
    "frame_detections": []
  },
  "palette": {
    "max_colors": 16,
    "color_count": 11,
    "color_distance": "rgb",
    "reserved_colors": []
  },
  "settings": {
    "min_cell": 2,
    "max_cell": 32,
    "min_confidence": 0.6,
    "min_sequence_support": 0.5
  },
  "frames": [],
  "sequence": {
    "frame_count": 8,
    "shared_palette": true,
    "shared_grid": true,
    "invariants": ["shared_palette", "shared_grid"],
    "logical_output_safe": true
  },
  "outline": {
    "stage": "after_refinement",
    "mode": "none",
    "outline_cell_count": 0,
    "outline_logical_pixel_count": 0,
    "outline_pixel_count": 0
  },
  "resource_budget": {
    "status": "within_budget",
    "estimates": {},
    "limits": {},
    "violations": []
  },
  "warnings": []
}
```

`pixel_grid_v1_compat` retains the v1 report shape. Existing consumers must
continue tolerating either schema while migration is opt-in.

Resource ceilings are fixed and cannot be raised by API/UI options:

- maximum refinement frame: 4,194,304 pixels;
- maximum aggregate refinement: 8,388,608 pixels;
- maximum palette comparisons: 67,108,864;
- maximum aggregate cells: 262,144.

The implementation calculates one palette-index byte per visible source pixel
and reuses it for cell voting and protected-detail output. Motion Source uses an
async path that yields and checks `AbortSignal` between sampled detection frames
and between refinement frames. A
ceiling breach keeps the original frame objects and returns
`passthrough_refinement_budget`.

Quality Character finishing caps the Pixel Grid palette at 16 colors even when
its broader finishing palette is 32 colors. A 2048×2048 single frame therefore
stays at or below the fixed 67,108,864 color-comparison ceiling; callers cannot
raise that internal cap through the recipe object.

## 12. Motion Integration Order

Motion v2 refines source-coordinate frames after cleanup and selection but
before normalization:

```text
cleanup
-> select
-> sequence consensus/refinement on selected source frames
-> grid-aware nearest normalization
-> compose
```

Grid-aware normalization quantizes scale to an integer output cell size and
aligns placement to that normalized cell multiple without moving the sprite
above its declared bottom baseline. If a positive integer cell scale or
baseline-preserving phase cannot be satisfied, Motion rebuilds the final strip
from the cleaned source frames and reports
`passthrough_normalization_incompatible`. Source-stage evidence remains
diagnostic, but final shared-grid, outline, and per-frame-refinement claims are
removed. Attempted frame/sequence/outline evidence moves under
`pixel_grid_refinement.source_refinement`; final `frames[]` entries are
`applied: false` with zero mutation counts.

## 13. UI And Capability Contract

Design source: the current Motion Source sidebar inherited through `043ebea`,
plus this design. No external visual artifact exists.

One advanced select is added to the existing Motion Source settings:

- label: `Pixel Grid Recipe`;
- values: Disabled, v2 Balanced, v2 Detail-safe, v2 OKLab;
- default: Disabled;
- disabled while a Motion request owns the UI;
- changing the recipe invalidates the prior server-built strip and disables
  Apply until a new strip is built (an explicitly uploaded edited strip remains
  separately user-owned);
- no future or semantic controls are shown.

Parameter binding:

| UI control | Request field | Server mapping | Runtime consumer |
| --- | --- | --- | --- |
| `motion-source-pixel-grid-recipe` | `options.pixel_grid_refinement.recipe` | `buildMotionStrip.pixelGridRefinement` | `refinePixelFramesAsync` |

No other Motion Source option changes. The UI reads only real report evidence
already returned by `motion_source_report.json`; E may later present that
evidence as a guided HUD.

## 14. Owned Benchmark And Tests

The owned benchmark is a fixed, repository-owned synthetic multi-frame matrix
generated in test code:

1. stable six-pixel grid with noisy color/alpha edges;
2. one low-confidence outlier frame;
3. six/twelve-pixel harmonic ambiguity;
4. intentionally detailed cell that must not be flattened;
5. RGB versus OKLab nearest-palette divergence;
6. outline-last projection;
7. no-grid noise passthrough;
8. repeated-run determinism and outline idempotence at a full palette cap;
9. refinement-budget passthrough and active cancellation;
10. 24/32-pixel Motion recipe binding and normalization fallback truth.

No third-party images or generated artifact directories are used.

## 15. Acceptance Criteria

- Sequence consensus selects the supported cell size and circular phase.
- Harmonic aliases are rejected with stable evidence.
- Detail-safe recipes preserve the benchmark detail cell.
- OKLab is reachable only through an explicit recipe and is deterministic.
- Outline evidence proves it ran after consolidation.
- The Motion UI control maps to the real server/build/refiner path.
- Disabled remains the default and produces no behavior change.
- Existing v1 compatibility remains callable.
- Focused tests and the final guarded suite pass with zero Provider calls.
- C is committed independently before D implementation begins.
