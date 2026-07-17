# Pixel Style Pipeline Protocol

**Status:** Draft
**Owner:** Character pack pipeline
**Introduced:** v0.4 Phase 0

## Purpose

The pixel style pipeline provides local, provider-free measurements and
transform primitives before scene and tile generation starts. Tile outputs make
palette drift, blurry scale changes, weak outlines, and edge seams much more
visible than a single character sheet, so v0.4 begins with this lower-level
style layer.

The first implementation is report-only or opt-in. It must not change existing
character-pack images or export archives by default.

## Primitives

`src/character-pack/stylePipeline.js` owns the provider-free primitives:

```text
extractPalette(image, { maxColors, alphaThreshold })
snapToPalette(image, { palette, alphaThreshold })
downsampleNearest(image, { factor })
measureStyleDrift(image, { palette, alphaThreshold })
applyPixelStyleCorrection(image, { mode, palette, maxColors, alphaThreshold })
buildPixelStyleReport(image, { maxColors, alphaThreshold })
```

Rules:

- `extractPalette()` reads visible pixels and returns deterministic colors with
  RGB, hex, count, and ratio fields.
- `snapToPalette()` returns a new RGBA image and leaves transparent pixels
  untouched.
- `downsampleNearest()` only accepts positive integer factors and requires image
  dimensions divisible by the factor.
- `measureStyleDrift()` reports nearest-palette distance metrics without
  mutating pixels.
- `applyPixelStyleCorrection()` is opt-in. The first supported mode is
  `palette_snap`, which returns a corrected image plus before/after metrics and
  mutation counts.
- `buildPixelStyleReport()` is the process/debug-report entry point.

## Opt-In Correction Report

Scene tile ingestion and live generation may opt into palette snapping. The
default remains no mutation.

```json
{
  "mode": "palette_snap",
  "output_mutation": "palette_snap",
  "palette": {
    "source": "extracted",
    "max_colors": 16,
    "colors": []
  },
  "metrics": {
    "before": {},
    "after": {}
  },
  "changed_pixel_count": 128,
  "changed_pixel_ratio": 0.0313
}
```

When no visible palette can be produced, the correction report uses
`output_mutation: "none"` and returns a cloned image unchanged.

## Debug Report Shape

When enabled, `debug_report.json` includes:

```json
{
  "pixel_style": {
    "mode": "report_only",
    "output_mutation": "none",
    "palette": {
      "max_colors": 16,
      "colors": [
        {
          "hex": "#102030",
          "rgb": [16, 32, 48],
          "count": 12,
          "ratio": 0.0833
        }
      ]
    },
    "metrics": {
      "mode": "report_only",
      "visible_pixel_count": 100,
      "unique_color_count": 20,
      "palette_color_count": 16,
      "off_palette_pixel_count": 4,
      "off_palette_ratio": 0.04,
      "average_nearest_palette_distance": 1.25,
      "max_nearest_palette_distance": 8
    }
  }
}
```

If the image has no visible pixels, `metrics` is `null`.

## CLI Contract

Process and generate flows can opt into the report:

```bash
npm run character-pack -- process \
  --input test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png \
  --output-dir generated/cli \
  --job-id cli_style_report \
  --style-report \
  --style-max-colors 16
```

The default behavior remains unchanged when `--style-report` is omitted.

## Non-Goals

- No default palette snapping.
- No automatic outline strengthening.
- No palette reference file comparison.
- No tile profile, map arrangement, or export behavior.
- No provider prompt changes.

These remain v0.4 follow-up work after the report-only layer is covered by
tests and can be interpreted safely.

## Verification

Changes to this protocol should be covered by:

```bash
node --test test/character-pack/stylePipeline.test.js
node --test test/character-pack/processSheet.test.js
node --test test/character-pack/cli.test.js
```
