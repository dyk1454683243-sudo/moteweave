# 2.5D Tileset Pipeline Protocol

**Status:** Draft, schema-first local pipeline  
**Owner:** Scene and tileset pipeline  
**Introduced:** 2026-06-17  
**Current plan:** `docs/superpowers/plans/2026-06-17-two-point-five-d-no-ai-mvp.md`

## Purpose

This protocol defines the first local, rule-driven, AI-assisted 2.5D pixel
tileset pipeline. External image models may provide raw material or style
sources, but they do not own the final tileset structure. Final assets must pass
local contract validation, rule-aware composition, metadata export, and preview
generation before they are treated as usable game assets.

The first implementation is intentionally schema-first. It establishes the
contract, deterministic atlas plan, validation report, and export files before
adding source normalization or material extraction. The first hardening unit now
separates strict atlas output size from the occupied rule profile. The second
hardening unit adds deterministic local procedural material composition. Later
hardening units add pixel validation, richer previews, runtime padding policy,
and editor-facing export metadata. The first manual-source unit adds local
source normalization and sampled material-profile extraction while keeping final
tile structure under the deterministic composer. The source authoring guidance
unit turns normalization and sample diagnostics into JSON/Markdown feedback for
the next manually generated source image. Manual Source Material Extraction v1
adds fixed-size source patch extraction and patch-based local tile rendering so
manual source images can contribute actual texture pixels without owning atlas
structure. Reviewed Manual Source Evidence Gate v1 batches local manual source
images through the same pipeline and writes evidence reports before broader
semantic extraction, WFC, LDtk, or UI expansion. Material Source Quality Closure
v1 adds local material-patch palette limiting plus canonical release-readiness
reporting so the remaining warnings are ranked by stage and action instead of
appearing only as duplicated taxonomy entries. Semantic Slot Extraction v1 adds
per-slot selected/rejected candidate evidence, and Tileable Patch Extraction v1
normalizes opposing patch edges before diagnostics and rendering. Material Slot
Separation v1 applies deterministic 2.5D role separation to extracted material
patches while keeping raw source colors recorded for review. Guarded Rule Map /
LDtk Prototype v1 adds a deterministic seeded map-rule sample, edge-constraint
validation, rule-map preview, and concrete single-level LDtk project export
without claiming full WFC or browser editing. LDtk Auto-layer Rules v1 adds
rule groups and a `TerrainMasks` IntGrid layer, Constraint Map Solver v1 adds
local propagation/backtracking with reportable contradictions, and Headless Map
Editor Workflow v1 adds scriptable rule-safe edit operations before validation
and export. Map Editor / Workflow Productization Closure v1 exposes those
operations through a browser tab, adds static LDtk workflow validation, and
writes release evidence for the local build path. Export Consumer Validation /
Release Demo Pack v1 adds package portability checks, static practical import
validation, and a self-contained demo ZIP for downstream consumer workflows.
External Editor Round-trip / Consumer Tool Probe v1 adds local tool availability
evidence, packed ZIP import smoke checks, and a manual-ready round-trip evidence
slot without launching external editors. AI Material Source Bridge v1 adds a
guarded provider/raw-source entry point: a neutral 2.5D material-source prompt
contract asks for a square material board, records provider evidence, and routes
the returned image through the existing local normalizer/material builder
without treating provider output as a clean atlas. Multi-candidate Material
Source Benchmark v1 now repeats that bridge across bounded candidates and ranks
each candidate using local source normalization, material extraction, atlas
validation, and export evidence. Browser Material Source Benchmark Entry v1
exposes that benchmark through the local 2.5D tab with a free dry-run plan path
and a guarded live path that still requires explicit quota confirmation.
Benchmark Report Review / Decision Summary v1 now persists a local review object
inside benchmark reports and renders the same decision summary in the browser so
provider blockers, local material-quality warnings, and ready-to-expand results
are not conflated.

## Current Scope

Implemented:

- JSON tileset contract.
- Contract validator.
- Explicit `1024 x 1024` strict atlas size.
- Derived full atlas grid from strict size and sprite cell size.
- Neutral `corner_mask_16` rule profile with a separate `4 x 4` occupied grid.
- Deterministic 16-mask atlas plan.
- Separation of logical tile size from sprite cell size.
- Bottom-center pivot metadata.
- Fixed-height `orthographic_2_5d` block geometry.
- Logical-footprint collision metadata.
- Deterministic procedural material profile for top, side, edge, corner,
  transition, shadow, and decal slots.
- `1024 x 1024` strict atlas PNG render with local procedural material fills.
- Runtime padded atlas PNG render with local procedural material fills.
- Material profile JSON and material swatches PNG.
- Preview PNG.
- Metadata JSON.
- Pixel-level validation report JSON.
- Runtime padding policy and strict-to-runtime coordinate metadata.
- Per-tile role, terrain, visual bounds, z-order, and validation status
  metadata.
- Optional manual material source normalization to `1024 x 1024` PNG.
- Optional sampled material profile builder from normalized manual source art.
- Material source diagnostics for empty, low-coverage, low-contrast,
  overexposed, and underexposed sample regions.
- Material source authoring guidance JSON/Markdown for manual source iteration.
- Manual material patch extraction from each configured source region.
- Patch quality diagnostics for visible coverage, contrast, color variety, and
  repeated-edge mismatch.
- Local material-patch palette limiting from the contract `palette.max_colors`
  budget before patch-texture atlas rendering.
- Patch-texture 2.5D composer path for manual source profiles.
- Reviewed manual source evidence manifest validation.
- Batch material-source evidence gate with pass/warning/fail policy.
- Evidence report JSON/Markdown for reviewed manual sources.
- Per-sample comparison contact sheet with normalized source, sample overlay,
  patches, strict atlas, and rule-map preview.
- Configurable material sampling layout through `--material-layout`.
- Semantic Material Layout Assist v1 with baseline, `4 x 4` tile-sheet, and
  connected-terrain layout candidates.
- Selected and rejected source-layout evidence in material source reports,
  metadata, guidance, CLI summaries, and evidence-gate item metrics.
- Material Source Quality Closure v1 in reviewed evidence reports, with
  canonical warning groups, release-readiness status, prioritized samples, and
  recommended next actions.
- Semantic Slot Extraction v1 for automatic material-source mode, with per-slot
  selected/rejected candidate evidence.
- Tileable Patch Extraction v1 with opposing-edge normalization for extracted
  material patches.
- Material Slot Separation v1 with raw/separated color provenance, recolored
  patch textures, and initial/remaining slot-distinction counts.
- Guarded map-rule profile export with corner-mask edge compatibility tables.
- Seeded corner-grid rule-map generation with logical grid, sprite cell, pivot,
  collision, terrain role, source rect, and runtime rect metadata per map cell.
- Rule-map validation for incompatible adjacent corner-mask edges.
- Concrete single-level LDtk project export with logical grid placement and
  tileset customData carrying 2.5D sprite/pivot/collision metadata.
- LDtk-style auto-layer rule artifact and `TerrainMasks` IntGrid layer.
- Local constraint-map solver with fixed-mask, allowed-mask, border, density,
  seed, propagation, and backtracking evidence.
- Headless map-editor workflow with safe corner-grid edit operations, workflow
  report, and preview artifact.
- Browser 2.5D map-editor tab with material source upload, map contract
  controls, paint/erase/corner operations, local API job wiring, validated
  preview, export links, and release evidence summary.
- Static LDtk workflow validation for JSON round-trip, layer references, UID
  collisions, TerrainMasks values, auto-rule tile references, tileset relPath,
  and auto-layer tile coverage.
- Workflow release evidence JSON/Markdown tying source normalization, material
  slots, strict atlas validation, constraint solving, map editor edits, LDtk
  readiness, and Tiled exports together.
- Consumer package audit JSON for required files, relative package paths,
  duplicate paths, PNG/JSON parseability, local path leak checks, and editor
  image-reference consistency.
- Practical import validation JSON for Tiled JSON/TSX and LDtk project payloads
  without claiming external editor launch.
- Release demo manifest, README, and ZIP containing root-level atlas/editor
  files plus validation, metadata, map, and preview evidence.
- External tool probe JSON for supported local editor availability without
  external launches or local absolute path leakage.
- External import smoke JSON that unpacks the release demo ZIP, parses packed
  JSON payloads, and validates packed Tiled/LDtk image references.
- External round-trip validation JSON and checklist Markdown that honestly
  report `not_run` until a supported editor is manually or explicitly automated.
- AI Material Source Bridge v1 with
  `two_point_five_d_material_source_prompt_contract_v1_0`.
- Guarded CLI provider raw-source generation through
  `tileset build-two-point-five-d --generate-source`.
- Guarded local API provider raw-source generation through
  `/api/build-two-point-five-d-tileset` with `confirm_live_generation: true`.
- Provider source evidence artifacts:
  `ai_material_source_bridge.json`, `ai_material_source_prompt.txt`, and
  `provider_material_source.png`.
- Metadata and job summaries that keep the provider image classified as
  `raw_material_source_not_clean_atlas`.
- Multi-candidate material-source benchmark CLI through
  `tileset material-source-benchmark`.
- Benchmark plan/report artifacts:
  `material_source_benchmark_plan.json`, `material_source_benchmark.json`, and
  `material_source_benchmark.md`.
- Deterministic candidate ranking based on local validation, source
  normalization, material-source quality gates, guidance issues, patch warnings,
  and slot-distinction warnings.
- Local browser benchmark API:
  `/api/two-point-five-d-material-source-benchmark`.
- Browser 2.5D Source Benchmark panel with material brief, candidate count,
  image size, max provider calls, provider config, live-quota confirmation,
  dry-run plan generation, guarded live job execution, and benchmark report
  artifact links.
- Benchmark report review JSON embedded in `material_source_benchmark.json`.
- Benchmark Markdown Decision Summary with review status, release readiness,
  next action, priority, and rationale.
- Provider-free benchmark review handoff CLI that reads an existing
  `material_source_benchmark.json` and writes standalone review JSON/Markdown
  plus screenshot-friendly HTML and PNG pages without spending provider quota.
- Browser benchmark report viewer with decision summary, selected-candidate
  rows, top issue taxonomy, provider-error count, and claim boundary.
- Material source sample overlay preview PNG.
- Material layout candidate preview PNG.
- Material slot candidate preview PNG when automatic semantic slot selection is
  active.
- Material patch sheet preview PNG.
- Grid overlay PNG.
- Collision overlay PNG.
- Seeded random map preview PNG.
- Validated rule-map preview PNG.
- Headless map-editor preview PNG.
- Tiled JSON and TSX export with per-tile metadata properties.
- Single-level LDtk project JSON, auto-layer rule JSON, and LDtk export
  validation report.
- CLI command:

```bash
npm run character-pack -- tileset build-two-point-five-d \
  --contract configs/two_point_five_d/block_autotile_v1.json \
  --output-dir generated/two-point-five-d-tilesets \
  --run-id local_2_5d_schema_smoke
```

Manual material source mode:

```bash
npm run character-pack -- tileset build-two-point-five-d \
  --contract configs/two_point_five_d/block_autotile_v1.json \
  --material-source /path/to/manual-material-source.png \
  --material-layout /path/to/material-layout.json \
  --output-dir generated/two-point-five-d-tilesets \
  --run-id local_2_5d_manual_source
```

Guarded provider raw-source mode:

```bash
npm run character-pack -- tileset build-two-point-five-d \
  --contract configs/two_point_five_d/block_autotile_v1.json \
  --generate-source "mossy cliff grass blocks with cool stone side walls" \
  --source-image-size 1K \
  --max-provider-calls 1 \
  --output-dir generated/two-point-five-d-tilesets \
  --run-id local_2_5d_provider_source
```

Detailed handoff and stop rules live in
`docs/runbooks/two-point-five-d-material-source-benchmark.md`.

Guarded provider raw-source benchmark smoke:

```bash
npm run character-pack -- tileset material-source-benchmark \
  --description "mossy cliff grass blocks with cool stone side walls" \
  --candidate-count 1 \
  --source-image-size 1K \
  --dry-run-plan \
  --output-dir generated/two-point-five-d-material-source-benchmarks \
  --run-id local_2_5d_material_source_1call_smoke
```

Live execution requires explicit confirmation and quota. This smoke spends at
most one provider call when the route is pinned or no fallback is configured:

```bash
npm run character-pack -- tileset material-source-benchmark \
  --description "mossy cliff grass blocks with cool stone side walls" \
  --candidate-count 1 \
  --source-image-size 1K \
  --yes \
  --max-provider-calls 1 \
  --output-dir generated/two-point-five-d-material-source-benchmarks \
  --run-id local_2_5d_material_source_1call_smoke
```

For an intentional three-candidate comparison, set both `--candidate-count 3`
and `--max-provider-calls 3`. Do not raise candidate count when the provider
route or quota is blocked.

Provider-free review of a manually run benchmark:

```bash
npm run character-pack -- tileset material-source-benchmark-review \
  --run-dir generated/two-point-five-d-material-source-benchmarks/<run-id>
```

This writes `material_source_benchmark_review.json`,
`material_source_benchmark_review.md`, and
`material_source_benchmark_review.html` next to the benchmark report. It also
writes `material_source_benchmark_review.png` as a ready-to-share screenshot
summary for manual/live handoff reviews.

Browser dry-run plan:

```http
POST /api/two-point-five-d-material-source-benchmark
{
  "dryRunPlan": true,
  "description": "mossy cliff grass blocks with cool stone side walls",
  "candidateCount": 1,
  "imageConfig": { "image_size": "1K", "aspect_ratio": "1:1" }
}
```

Browser live execution requires explicit confirmation and quota:

```http
POST /api/two-point-five-d-material-source-benchmark
{
  "confirm_live_generation": true,
  "description": "mossy cliff grass blocks with cool stone side walls",
  "candidateCount": 1,
  "imageConfig": { "image_size": "1K", "aspect_ratio": "1:1" },
  "maxProviderCalls": 1
}
```

Reviewed manual source evidence gate:

```bash
npm run character-pack -- tileset material-source-evidence \
  --manifest /path/to/material-source-manifest.json \
  --output-dir generated/two-point-five-d-material-source-evidence \
  --run-id local_2_5d_source_evidence
```

Not implemented yet:

- Production-grade source normalizer policies for large sample sets.
- Production-grade arbitrary material understanding beyond the current semantic
  layout and slot assists.
- Edge-aware material blending.
- Multi-tile patch synthesis beyond local opposing-edge normalization.
- Multi-height terrain.
- Decoration placement.
- Unattended external editor launch or saved round-trip evaluation of generated
  LDtk/Tiled payloads.
- Full WFC solver productization.
- Large-sample live provider material-source benchmarking.
- Hosted generation or provider claims beyond the guarded raw-source bridge.

## Contract Shape

Default config:

```text
configs/two_point_five_d/block_autotile_v1.json
```

Important fields:

- `canvas`: raw source canvas budget for manual AI/source images.
- `atlas.mode`: `strict_atlas` for the first output contract.
- `atlas.strict_size`: first output target is `1024 x 1024`.
- `atlas.grid`: derived by validation and planning from `strict_size` and
  `tile_cell_size`; the default derived grid is `16 x 16`.
- `atlas.tile_cell_size`: sprite cell size in the output atlas.
- `projection.logical_tile_size`: gameplay/map footprint size.
- `projection.sprite_cell_size`: visual sprite cell size.
- `projection.pivot`: currently `bottom_center`.
- `projection.fixed_height_px`: first version supports fixed height only.
- `schema.supports`: required visual parts such as top face, side face, corner,
  edge trim, transition overlay, and decals.
- `materials.slots`: named material slots consumed by future material builders.
- `materials.procedural_profile`: first no-AI material source; deterministic
  pattern fills are used by the local composer until manual image extraction
  exists.
- `rule_profile`: first version uses the neutral `corner_mask_16` profile for
  masks `0-15`, with its own `4 x 4` occupied grid. This keeps room for later
  blob and Wang-style profiles without recasting the core.
- `collision`: always logical footprint, never visual outline.
- `exports`: declares requested artifact families.

## Logical vs Sprite Size

2.5D tiles must not treat the visual sprite cell as the gameplay tile. The
default contract uses:

```text
logical_tile_size: 32 x 32
sprite_cell_size: 64 x 64
fixed_height_px: 24
pivot: bottom_center
```

The logical footprint is the collision/map footprint. The sprite cell is larger
so it can hold top face, front/side faces, edge trims, shadows, and future
decorations.

## Validation Rules

The validator fails when:

- canvas dimensions are invalid,
- atlas mode, projection, pivot, or adjacency mode is unsupported,
- sprite cell is smaller than logical tile,
- fixed height does not fit inside the sprite cell,
- atlas cell does not match sprite cell,
- strict atlas includes padding,
- required tile schema parts are absent,
- required material slots are absent,
- collision follows visual outline,
- metadata or validation report export is disabled.

Warnings are reserved for non-blocking policy risks such as non-limited palette
mode, semi-transparent pixels, or collision size differing from logical tile.

The pixel validator layer also inspects rendered pixels:

- strict atlas size equals the contract output size,
- atlas dimensions are divisible by sprite cell size,
- semi-transparent pixels obey the palette/alpha policy,
- visible tile pixels remain within allowed cell bounds,
- collision bounds remain logical-footprint metadata rather than visual outline,
- fixed-height 2.5D geometry is not clipped by the sprite cell.

The export metadata layer records:

- strict atlas cell coordinates with no padding,
- runtime padded atlas cell coordinates with copied edge padding,
- runtime inner rects that map back to strict source rects,
- tile role, role tags, terrain type, visual bounds, and z-order hints,
- per-tile validation status derived from the rendered-pixel report.

## Artifacts

`tileset build-two-point-five-d` writes:

```text
tileset_contract.json
atlas_plan.json
map_rule_profile.json
constraint_solver_report.json
tile_map.json
tile_map_validation.json
map_editor_workflow.json
material_profile.json
metadata.json
validation_report.json
strict_atlas.png
runtime_padded_atlas.png
material_swatches.png
preview.png
grid_overlay.png
collision_overlay.png
random_map_preview.png
rule_map_preview.png
map_editor_preview.png
tileset.tiled.json
tileset.tsx
project.ldtk
ldtk_auto_layer_rules.json
ldtk_project_validation.json
ldtk_workflow_validation.json
workflow_release_evidence.json
workflow_release_evidence.md
consumer_package_audit.json
import_validation.json
release_demo_manifest.json
release_demo_README.md
release_demo_pack.zip
```

When `--material-source` or `--generate-source` is provided it also writes:

```text
normalized_material_source.png
source_normalization.json
material_source_report.json
material_source_guidance.json
material_source_guidance.md
material_source_samples.png
material_layout_candidates.png
material_slot_candidates.png (automatic semantic slot selection only)
material_patches.png
```

When `--generate-source` is used it additionally writes:

```text
ai_material_source_bridge.json
ai_material_source_prompt.txt
provider_material_source.png
```

`tileset material-source-benchmark` writes:

```text
material_source_benchmark_plan.json
material_source_benchmark.json
material_source_benchmark.md
items/<case-id>/candidate_<nn>/ai_material_source_bridge.json
items/<case-id>/candidate_<nn>/provider_material_source.png
items/<case-id>/candidate_<nn>/normalized_material_source.png
items/<case-id>/candidate_<nn>/strict_atlas.png
items/<case-id>/candidate_<nn>/material_source_report.json
items/<case-id>/candidate_<nn>/validation_report.json
```

Without `--material-source`, atlas PNGs use deterministic procedural material
fills. With `--material-source` or `--generate-source`, they use extracted
material patches as texture fills. In all modes the local composer owns material
placement, masks, pivots, collision, and export shape.

The no-AI MVP now writes review artifacts such as:

```text
grid_overlay.png
collision_overlay.png
random_map_preview.png
rule_map_preview.png
```

`tileset material-source-evidence` writes:

```text
material_source_evidence_gate.json
material_source_evidence_gate.md
items/<sample-id>/tileset_contract.json
items/<sample-id>/source_normalization.json
items/<sample-id>/material_source_report.json
items/<sample-id>/material_source_guidance.json
items/<sample-id>/normalized_material_source.png
items/<sample-id>/material_source_samples.png
items/<sample-id>/material_layout_candidates.png
items/<sample-id>/material_slot_candidates.png
items/<sample-id>/material_patches.png
items/<sample-id>/strict_atlas.png
items/<sample-id>/random_map_preview.png
items/<sample-id>/rule_map_preview.png
items/<sample-id>/map_editor_preview.png
items/<sample-id>/map_editor_workflow.json
items/<sample-id>/constraint_solver_report.json
items/<sample-id>/tile_map.json
items/<sample-id>/tile_map_validation.json
items/<sample-id>/project.ldtk
items/<sample-id>/ldtk_auto_layer_rules.json
items/<sample-id>/ldtk_project_validation.json
items/<sample-id>/ldtk_workflow_validation.json
items/<sample-id>/workflow_release_evidence.json
items/<sample-id>/workflow_release_evidence.md
items/<sample-id>/evidence_contact_sheet.png
```

The evidence report also includes `quality_closure`, which canonicalizes
duplicated warning sources into one issue group per sample and records whether
the reviewed set is release-ready, ready with advisories, not ready, or blocked.

## Evidence Manifest

The reviewed source gate consumes a local JSON manifest:

```json
{
  "schema_version": 1,
  "fixture_set": "local_2_5d_material_sources",
  "contract": "configs/two_point_five_d/block_autotile_v1.json",
  "samples": [
    {
      "id": "grass_block_source_001",
      "file": "grass-block-source.png",
      "source_rights": "user_provided_local_only",
      "expected_status": "warning",
      "notes": "Manual model output; keep local unless rights are cleared."
    }
  ]
}
```

Manifest sample files must stay inside the manifest directory. Supported
`source_rights` values include `test_generated`, `original`, `cc0`,
`public_domain`, `user_provided_local_only`,
`user_provided_for_repository_test_use`, and
`user_provided_with_repository_test_rights`.

## Pipeline Stages

Current stage statuses:

```text
source_normalizer: planned or source_normalizer_v0
material_builder: procedural_material_v0 or manual_material_extraction_v1
rule_aware_composer: procedural_geometry_v0 or patch_texture_geometry_v1
validator: pixel_validation_v0
exporter: metadata_export_hardening_v0
preview_generator: preview_artifacts_v0
map_rule_builder: constraint_map_solver_v1 (seeded fallback: guarded_rule_map_v1)
map_exporter: ldtk_project_export_v1
map_editor_workflow: two_point_five_d_map_editor_workflow_v1
```

Future implementation should keep the same stage boundary:

1. Source normalizer accepts arbitrary manual AI images as raw sources and
   normalizes them to a controlled material canvas.
2. Material builder extracts sampled top, side, edge, shadow, transition, and
   decal material colors and fixed-size material patches from normalized source
   regions, limits patch palettes from the contract budget, reports
   source-quality warnings, writes source authoring guidance, and writes
   sampling and patch previews.
3. Rule-aware composer places materials into local deterministic masks.
4. Validator checks size, masks, pivots, collision, seams, palette, and export
   completeness.
5. Exporter writes atlas, metadata, Tiled, and concrete LDtk project artifacts.
6. Preview generator renders reviewable maps without changing asset truth.
7. Map rule builder writes constraint-solved map samples and edge validation
   from the same local rule profile.
8. Headless map-editor workflow applies rule-safe operations over the corner
   grid and revalidates the resulting map.
9. Map exporter writes concrete editor-facing map project artifacts and
   LDtk-style auto-layer rules without claiming editor round-trip evaluation or
   full WFC productization.
10. Consumer validation writes package audit, import validation, release demo
    ZIP, external tool probe, ZIP import smoke, and manual-ready round-trip
    evidence without claiming a saved external editor round-trip.

The reviewed evidence gate runs across those stage outputs and applies the
current policy:

- `fail` when manifest validation fails, a source cannot be processed, or
  deterministic tileset validation has blocking errors.
- `warning` when artifacts are generated but source normalization, material
  extraction, patch quality, palette, or guidance warnings require review.
- `pass` when configured source regions produce patch-textured atlas artifacts
  without warnings or blocking errors.

## 2026-06-17 Alignment Notes

The external planning brief reviewed on 2026-06-17 is accepted as directionally
correct with these project-specific adjustments:

- Keep the implementation in the existing Node/sharp CLI stack instead of
  introducing a separate Python/Pillow pipeline.
- Do not force external image models to generate exact atlas dimensions.
- Treat manual model output as raw source or material source only.
- Make local code responsible for atlas size, cell placement, masks, pivots,
  collision, validation, export, and previews.
- The contract now makes the strict atlas `1024 x 1024` while keeping the
  `corner_mask_16` occupied rule profile separate from the full atlas grid.
- Continue improving reviewed manual-source sample evidence and semantic
  extraction quality before broad WFC, LDtk, or UI claims.
- The guarded map-rule/LDtk prototype now writes concrete map artifacts,
  LDtk-style auto-layer rules, constraint-solver reports, and headless editor
  workflow artifacts. Browser UI, release demo packaging, external tool
  probing, and ZIP import smoke are now implemented; saved editor round-trip
  validation and full WFC productization remain later stages.

## 2026-06-17 Reviewed Source Evidence

A local evidence run processed eight manually generated raw terrain sheets:

```text
generated/two-point-five-d-material-source-evidence/local_2_5d_real_sources_20260617/material_source_evidence_gate.json
```

The gate status was `warning`: manifest validation passed, every sample
processed, and no deterministic tileset validation blockers were found, but all
eight samples required manual source review.

The dominant findings were:

- all samples had `.png` filenames but JPEG image payloads, so the normalizer
  reported `source_format_normalized_to_png`,
- all samples exceeded the limited-palette contract,
- most samples produced low-distinction material slots when the fixed
  `six_region_material_grid_v0` layout was applied to `4 x 4` dual-grid or
  connected terrain sources,
- weaker samples produced repeated-edge patch warnings, especially the later
  `960` prompt attempt.

Decision implemented: **Semantic Material Layout Assist v1** now scores
baseline, `4 x 4` tile-sheet, and connected-terrain layout candidates, keeps
explicit `--material-layout` overrides authoritative, persists selected/rejected
layout evidence, and writes `material_layout_candidates.png` for review. The
local source review rerun `local_2_5d_real_sources_layout_assist_20260617`
processed all eight samples without deterministic blockers; five selected the
`4 x 4` tile-sheet layout and three selected the connected-terrain probe layout.
All samples still remained `warning`, so WFC, LDtk auto-layer rules, and broad
map-editor export remain gated.

The next quality-closure rerun
`local_2_5d_real_sources_quality_closure_20260617` processed the same eight
samples with material-patch palette limiting and `quality_closure` enabled.
`palette_color_count_exceeds_max` disappeared from the taxonomy, confirming that
palette pressure is now handled locally for reviewed manual material sources.
The closure status remained `not_ready`: all eight samples still had release
warnings, led by slot-distinction and patch-tileability findings. At that point,
the top remaining actions were `improve_semantic_slot_extraction` and
`improve_tileable_patch_extraction`.

The follow-up rerun
`local_2_5d_real_sources_semantic_tileable_20260617` processed the same eight
samples with Semantic Slot Extraction v1 and Tileable Patch Extraction v1
enabled. All eight samples wrote slot-candidate previews and used active
tileability normalization. `material_patch_repeat_edge_delta_*` disappeared from
the taxonomy and every sample reported `warning_patch_count: 0`, but
`quality_closure.status` remained `not_ready` because all eight samples still
carry `material_slot_low_distinction_*` release warnings. WFC, LDtk auto-layer
rules, and broader map-editor export remain gated on stronger material-slot
separation.

The next rerun
`local_2_5d_real_sources_slot_separation_v2_20260617` processed the same eight
samples with Material Slot Separation v1 enabled. All eight samples used active
slot separation, initial slot-distinction warnings dropped from 29 to 0, and
`quality_closure.status` moved to `ready_with_advisories`. The only remaining
taxonomy item is `source_normalization.source_format_normalized_to_png`, an
advisory for JPEG payloads with `.png` filenames.

The next implementation block added Guarded Rule Map / LDtk Prototype v1. The
default 2.5D build now writes `map_rule_profile.json`, `tile_map.json`,
`tile_map_validation.json`, `rule_map_preview.png`, `project.ldtk`, and
`ldtk_project_validation.json`. The first version used a deterministic seeded
corner grid and validated corner-mask edge compatibility before LDtk export.
The follow-up implementation now writes `ldtk_auto_layer_rules.json`,
`constraint_solver_report.json`, `map_editor_workflow.json`, and
`map_editor_preview.png`; the default map path uses the local constraint solver
and then passes through the headless editor workflow before LDtk export. This
unlocks concrete map/export testing. The browser workflow, consumer package
validation, tool probe, and ZIP import smoke are now implemented, while saved
external editor round-trip evaluation and full WFC productization remain outside
the current claim.

## Claim Boundary

The current reviewed local set can be treated as material-source ready with
advisories after deterministic local normalization, semantic layout/slot assist,
tileable patch extraction, and slot separation. This does not claim that
arbitrary manual AI images can already be converted into production-ready 2.5D
tiles from arbitrary compositions. That broader claim requires more source
diversity, visual quality review, and larger evidence runs.

The guarded map-rule, LDtk auto-layer rule, constraint-solver, browser workflow,
consumer package validation, tool probe, and ZIP import smoke prove that the
current tileset contract can feed deterministic logical maps and self-contained
single-level editor project packages. They do not prove saved LDtk/Tiled editor
round-trip evaluation, multi-level worlds, or full WFC productization.

## Verification

```bash
node --test test/two-point-five-d/*.test.js
npm test
```
