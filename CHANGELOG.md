# Changelog

## [0.5.0-preview.1] - 2026-07-17

### Added

- Added the MoteWeave public Preview brand decision, source-only release
  metadata, deterministic snapshot export, provider-free release checks, and
  Node 22/24 CI contract.
- Added deterministic repository-owned fixed-region templates, neutral sample
  fixtures, and website social artwork provenance for public redistribution.
- Added the Editor Workspace v0 surface with project persistence, scene
  authoring, animation timeline, asset library, interaction/playtest support,
  scene flow, and editor project pack export.
- Added Editor Workspace engine handoff preview metadata, export review UI,
  consumer validation, manual evidence, and reviewer checklist outputs.
- Added Motion Source guarded set apply across CLI, local API, and browser UI,
  producing set-apply reports and applied sheets from reviewed
  identity-consistent strips without provider calls.
- Added release closeout guidance for the merged Editor Workspace, Motion
  Source, scene/2.5D, and character quality surfaces.
- Added text-to-image modes: `production_sheet_v0` for export-oriented sprite
  sheets and `quality_character_v0` for single-character image generation.
- Added default 2K / one-candidate text-to-image generation with opt-in local
  candidate scoring and recorded `candidate_selection` metadata.
- Added structured T2I prompt fields, neutral character presets, background
  prompt binding, and provider-agnostic generation options for seed,
  temperature, top-p, and top-k.
- Added quality-character pixel finishing with background cleanup, palette snap,
  alpha outline strengthening, and nearest-neighbor downsample.
- Added `benchmark t2i-golden` with a fixed 20-case prompt set, dry-run planning,
  and live artifact/report output.
- Added fixed-region source quality reports with per-region occupancy,
  visible-bounds, halo, edge-pressure, layout-alignment, and source-action
  motion checks.

### Changed

- Renamed the default fixed-region character source layout to
  `fixed_region_motion_v0`; `ocad_motion_v0` remains readable as a legacy alias
  for historical reports, fixtures, and old metadata.
- Bumped the character prompt contract to `character_prompt_contract_v1_6` so
  new provider prompts and metadata use the neutral fixed-region layout id.
- Changed normal character text-to-image generation to default to one provider
  call; multi-candidate sweeps remain opt-in for quality review and benchmarks.
- Production-sheet candidate scoring now penalizes weak fixed-region source
  quality before choosing the selected provider image.

## 0.4.0 - 2026-06-11

### Added

- Promoted the implemented v0.4 scene/tile and project-pack surface to the documented release state.
- Added release-readiness guidance for publishing the local tool without committing secrets, generated outputs, or temporary UI prototype files.
- Added a guarded local `POST /api/generate-scene-tiles` endpoint and local API boundary documentation for server/core/UI responsibilities.
- Added `benchmark scene-tile-live-gate` with dry-run planning, quota guard, per-case scene pack artifacts, and scene tile report output.
- Added project-pack shared style validation warnings for missing style evidence and character/scene palette mismatch.
- Added optional strict project-pack style enforcement through core `stylePolicy`, CLI `--strict-style-contract`, and API `strictStyleContract`.
- Started v0.4 Scene / Tile Phase 0 with provider-free pixel style primitives for palette extraction, palette snapping, integer nearest-neighbor downsampling, and report-only style drift metrics.
- Added opt-in `--style-report` and `--style-max-colors` CLI support for writing `debug_report.json.pixel_style` without mutating generated images or export archives.
- Added the v0.4 scene/tile direction decision, v0.4 master plan, and pixel style pipeline protocol.
- Started v0.4 Phase 1 with a padded 16-tile dual-grid profile contract, atlas metadata, edge compatibility checks, and structural validation.
- Started v0.4 Phase 2 with provider-free tile map validation and an LDtk-style JSON export skeleton.
- Started v0.4 Phase 3 with a project manifest contract that joins character packs, scene packs, and a shared pixel style reference.
- Added a provider-free scene tile quality gate for visual seam deltas, self-loop checks, palette/style drift, and tile failure taxonomy.
- Added a provider-free scene tile prompt contract and CLI dry-run command for the padded dual-grid source sheet.
- Added the provider-free scene pack artifact writer, generated URL manifest, and `scene_pack.zip` export.
- Added single-level LDtk project JSON export with tileset, tile layer, entity layer, and entity field definitions.
- Added a provider-free scene tile preview UI backed by deterministic dual-grid preview maps and LDtk payloads.
- Added provider-free real tile sheet ingestion for `topdown_tile_dual_grid_v0`, including CLI/API export and UI uploaded-sheet preview.
- Added a guarded live scene tile generation smoke path with `scene tile-generate --yes`, provider metadata, prompt artifacts, quality gate, LDtk export, and `scene_pack.zip`.
- Strengthened the scene tile prompt contract to `scene_tile_prompt_contract_v0_2` with explicit loopable border-band and shared edge-signature continuity rules.
- Added opt-in scene tile edge conditioning for `scene tile-ingest` and `scene tile-generate`, including conditioned `tileset.png` artifacts, `edge_conditioning.json`, and provider-free raw/conditioned comparison evidence.
- Added edge-aware conditioning v1 and raw-vs-conditioned visual review artifacts so structural seam passes can still carry visible-mutation warnings.
- Strengthened the scene tile prompt contract to `scene_tile_prompt_contract_v0_3` with raw tile-structure rules and added a warning-only `source_atlas_structure` quality gate for detecting atlas sheets that read as one continuous scene.
- Added opt-in scene tile palette-snap style correction with `style_correction.json`, before/after drift metrics, mutation counts, and CLI `--style-snap`.
- Strengthened the scene tile quality gate with warning-only `tile_distinctness` checks for duplicate runtime tiles across distinct referenced masks.
- Added deterministic `rule_based_dual_grid_v0` scene tile arrangement for seeded preview, ingestion, LDtk, and scene-pack export paths.
- Added project pack export with `project_manifest.json`, `project_validation.json`, `project_pack.zip`, and CLI `project pack --character-dir --scene-dir`.
- Added local Project Pack API/UI integration and exposed scene tile `rule` seed/density plus style/edge correction controls in the browser.
- Recorded a v0.4 release-closure live scene gate, `v04_scene_live_gate_20260606_01`, with `1 / 1` pass rate, usable rate `1.00`, and no failure taxonomy entries.

## 0.3.1 - 2026-06-05

### Changed

- Clarified the OCAD prompt contract so single-region static source actions are not described as four-frame animation sources.
- Updated OpenRouter benchmark Markdown tables to split expected static-source reuse from unexpected duplicate motion.
- Added a provider-free OpenRouter benchmark report recompute CLI for refreshing summary, quality gate, taxonomy, and Markdown logic from stored report items.

## 0.3.0 - 2026-06-04

### Added

- Default AI generation route based on the `ocad_motion_v0` fixed-region source layout, normalized back into the `topdown_rpg_v0` runtime profile.
- Structured prompt contracts and provider prompt metadata for 8x8 topdown and OCAD-style fixed-region generation layouts.
- Live OpenRouter benchmark reports, quality gates, local benchmark gallery, failure taxonomy, and Row GIF artifact browsing.
- Godot NPC, RPGMaker, and OCAD compatibility export ZIPs alongside the internal normalized runtime pack.
- Aseprite-compatible editor metadata data layer for frame tags, frame rectangles, attachment points, visible bounds, and source provenance.
- Topdown repair planning, repair-cell generation/apply loop, local cell compaction, and validation evidence for focused empty/cropped-frame recovery.
- Multi-resolution normalized sheets for 96, 64, 48, 32, and 16 px frame sizes with `multi_resolution.json`.
- CLI commands for process, generate, OpenRouter benchmark, processed-sample benchmark, topdown quality closure, and topdown repair workflows.

### Changed

- Split the character-pack processing pipeline into explicit stage modules and kept `processSheetBuffer()` as the high-level orchestration entry point.
- Split provider code into provider config, image utilities, OpenRouter adapter, Gemini adapter, and shared provider entry points.
- Split the Character Pack UI into focused controls, workflow, provider status, benchmark gallery, job rendering, cut-line, and playable preview modules.
- Reclassified expected OCAD fixed-region source reuse separately from true duplicate motion.
- Reclassified source-region edge pressure as a diagnostic unless normalized runtime frames also show edge/crop risk.
- Updated the v0.3 roadmap, runbooks, artifact protocol, and decision records around the OCAD default route and output polish.

### Fixed

- Avoided treating generated OCAD sheets as sparse 8x8 topdown inputs during post-processing.
- Reduced false warning noise in OCAD gates from expected duplicate source reuse and source-region edge diagnostics.
- Made package ids deterministic across host timezones when `createdAt` includes an explicit timestamp string.

## 0.2.0 - 2026-05-26

### Added

- AI image generation path for character-pack sheets with provider presets and job metadata.
- Fixed-layout OCAD motion-template guidance for preserving row order, pose timing, spacing, and feet-center anchors.
- Palette/style reference upload support for generated character sheets.
- Provider-side template upscaling so 252 px templates are sent at the requested generation size.
- Canonical 252 px preprocessing for fixed-layout sources before slicing, normalization, and GIF preview generation.
- Debug metrics for subpixel animation jitter and source preprocessing.
- MIT license metadata and technology-reference roadmap.

### Changed

- Strengthened generation prompt guardrails to reject unrequested props, weapons, scenery, extra rows, and template reordering.
- Renamed brand-sensitive research documentation and metadata examples to neutral project language.
- Improved release hygiene with attribution and IP naming rules in project documentation.

### Fixed

- Prevented 1024 px generated sheets from being sliced as if they were canonical 252 px sheets.
- Reduced half-pixel animation jitter by preserving stable pixel-center behavior in the normalization path.

## 0.1.0 - 2026-05-24

### Added

- Initial local character-pack upload, normalization, validation, preview, and export pipeline.
