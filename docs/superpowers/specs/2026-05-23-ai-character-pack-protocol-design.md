# AI Character Pack Protocol v0.1 Design

## Goal

Build a TopDown/RPG AI character pack workflow inside the existing browser tool.

The v0.1 result should let a user upload a Gemini/Nano Banana generated character sheet, or later generate one through a Gemini API provider, then normalize it into a standard playable browser character pack.

The first target is not a full production game editor. The first target is a reliable asset protocol and playable browser preview:

```text
character description or uploaded sheet
-> standardization pipeline
-> 96x96 frame character pack
-> animations.json
-> quality report
-> browser controllable preview
```

## Scope

### In Scope

- Add a Character Pack workflow to the current web tool.
- Support uploaded source sheets.
- Reserve an optional Gemini API generation path.
- Process every source sheet through the same pipeline.
- Normalize to the `topdown_rpg_v0` profile.
- Export `normalized_sheet.png`, `animations.json`, `metadata.json`, `debug_report.json`, `debug_overlay.png`, `onion_skin_overlay.png`, row GIF previews, and `character_pack.zip`.
- Preview the generated character in a browser playground.
- Support four explicit cardinal animation directions and basic action playback.
- Support background-removal modes including transparent passthrough, edge flood-fill, and optional dual-background matte.
- Provide manual cut-line adjustment on the source preview as the only user-facing repair affordance in v0.1.

### Out Of Scope For v0.1

- Mandatory Gemini API integration.
- Godot `.tres` export.
- Unity export.
- Equipment systems.
- Multi-NPC library management.
- Large map editing.
- Full game scene authoring.
- Diagonal direction animations such as `walk_left_down` or `walk_right_up`.
- Emitting synthetic mirrored animations from horizontal flipping in `topdown_rpg_v0` output. Runtimes still support `flip_h: true` for user-provided packs.
- 2-frame ping-pong animation generation.

Gemini API support is designed as an optional provider in v0.1. The upload path must work without Gemini.

## Product Mode

The v0.1 workflow uses route A:

```text
upload or generate source sheet
-> auto process
-> quality report
-> standard character pack
-> playable browser preview
```

This keeps the asset pipeline testable without depending on generation quality. When Gemini API is available, its output enters the same validation and normalization pipeline as uploaded sheets.

## Character Profile

Profile id:

```text
topdown_rpg_v0
```

Final asset:

```text
grid: 8 columns x 8 rows
frame size: 96x96
sheet size: 768x768
frame count: 64
anchor: bottom-center x=48 y=88
baseline: around y=88
default animation fps: 8-10
browser render scale: 2x or 3x
```

Authoring guidance:

```text
recommended authoring cell: 192x192
recommended authoring sheet: 1536x1536
```

The authoring sheet can have larger cells or non-exact dimensions. The pipeline must normalize it to the final 96x96 profile.

## Frame Layout

Each frame is indexed row-major from 0 to 63.

```text
Row 1:
col 1-4  idle_down
col 5-8  idle_up

Row 2:
col 1-4  idle_left
col 5-8  idle_right

Row 3:
col 1-4  walk_down
col 5-8  walk_up

Row 4:
col 1-4  walk_left
col 5-8  walk_right

Row 5:
col 1-4  attack_down
col 5-8  attack_up

Row 6:
col 1-4  attack_left
col 5-8  attack_right

Row 7:
col 1-4  hurt
col 5-8  happy

Row 8:
col 1-4  sit
col 5-8  talk
```

Animation names:

```text
idle_down
idle_up
idle_left
idle_right
walk_down
walk_up
walk_left
walk_right
attack_down
attack_up
attack_left
attack_right
hurt
happy
sit
talk
```

Rules:

- Every v0.1 animation occupies four cells.
- Walk cycles must show visible foot alternation when the character design allows it.
- Grounded frames should preserve the same baseline.
- Attack frames can extend body or weapon motion inside the source cell, but final normalized frames must not crop visible pixels.
- All four cardinal directions for idle, walk, and attack are drawn explicitly.
- `topdown_rpg_v0` does not use horizontal flipping to synthesize directions, because mirrored sprites often put asymmetric details such as weapon hand, hair part, or accessories on the wrong side.
- Static actions such as `hurt`, `happy`, `sit`, and `talk` still occupy four cells. The runtime may play them at a low FPS or treat them as randomized still poses when motion is subtle.

## Character Pack Directory

Each generated character receives a package directory:

```text
assets/characters/generated/{character_id}/
  source.png
  normalized_sheet.png
  animations.json
  metadata.json
  debug_report.json
  debug_overlay.png
  onion_skin_overlay.png
  character_pack.zip
  idle_down.gif
  ...
  preview.html
```

When Gemini API generation is used:

```text
  prompt.txt
  generation.json
```

Future Godot support may add:

```text
  godot_spriteframes.tres
```

Character id format:

```text
npc_YYYYMMDD_HHMMSS_slug
```

Example:

```text
npc_20260523_153012_green_priestess
```

## animations.json

`animations.json` is the runtime contract. A browser game should be able to play the character using only this file and `normalized_sheet.png`.

Example:

```json
{
  "version": "0.1",
  "profile": "topdown_rpg_v0",
  "sheet": "normalized_sheet.png",
  "frame_size": { "w": 96, "h": 96 },
  "sheet_size": { "w": 768, "h": 768 },
  "anchor": { "x": 48, "y": 88 },
  "animations": {
    "idle_down": {
      "fps": 8,
      "loop": true,
      "mode": "loop",
      "frames": [0, 1, 2, 3],
      "flip_h": false
    },
    "idle_up": {
      "fps": 8,
      "loop": true,
      "mode": "loop",
      "frames": [4, 5, 6, 7],
      "flip_h": false
    },
    "walk_down": {
      "fps": 10,
      "loop": true,
      "mode": "loop",
      "frames": [16, 17, 18, 19],
      "flip_h": false
    },
    "attack_right": {
      "fps": 12,
      "loop": false,
      "mode": "once",
      "frames": [44, 45, 46, 47],
      "flip_h": false
    },
    "hurt": {
      "fps": 6,
      "loop": false,
      "mode": "once",
      "frames": [48, 49, 50, 51],
      "flip_h": false
    }
  }
}
```

All profile animations must be present in the generated file. The implementation can generate the repeated structure from a profile definition instead of hardcoding every animation by hand.

Each animation entry supports an optional `flip_h` boolean. `topdown_rpg_v0` always sets `flip_h` to `false` because all four directions are drawn. Runtimes should still support `flip_h: true` for future profiles or user-provided packs that intentionally reuse frames by mirroring them on the x axis.

The supported `mode` values are `loop`, `once`, and `pingpong`. v0.1 does not generate `pingpong` animations, but the runtime contract reserves it for forward compatibility.

## metadata.json

`metadata.json` describes the character and generation context.

Example:

```json
{
  "version": "0.1",
  "id": "npc_20260523_153012_green_priestess",
  "name": "Green Priestess",
  "description": "A gentle green-robed priestess with a small staff",
  "created_at": "2026-05-23T15:30:12+08:00",
  "profile": "topdown_rpg_v0",
  "source": {
    "type": "upload",
    "file_name": "green_priestess_source.png"
  },
  "generation": {
    "provider": null,
    "model": null,
    "prompt_file": null
  },
  "quality": {
    "status": "pass",
    "warnings": [],
    "blocking_errors": []
  }
}
```

## debug_report.json

`debug_report.json` explains what the pipeline detected and changed.

Example:

```json
{
  "version": "0.1",
  "profile": "topdown_rpg_v0",
  "grid": {
    "columns": 8,
    "rows": 8,
    "source_cell_size": { "w": 192, "h": 192 },
    "target_cell_size": { "w": 96, "h": 96 },
    "correction": {
      "applied": false,
      "rows_corrected": [],
      "columns_corrected": [],
      "method": null
    },
    "manual_overrides": []
  },
  "background_mode": "flood",
  "validation": {
    "status": "pass",
    "frame_count": 64,
    "warnings": [],
    "blocking_errors": [],
    "dual_matte_inconsistent": false
  },
  "frames": [
    {
      "index": 0,
      "source_bbox": { "x": 74, "y": 41, "w": 44, "h": 116 },
      "normalized_bbox": { "x": 30, "y": 20, "w": 36, "h": 69 },
      "warnings": []
    }
  ]
}
```

The current v0.1 implementation reports validation issues as consolidated `warnings` and `blocking_errors` arrays. More granular fields such as `cropped_frames` or `anchor_warnings` may be added later, but consumers must already handle the consolidated arrays.

## Processing Pipeline

All source images follow the same pipeline:

```text
source image
-> image load
-> background removal
-> grid detection or profile grid config
-> optional projection correction or manual overrides
-> frame slicing
-> component cleanup
-> global scale calculation
-> anchor normalization
-> validation
-> package export, row GIF previews, and ZIP
-> browser playable preview
```

### Background Removal

Rules:

- Preserve alpha when the source image is transparent.
- For white or solid backgrounds, use flood-fill from image edges.
- Use configurable tolerance.
- Do not delete character-internal white pixels by global color replacement.
- Save a transparent intermediate for debugging when useful.
- Reserve a later `rembg` provider, but do not require it for v0.1.

The pipeline supports three background-removal modes, selected per job:

```text
passthrough:
  source is already transparent; preserve alpha and do no removal.

flood:
  single source image; remove a solid background by flood-filling from corners or edges.

dual_matte:
  two paired source images of the same character on pure white and pure black backgrounds;
  compute alpha from the per-pixel difference and reconstruct foreground color.
```

`dual_matte` is the highest-quality mode when the two sources are genuinely aligned. It is especially helpful for white hair, white clothing, translucent weapon effects, and anti-aliased silhouettes. It must not be assumed reliable for two independent image-generation calls unless the provider supports deterministic output and the two images pass a pixel-level consistency check.

If `dual_matte` consistency fails, record a `dual_matte_inconsistent` warning and fall back to `flood` on the white-background source. The Quality Report must record which background mode was used.

### Grid Slicing

Rules:

- Default to 8x8.
- If source dimensions are not divisible by 8, compute proportional boundaries with rounding.
- Preserve source cell dimensions in the debug report.
- Empty cells are blocking failures if they correspond to required animations.

The slicer runs in two passes:

```text
pass 1:
  proportional grid based on the selected profile.

pass 2:
  projection-based correction only when pass 1 produced empty cells,
  visible clipping at cell boundaries,
  or per-cell bbox height variance above 25% inside a row.
```

Pass 2 computes column and row projections from non-transparent pixels, finds local minima between expected cell centers, and uses those minima as corrected boundaries for affected rows or columns only. The corrected grid must be recorded in `debug_report.json` as `grid.correction`. If pass 2 still cannot recover a valid 64-cell grid, the slicer fails and the job is marked `failed_post_processing`.

### Component Cleanup

Rules:

- Remove small JPEG or background specks.
- Remove partial components stuck to source-cell boundaries when they are likely bleed from neighboring frames.
- Remove clear cross-frame debris.
- Keep connected components attached to the body, weapon, hair, clothing, or intended effect.
- Record cleanup decisions in `debug_report.json`.

### Normalization

Rules:

- Detect visible bbox per frame after background removal.
- Compute one global scale for the whole sheet.
- Never scale each frame independently.
- Paste every frame into 96x96 using bottom-center anchor logic.
- Use nearest-neighbor scaling.
- Disable image smoothing in canvas rendering.

## Quality Strategy

v0.1 uses a dual strategy:

```text
default auto-repair
+ quality report
+ severe failures block library import
```

Statuses:

```text
pass:
  asset can be imported and previewed.

warning:
  asset can be previewed and downloaded, but the UI highlights issues.

fail:
  asset cannot be imported into the playable character library.
  debug files remain downloadable.
```

Blocking failures:

- The source cannot be treated as 8x8 even after pass-2 grid correction and manual cut-line adjustment.
- The source produces fewer than 64 usable frames after pass-2 grid correction and any manual overrides.
- A required frame is empty.
- A normalized frame touches or crosses the output frame boundary.
- The character appears cropped after normalization.
- Cross-cell bleed is too large to safely repair.
- Required walk animations have no visible subject.

Warnings:

- Anchor x drift above 4 px.
- Baseline drift above 3 px.
- Frame padding below 4 px.
- Bbox size variance above 25% inside a single animation.
- Small cross-cell debris was automatically deleted.
- Source image is JPEG or has visible compression specks.
- Source dimensions are not divisible by 8 and were rounded.

## Browser UI

Add a new tab:

```text
角色包
```

The tab has four areas:

1. Input
2. Processing
3. Quality report
4. Playable preview

### Input Area

Modes:

```text
Upload Sheet:
  - upload PNG/JPG/WebP
  - select profile topdown_rpg_v0
  - select background mode auto / passthrough / flood / dual_matte

Gemini Generate:
  - character description
  - style preset
  - generate button
  - API state
```

The Gemini section can be present in v0.1 even when no API key is configured. In that case it should show a clear unavailable state and direct the user to upload mode.

### Processing Area

Shows:

- source image dimensions
- detected grid
- target frame size
- global scale
- output file list
- process button
- ZIP and row GIF preview links after processing

The processing canvas must support manual cut-line adjustment as a fallback when automatic grid detection produces a visibly wrong result:

- Vertical and horizontal cut lines are rendered over the source preview after pass-1 slicing.
- Each line is draggable.
- Dragging should snap to the nearest plausible low-content row or column when possible.
- A re-slice button reruns slicing using the adjusted line positions.
- Reset to auto restores the algorithm's proposal.
- Manual adjustments are recorded in `debug_report.json` as `grid.manual_overrides`.

This is the only user-facing repair surface in v0.1. Background removal, normalization, and anchor repair should remain automatic.

### Quality Report Area

Shows:

- PASS / WARNING / FAIL
- frame count check
- empty frame check
- cropping check
- anchor drift
- baseline drift
- cross-cell debris
- auto-repair log
- onion-skin overlay toggle

### Playable Preview Area

Use a lightweight topdown playground:

- dark grid or simple floor
- controllable character centered on screen
- WASD and arrow key movement
- diagonal movement input mapped to the nearest cardinal animation
- idle direction when stopped
- buttons for attack, hurt, happy, sit, talk
- current animation name
- FPS display
- debug status indicator

The debug overlay artifact must include two variants:

```text
static:
  cell boundaries, bbox, anchor point, and baseline per cell.

onion_skin:
  two-frame and four-frame overlays for every walk animation.
```

When onion-skin preview is enabled, the canvas tints frame N in red and frame N+1 in cyan and overlays both at the same anchor. Walk cycles that drift by more than 2 px should become visually obvious. This is the primary debugging signal for anchor and baseline regressions.

## OpenRouter Gemini Image Provider Contract

The frontend should treat generation as a provider and not couple the asset pipeline to a single SDK. In v0.1, Gemini image generation is routed through an OpenRouter-compatible local backend.

The implementation must route all image-generation calls through the backend. The browser must not receive the API key. The image model id must be configurable, with this default:

```text
OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image
```

Runtime configuration:

```text
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_IMAGE_SIZE=2K
OPENROUTER_IMAGE_ASPECT_RATIO=1:1
OPENROUTER_SITE_URL=http://localhost:4173
OPENROUTER_APP_NAME=AI Character Pack Tool
```

The request body sent to OpenRouter uses the chat completions API with image output enabled:

```text
modalities: ["image", "text"]
stream: false
image_config: {
  image_size,
  aspect_ratio
}
```

Provider input order:

1. Prompt text.
2. Built-in pose/action constraint template for the selected preset, if available.
3. Optional user reference image for costume, colors, silhouette, and accessories.

The first attached image is a pose/action constraint template only. It is not a style reference and not a character identity reference. The model must preserve pose logic, action timing, direction order, controllable movement semantics, sprite scale, spacing, and feet-center anchor logic while replacing the character identity. If the template contains a placeholder creature or costume, the model must not copy those visual details.

When `OPENROUTER_API_KEY` is missing, `/api/gemini-state` returns `available: false` and `implemented: true`; the UI disables generation but upload processing remains available.

Request:

```http
POST /api/generate-character
```

```json
{
  "profile": "topdown_rpg_v0",
  "description": "silver-haired swordswoman with a black cloak",
  "style": "dark fantasy rpg",
  "imageConfig": {
    "image_size": "2K",
    "aspect_ratio": "1:1"
  },
  "reference_image_base64": null
}
```

Initial response:

```json
{
  "job_id": "job_20260523_153012",
  "status": "queued"
}
```

Polling:

```http
GET /api/jobs/{job_id}
```

Complete response:

```json
{
  "status": "done",
  "source_url": "/generated/job_20260523_153012/source.png",
  "prompt_url": "/generated/job_20260523_153012/prompt.txt",
  "generation_url": "/generated/job_20260523_153012/generation.json",
  "generation": {
    "provider": "openrouter",
    "model": "google/gemini-2.5-flash-image",
    "input_images": {
      "template": true,
      "reference": false
    }
  }
}
```

The resulting `source_image_url` enters the same pipeline as uploaded sheets.

Job status enum:

```text
queued
generating
post_processing
done
failed_safety_filter
failed_model_error
failed_post_processing
```

Failure semantics:

- `failed_safety_filter`: the image model declined the prompt. Surface the original model message and suggest editing the character description.
- `failed_model_error`: the image model returned an HTTP or SDK error. Retry up to two times with the same prompt and seed before marking failed.
- `failed_post_processing`: an image was produced, but the pipeline rejected it because of missing frames, empty cells, unrecoverable anchor drift, or cross-cell bleed.

Polling responses for failed states must include:

```json
{
  "status": "failed_post_processing",
  "reason": "row 5 produced 1 empty cell",
  "source_image_url": "/generated/job_20260523_153012/source.png",
  "debug_report_url": "/generated/job_20260523_153012/debug_report.json",
  "retry_hint": "regenerate"
}
```

Allowed `retry_hint` values:

```text
regenerate
edit_prompt
manual_inspect
```

## Backend And Template Asset Notes

The upload pipeline may be previewed in the browser, but production character generation needs a backend for:

- API key safety.
- Gemini request orchestration.
- binary image processing.
- writing generated packages to disk.
- stable ZIP/package creation.
- queue or job status tracking.

Recommended backend shape for v0.1:

```text
server.js
  static file server
  POST /api/generate-character
  GET /api/jobs/:jobId
  POST /api/process-sheet
  GET /generated/:jobId/:file
```

Use a small Node server before introducing a large framework. Prefer a simple in-memory job map for the local MVP. Job states:

```text
queued
generating
post_processing
done
failed_safety_filter
failed_model_error
failed_post_processing
```

Concurrency should be capped at 2-3 generation jobs in the local tool. If the queue is full, return a clear pending status instead of firing unlimited API requests.

Use template assets as first-class resources, not only prompt text:

```text
templates/
  motion_template_ocad_primary.png
  motion_template_ocha_8x8.png
```

Template metadata should include:

```json
{
  "profile": "topdown_rpg_v0",
  "rows": 8,
  "columns": 8,
  "authoring_cell": { "w": 192, "h": 192 },
  "target_cell": { "w": 96, "h": 96 },
  "anchor": { "mode": "feet-center", "x": 48, "y": 88 },
  "layout": "topdown_rpg_v0"
}
```

The prompt builder should combine:

```text
profile prompt
+ pose/action constraint template
+ optional user reference image
+ user character description
```

The template image is not a minor hint. It is the primary motion and control contract for the generator. The text prompt describes the character identity, while the template image defines action order, direction order, cell spacing, anchor behavior, and controllable pose semantics. The template image must not be used as style, species, costume, or color reference.

Template assets may include temporary visual guides, such as subtle cell spacing, reference silhouettes, or low-contrast guide marks, if they measurably improve generation obedience. Any visible guides must be removed or cropped by the post-processing pipeline before final export.

The implementation plan may use existing experimental outputs as fixture sources, but `output/` remains generated data and should not become the source of truth.

## Related References

- Sprite sheet split and GIF assembly utility patterns: see `docs/decisions/2026-05-23-sprite-tool-research-notes.md`.
- Cell geometry expand, shrink, and repair tools: see the same decision reference.

## Pixel Quality Notes

Generated images should be treated as source art, not as final pixel assets.

The pipeline should preserve crispness by:

- using nearest-neighbor scaling for final normalization;
- disabling canvas image smoothing;
- warning when the source is JPEG or visibly anti-aliased;
- optionally adding a later palette quantization step for 32-64 color output;
- optionally adding a later 1x pixelization pass for sources that look like soft "pixel-style" renders instead of true pixel art;
- keeping GIF as a preview artifact, not as the primary game asset.

The primary game asset is:

```text
normalized_sheet.png + animations.json
```

GIF files are preview artifacts only. v0.1 emits row GIF previews and includes them in `character_pack.zip`, but runtimes should import `normalized_sheet.png` plus `animations.json` rather than GIFs.

## Prompt Direction

The generation prompt should emphasize:

- TopDown/RPG pixel character.
- 8x8 complete character action sheet.
- Fixed invisible grid.
- Same character identity across all frames.
- Small body, readable silhouette, limited palette.
- No labels, UI, text, watermarks, visible grid, scenery, or extra characters.
- Transparent or pure solid background.
- Authoring cell spacing larger than final output.
- Walk cycles with visible foot alternation.
- No cross-cell effects.

The UI should keep the user description focused on character identity only:

```text
good: silver-haired swordswoman, black cloak, blue eyes, small leather boots
bad: silver-haired swordswoman swinging a sword and dodging across the sheet
```

Actions, poses, directions, and frame counts come from the selected preset and template, not from the free-form character description. This reduces the chance that the image model invents a new sheet layout.

When dual-background matte is requested, the provider issues two generation calls only if deterministic paired output is available. Both calls share the same prompt, template image, user description, and seed. They differ only in the explicit background-color line:

```text
Call A: Background must be pure white #ffffff with no gradient, no shadow, no off-white pixels.
Call B: Background must be pure black #000000 with no gradient, no glow, no off-black pixels.
```

The prompt must instruct the model that character identity, palette, pose, and grid layout are identical between calls. Any deviation beyond the configured tolerance is recorded as `dual_matte_inconsistent`, and the pipeline falls back to single-source background removal.

Prompt output must be treated as untrusted input. Validation and normalization remain mandatory.

## Verification Plan

The implementation plan should include tests for:

- Profile frame layout maps expected animation names to frame indexes.
- `animations.json` contains every required animation.
- Source dimensions are split into 64 cells even when not divisible by 8.
- Background flood-fill preserves internal light pixels.
- Normalization uses one global scale across frames.
- Normalized frames are 96x96.
- `debug_report.json` records warnings and blocking errors.
- Browser preview selects the correct direction animation for movement vectors.

### Test Fixtures

The repository must ship at least one known-good source sheet as a binary fixture, so slicing, normalization, and validation tests have a stable baseline that does not depend on a live Gemini call.

```text
test/fixtures/character-pack/
  topdown_rpg_v0_sample_hero.png
  topdown_rpg_v0_sample_hero.expected.json
```

`topdown_rpg_v0_sample_hero.png` is an authored 8x8 source sheet that exercises the full profile. It should use a white or transparent background and include at least one usable cell per row and one complete frame group per animation.

`topdown_rpg_v0_sample_hero.expected.json` records:

- detected cell size and row/column boundaries;
- bbox, anchor delta, and warnings for each of the 64 frames;
- the full expected `animations.json` produced for the fixture.

Required fixture tests:

- `sheetSlicer` produces 64 non-empty cells from the fixture.
- `normalizer` places every frame's foot baseline within +/-3 px of anchor y=88.
- `validator` returns `pass` for the fixture.
- regenerated `animations.json` matches the expected fixture.

Additional adversarial fixtures should be added when real failure modes appear, such as row-height drift, character-too-tall, transparent bleed, or cross-cell effects.

## Documentation And Maintainability Rules

The project should avoid one large document and one large implementation file. The protocol, plan, runtime code, and operating notes must have separate responsibilities.

### Documentation Structure

Use these categories:

```text
docs/superpowers/specs/
  Product and protocol decisions.
  Explains what we are building and why.
  Should not contain long implementation code blocks.

docs/superpowers/plans/
  Goal-mode implementation plans.
  Contains task-by-task execution steps, exact files, commands, and tests.

docs/protocols/
  Stable asset protocol references.
  Example: topdown_rpg_v0.md, animations-json.md, debug-report-json.md.

docs/runbooks/
  Human operating guides.
  Example: how to generate with Gemini, how to inspect quality reports, how to import a character pack.

docs/decisions/
  Short architecture decision records.
  Use only when a decision has meaningful tradeoffs.
```

The design spec remains the source for product intent. The protocol docs become the source for stable data contracts. The implementation plan becomes the source for Goal-mode execution.

### Code Organization

Do not keep expanding `src/app.js` or `src/pixelPipeline.js` into catch-all files. New character-pack behavior should be split by responsibility:

```text
src/character-pack/
  profile.js
  animations.js
  packageBuilder.js
  sheetSlicer.js
  backgroundRemoval.js
  componentCleanup.js
  normalizer.js
  validator.js
  debugOverlay.js
  playablePreview.js

test/character-pack/
  profile.test.js
  packageBuilder.test.js
  sheetSlicer.test.js
  backgroundRemoval.test.js
  normalizer.test.js
  validator.test.js
  playablePreview.test.js
```

Responsibilities:

- `profile.js`: frame size, grid size, animation layout, anchor, quality thresholds.
- `animations.js`: frame index helpers and movement-direction mapping.
- `packageBuilder.js`: `animations.json`, `metadata.json`, and package id generation.
- `sheetSlicer.js`: 8x8 source grid slicing.
- `backgroundRemoval.js`: alpha preservation and flood-fill background removal.
- `componentCleanup.js`: speck removal and cross-cell debris filtering.
- `normalizer.js`: global scale and bottom-center anchor placement.
- `validator.js`: pass/warning/fail classification.
- `debugOverlay.js`: bbox, baseline, anchor, and warning visualization.
- `playablePreview.js`: browser runtime animation selection and control state.

UI files should orchestrate these modules but should not contain the image-processing algorithms directly.

### Single Source Of Truth

The profile definition in code should be the only executable source of truth for:

- animation names
- frame indexes
- frame size
- sheet size
- anchor
- baseline
- default fps
- quality thresholds

Docs can describe the profile, but tests must verify that generated `animations.json` and UI behavior match the profile definition. Avoid duplicating the same frame map in several files by hand.

### Context Hygiene For Goal Mode

Before entering Goal mode, the implementation plan should instruct the worker to read only:

1. `AGENTS.md`
2. this design spec
3. the implementation plan
4. the existing files named in the current task

The worker should not scan all generated `output/` assets unless the task specifically requires visual inspection. Experimental output directories are references, not source of truth.

The implementation plan should prefer small tasks with fresh tests. Each task should make one focused behavior work and verify it before moving on.

### Code Size Guidelines

Guidelines for implementation:

- Keep each new module focused on one responsibility.
- Prefer pure functions for image metadata, profile mapping, JSON building, and validation.
- Keep DOM manipulation out of pipeline modules.
- Keep Canvas/ImageData code behind narrow helper functions.
- Avoid large inline data tables in UI files.
- If a file grows beyond roughly 250-350 lines and mixes responsibilities, split it before adding more behavior.
- Do not add broad abstractions until two real call sites need them.

### Documentation Size Guidelines

Guidelines for docs:

- Specs explain decisions and contracts.
- Plans explain exact implementation steps.
- Runbooks explain how a human uses the workflow.
- Protocol docs explain stable JSON and asset formats.
- Avoid copying long code into specs.
- Put only minimal JSON examples in specs; detailed examples belong in protocol docs or tests.

## Goal Mode Readiness

Before switching to Goal mode, create an implementation plan from this design. The plan must make the upload pipeline work before relying on Gemini API generation.

Recommended implementation order:

1. Define profile and animation protocol.
2. Implement package JSON builders with tests.
3. Add first-class template metadata and fixture assets.
4. Implement source sheet slicing with tests.
5. Implement background removal and component cleanup with tests.
6. Implement normalization and validation with tests.
7. Add Character Pack tab.
8. Add playable preview.
9. Add export/download package.
10. Add local backend shell for processing jobs.
11. Add OpenRouter provider contract and unavailable state.
12. Wire live OpenRouter generation when `OPENROUTER_API_KEY` is configured.
