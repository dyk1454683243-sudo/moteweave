# Character Repair UI And Pixel Finishing

**Date:** 2026-06-21  
**Status:** First browser repair and preview batch implemented; finishing polish continuing
**Scope:** Character-pack quality closure after a mostly usable sprite sheet exists.

## Direction

Ship two adjacent but separate character-quality paths:

1. Character action repair UI. The browser can create a dry-run plan for one selected runtime animation, show the estimated provider cost, and only call the provider after explicit confirmation.
2. Pixel finishing. Character-pack outputs can opt into deterministic local finishing for palette, alpha edges, small components, outline, and nearest-neighbor exports.

This is not a standalone image editor, a full semantic auto-diagnosis system, or a multi-candidate replacement engine.

## Evidence Recorded

- Public FrameRonin pages describe one-click processing and fine processing, including fine-mode scaling and inner outline controls: [frameronin.com](https://frameronin.com/).
- PerfectPixel Studio documents quality layers such as background matting, frame splitting, alpha-weighted alignment, shared-palette quantization, grid snap, quality scoring, and retry closure: [perfectpixel-studio](https://github.com/gykim80/perfectpixel-studio).
- Sprite Fusion Pixel Snapper describes common AI pixel-art issues as inconsistent pixel size, grid drift, and loose palette control, and exposes grid snapping plus palette quantization: [spritefusion-pixel-snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper).
- unfake.js documents scale detection, content-aware downscaling, grid snapping, color quantization, morphological cleanup, and alpha binarization: [unfake.js](https://github.com/jenissimo/unfake.js/).
- Pixel Refiner covers automatic grid detection, anti-alias removal, background transparency, outline, palette/dither, and batch processing: [PixelRefiner](https://github.com/HappyOnigiri/PixelRefiner).
- Proper Pixel Art supports images, GIFs, and videos, and emphasizes shared mesh/palette across animation to reduce flicker: [proper-pixel-art](https://github.com/KennethJAllen/proper-pixel-art).

## Implementation Batch 1

- Add local `/api/repair-character-action` jobs that read an existing character job's `debug_report.json` and `normalized_sheet.png`. `Implemented.`
- Generate a repair manifest and provider repair loop plan for the user-selected animation. `Implemented.`
- Write dry-run artifacts: plan JSON, selected prompt, normalized sheet reference, target animation reference, optional motion-template reference, and source-sheet reference. `Implemented.`
- Require `confirm_live_generation` and `maxProviderCalls` before live repair. `Implemented.`
- Run one provider call for one action strip, apply it locally to the normalized sheet, reprocess the repaired sheet, and expose repaired strip, repaired sheet, Row GIF previews, quality report, and exports. `Implemented for the one-action workflow; still user-selected and quota-confirmed.`
- Add Pixel Finishing as an opt-in character-pack output option using existing local image primitives. `Partially implemented; metric/report polish remains next.`

## 2026-06-22 Progress Update

- Character inspection previews are now written as first-class artifacts so the browser can show review-oriented previews instead of raw source-only thumbnails.
- The action gallery now uses a fixed-zoom, centered, bottom-aligned inspection preview so small fixed-region sprites are easier to review without changing exported frame geometry.
- The workspace preview now prefers transparent inspection artifacts for fixed-region local uploads, avoiding the misleading white raw-source background in the central preview.
- Local fixed-region uploads now use staged `256 x 256` crop/matte cleanup before processing, bringing the local upload path closer to the AI generation path for background removal.
- Local upload mode now hides generation-only prompt fields; the upload path expects fixed-format source images and should not imply provider prompt behavior.
- The current repair workflow intentionally remains one selected action at a time. Multi-select repair, masked whole-sheet edit, and automatic semantic selection are future options only after the single-action loop is stable.
- A separate language surface is now planned as UI polish: Chinese/English labels through a local dictionary and a top-right switcher, without changing provider prompts or export metadata in the first pass.

## Remaining Work

- Finish Pixel Finishing reporting for unique color count, palette change ratio, halo/residue, outline ratio, grid/scale notes, and before/after evidence.
- Keep comparing local upload and AI generation preprocessing so both paths use the same cleanup stages whenever the input contract allows it.
- Add optional preview controls only if user review still needs them after the fixed-zoom gallery and transparent workspace preview.
- Do not add automatic facing/action judgment until there is a reliable, testable semantic signal; user confirmation remains the safety boundary.

## Acceptance

- Dry-run plan returns selected animation, selected frames, provider preset, image config, and estimated provider calls.
- Live repair fails clearly when the selected provider preset has no configured key.
- Live mock-provider repair produces fetchable repaired strip, validation report, normalized sheet, Row GIFs, and ZIP export.
- Pixel Finishing records unique color count, palette change ratio, alpha cleanup, halo/residue, small-component cleanup, outline ratio, grid notes, and nearest-neighbor scale notes.
- Existing upload and AI generation paths remain active and still render real pipeline outputs.

## Boundaries

- Use only neutral implementation names such as action repair, repair plan, and pixel finishing.
- Do not use adjacent-product names as module names, API names, product names, generated identifiers, README claims, or UI branding.
- Do not copy external source code, web bundles, templates, model weights, commercial assets, or private provider behavior.
- Reuse only public technical patterns that can be implemented from this repository's own image-processing modules and documented provider APIs.
- Do not auto-detect semantic facing/action correctness in the first batch; the user selects the action to repair.
- Do not automatically replace multiple actions or mix candidates without user confirmation.

## Test Plan

- `git diff --check`
- `node --test test/character-pack/qualityClosureProviderRepairLoop.test.js`
- `node --test test/character-pack/characterActionRepairApi.test.js`
- `node --test test/character-pack/stylePipeline.test.js`
- `node --test test/character-pack/processSheet.test.js`
- `node --test test/character-pack/cli.test.js`
- UI smoke for the existing Character Pack upload/generation surfaces where provider access permits it.
