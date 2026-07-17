# Character Pack Module Map

`src/character-pack/` owns the asset pipeline. UI and server code should call these modules instead of duplicating image, animation, or export logic.

## Core Contract

The core contract is:

```text
normalized_sheet.png + animations.json + metadata.json + debug_report.json
```

Exporters can wrap this contract for specific engines, but they should not redefine the internal profile.

## Modules

```text
profile.js
  Single executable source of truth for frame size, grid size, anchor, baseline, thresholds, and animation layout.

animations.js
  Builds animation frame lists from the profile.

packageBuilder.js
  Builds package ids, animations.json, and metadata.json.

imageCodec.js
  Loads and writes RGBA/PNG buffers with nearest-neighbor resize helpers.

multiResolution.js
  Builds multi-resolution normalized sheet outputs from the validated runtime sheet.

processingOptions.js
  Normalizes processing options such as background cleanup, anchor offsets, and component cleanup thresholds.

sourcePreparation.js
  Owns source image loading, fixed-layout preprocessing, background removal, and per-cell component cleanup.

framePipeline.js
  Slices source cells and applies normalization, auto-correction, motion stabilization, and manual frame adjustments.

sourceQualityGate.js
  Evaluates fixed-region source sheets before runtime normalization: per-region
  occupancy, visible bounds, halo/background residue, edge pressure, layout
  alignment, expected static reuse, and source-action motion.

sheetSlicer.js
  Computes source grid boundaries, projection correction, and cell slicing.

sourceLayouts.js
  Selects the input slicing strategy: 8x8 uniform grid or OCAD fixed non-uniform regions.

backgroundRemoval.js
  Handles passthrough alpha, flood removal, edge-palette removal, and dual matte.

normalizer.js
  Places each source cell into the final 96x96 frame using the bottom-center anchor.

autoCorrector.js
  Applies conservative post-normalization anchor and baseline translations and records every move.

validator.js
  Produces pass/warning/fail quality results and metrics.

debugOverlay.js
  Renders source-region, bbox, baseline, anchor, and onion-skin debug images.

processReport.js
  Builds validation, pixel style metrics, and debug-report structures from pipeline stage outputs.

stylePipeline.js
  Provider-free palette extraction, palette snapping, integer nearest downsampling, report-only style drift metrics, and opt-in style correction reports.

processArtifacts.js
  Builds normalized sheet, Row GIF previews, engine export ZIPs, and related process artifacts.

playablePreview.js
  Browser preview movement and animation selection helpers.

gifExport.js / rowPreview.js
  Preview-only GIF artifacts.

exporters/
  Engine or ecosystem-specific wrappers. These consume the core contract.

benchmark/
  Runs repeatable compatibility reports and optional Godot plugin probes.

providers/
  AI image-generation adapters. Providers create source sheets; they do not own post-processing.

providers/providerConfig.js
  Parses provider presets and exposes server-safe provider state.

providers/openRouterAdapter.js / providers/geminiAdapter.js
  Transport-specific request and response handling for image providers.

providers/providerImageUtils.js
  Provider request image encoding and template resizing helpers.

artifactManifest.js
  Maps processed files to server-written artifacts and URLs.

processSheet.js
  Public orchestration entry point. Keep this file high-level.
```

## Exporter Rule

An exporter may add engine-specific files, such as Godot NPC plugin `npc.json`, but it should take the normalized sheet and metadata as input. It should not perform background removal, slicing, normalization, or validation itself.

Current exporter:

```text
exporters/godotNpcExport.js
  Builds AI资源库/一图全动作/<character_id>/npc.json, sprite.png, and thumb.png.

exporters/rpgmakerExport.js
  Builds RPGMaker 144x192 compatibility exports.

exporters/ocadExport.js
  Builds OCAD 252x252 compatibility exports.
```
