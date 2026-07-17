# MoteWeave

MoteWeave turns uploaded or optionally AI-generated game art into inspectable,
previewable, and exportable character, motion, scene, and tile assets.

Current preview version: `0.5.0-preview.1`.

## Contributing

Contributors and AI agents must read `AGENTS.md` before making changes. Attribution and naming guardrails are tracked in `ATTRIBUTIONS.md`.

Current focus:

```text
description or uploaded sheet
-> character-pack processing pipeline
-> normalized 8x8 / 96x96 sprite sheet
-> multi-resolution sprite sheets
-> quality/debug artifacts
-> editor metadata for frame tags, slices, and attachments
-> browser playable preview
-> Godot NPC plugin compatible export
-> RPGMaker and OCAD compatibility exports
-> repeatable compatibility benchmark
uploaded or generated scene tile sheet
-> scene tile ingestion / optional live generation
-> tile quality gate
-> LDtk-compatible scene export
-> project pack export that combines character + scene artifacts
```

## Current Status

Implemented:

- `topdown_rpg_v0` profile: 8 columns x 8 rows, 96x96 frames, 64 frames total.
- Source layout selector: `topdown_rpg_v0` 8x8 uniform input or `fixed_region_motion_v0` one-image fixed-region motion input. Historical `ocad_motion_v0` metadata remains readable as a legacy alias.
- Fixed-region source action semantics are preserved in reports and overlays while normalized runtime actions stay compatible with `topdown_rpg_v0`.
- Upload-first sheet processing with background cleanup, grid correction, normalization, validation, debug overlays, row GIF previews, and ZIP export.
- Multi-resolution normalized sheet outputs: 96, 64, 48, 32, and 16 px frame sizes.
- Editor metadata export: `editor_metadata.json` records frame tags, frame rectangles, attachment points, visible bounds, and source provenance.
- Browser playable preview using `normalized_sheet.png` plus `animations.json`.
- Optional OpenRouter/Gemini text-to-image generation with two modes:
  `production_sheet_v0` routes selected candidates through the sheet pipeline,
  while `quality_character_v0` writes single-character image artifacts without
  forcing sprite-sheet layout.
- T2I generation defaults to `2K` and one candidate, then records local
  candidate-selection scores in `generation.json`.
- Fixed-region generation writes `source_quality_report.json` and uses
  source-level occupancy, halo, edge-pressure, layout-alignment, and action
  motion checks during production-sheet candidate selection.
- Phase 1 Godot NPC compatibility: generated ZIPs include `AI资源库/一图全动作/<character_id>/npc.json`, `sprite.png`, and `thumb.png`.
- RPGMaker compatibility: `rpgmaker_pack.zip` includes 144x192 sprite sheets and `NPC.json` for the plugin's RPGMaker scanner.
- OCAD compatibility: `ocad_pack.zip` includes 252x252 fixed-region sheets and `npc.json` for the plugin's OCAD scanner.
- Local compatibility benchmark with optional Godot probe.
- v0.4 scene/tile path: `topdown_tile_dual_grid_v0` padded 16-tile atlas ingestion, provider-free preview, quality gate, rule-based dual-grid arrangement, LDtk-compatible single-level project export, and `scene_pack.zip`.
- Guarded live scene tile generation through the CLI: `scene tile-generate --yes`, with prompt, provider metadata, optional palette snap, optional edge conditioning, quality gate, and ZIP artifacts.
- Project pack export: combines existing character and scene artifact directories into one manifested `project_pack.zip` while keeping child artifacts separated.

Not implemented yet:

- Godot `.tres` export.
- Broad scene/tile quality benchmark claims; the current live scene evidence is a one-case release smoke, not a production readiness guarantee.
- Full parallax asset generation.
- Full WFC, multi-level LDtk worlds, auto-layer rules, and map editor workflows.
- Full production persistence, auth, billing, or public deployment hardening.

## Quick Start

Prerequisites:

- Node.js 22 or 24; Node.js 24 LTS is recommended.
- Git.
- Optional FFmpeg for Motion Source video input.
- Optional rembg/U2Net for external matting.

```bash
git clone https://github.com/dyk1454683243-sudo/moteweave.git
cd moteweave
npm ci
npm start
```

Open the local URL printed by `npm start`, then use the Character Pack workflow.
The server binds to the local machine; this Preview is not a hosted upload
service.

Provider-backed generation is optional and may spend API credits. The default
upload, processing, preview, export, tests, and local smoke paths do not require
a Provider key.

FFmpeg and rembg are user-installed optional tools and are not bundled. External
media-tool execution currently fails closed on Windows; the source Preview does
not claim that path as supported.

### Resource-guarded verification

Tests and local smoke checks run through `scripts/run-with-resource-guard.mjs`. The guard applies a finite timeout, a Node.js V8 old-space ceiling, and an aggregate RSS ceiling to the complete spawned process tree. It also runs Node.js tests serially and reports elapsed time, peak RSS, and peak process count.

Use the focused profile while developing:

```bash
npm run test:focused -- test/path/to/file.test.js
npm run guard:focused -- node path/to/script.mjs
```

Run the complete contributor verification only when the affected focused tests
are already green:

```bash
npm test
npm run smoke:local
```

The focused profile allows 1024 MiB of V8 old space and 1536 MiB of process-tree RSS for 60 seconds. `npm test` and `npm run smoke:local` use the full profile with 2048 MiB of V8 old space and 4096 MiB of process-tree RSS. Do not bypass the guard or run overlapping test suites. A legitimate need for a higher ceiling must be reviewed before changing these values.

Useful scripts:

```bash
npm run dev
npm run character-pack -- process --input test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png --output-dir generated/cli --job-id cli_sample_hero --background-mode flood
npm run character-pack -- generate --description "blue wizard" --preset topdown_rpg_v0 --dry-run-prompt
npm run character-pack -- generate --description "silver swordswoman" --t2i-mode quality_character_v0 --character-preset rpg_humanoid_v0 --candidate-count 1 --dry-run-prompt
npm run character-pack -- benchmark t2i-golden --dry-run-plan --sample-size 5 --candidate-count 4
npm run character-pack -- benchmark t2i-golden-review --run-dir generated/t2i-golden-benchmarks/<run_id>
npm run character-pack -- scene tile-ingest --input path/to/topdown_tile_dual_grid_v0.png --output-dir generated/cli --job-id scene_demo --pattern rule --seed 7 --density 0.55 --style-snap --edge-condition
npm run character-pack -- project pack --character-dir generated/cli/cli_sample_hero --scene-dir generated/cli/scene_demo --output-dir generated/cli --job-id project_demo
npm run character-pack -- project pack --character-dir generated/cli/cli_sample_hero --scene-dir generated/cli/scene_demo --output-dir generated/cli --job-id project_demo_strict --strict-style-contract
npm run character-pack -- benchmark scene-tile-report --scene-dir generated/cli/scene_demo --output-dir generated/scene-tile-reports --run-id scene_report_demo
npm run character-pack -- benchmark scene-tile-live-gate --dry-run-plan --sample-size 5 --style-snap --edge-condition
npm run benchmark:character-pack
npm run smoke:local
npm run smoke:openrouter
```

`npm run smoke:openrouter` uses a real provider key and may spend API credits. Prefer `npm test` and `npm run smoke:local` for routine checks.

AI generation keys stay server-side in `.env`. To make the web UI switch between preconfigured generation choices without exposing keys, set `CHARACTER_PROVIDER_PRESETS` and optional `CHARACTER_DEFAULT_PROVIDER`; see `.env.example` for the single-line JSON format. Presets can target either OpenRouter-compatible image generation (`provider: "openrouter"`) or the official Gemini API (`provider: "gemini"`).

## Project Map

```text
src/character-pack/
  Pure asset pipeline, exporters, validation, previews, and job helpers.

src/scene-pack/
  Scene tile profiles, ingestion, quality gates, arrangement, LDtk export,
  live generation wrapper, and scene pack artifact writing.

src/project-pack/
  Character + scene pack composition, manifest validation, and combined ZIP
  export.

src/app.js
  Browser UI orchestration. Keep image-processing logic out of this file.

server.js
  Local HTTP API, job queue wiring, generated artifact writing, and static serving.

docs/protocols/
  Stable asset and JSON contracts.

docs/protocols/local-api-boundaries.md
  Local server/client/core ownership and API endpoint boundary notes.

docs/runbooks/
  Human operating guides for smoke tests and engine import.

docs/runbooks/github-release-readiness.md
  Checklist for publishing without staging secrets, generated outputs, or local
  scratch files.

docs/decisions/
  Short notes explaining meaningful tradeoffs.

docs/superpowers/specs/
  Product and protocol design history.

docs/superpowers/plans/
  Implementation plans and execution notes.

test/character-pack/
  Tests that mirror the character-pack modules.
```

## Main Artifact Flow

```text
source image
-> processSheetBuffer()
-> normalized_sheet.png
-> multi_resolution.json
-> normalized_sheet_96.png / normalized_sheet_64.png / normalized_sheet_48.png / normalized_sheet_32.png / normalized_sheet_16.png
-> animations.json
-> metadata.json
-> editor_metadata.json
-> debug_report.json
-> source_layout_overlay.png
-> source_quality_report.json
-> debug_overlay.png / onion_skin_overlay.png
-> row GIF previews
-> character_pack.zip
-> godot_npc_pack.zip
-> rpgmaker_pack.zip
-> ocad_pack.zip
```

The internal runtime contract remains `normalized_sheet.png + animations.json`. Godot NPC plugin, RPGMaker, and OCAD compatibility are exporters layered on top of that contract.

## Scene And Project Flow

```text
topdown_tile_dual_grid_v0 source sheet
-> buildScenePackFromTileSheet()
-> quality_gate.json
-> scene.json / tile_atlas.json / tile_map.json
-> project.ldtk
-> tileset.png
-> scene_pack.zip

character artifact dir + scene artifact dir
-> buildProjectPack()
-> project_manifest.json / project_validation.json
-> project_pack.zip
```

Live scene generation is intentionally guarded by `--yes` and should be treated
as quota-spending validation. Use provider-free `scene tile-prompt` and
`scene tile-ingest` for routine development. Use
`benchmark scene-tile-live-gate --dry-run-plan` before any multi-case live scene
gate, then rerun with `--yes` only when quota spend is intended.

## Before Adding Features

Read these first:

1. `README.md`
2. `docs/protocols/topdown_rpg_v0.md`
3. `docs/protocols/character-pack-artifacts.md`
4. `docs/protocols/source-layouts.md` when touching input slicing or template choices
5. `docs/protocols/rpgmaker-v0.md` or `docs/protocols/ocad-v0.md` when touching compatibility exporters
6. The specific module and test file for the change

Keep new behavior behind focused modules. Do not keep expanding `src/app.js` or mix exporter-specific assumptions into the core normalization pipeline.
