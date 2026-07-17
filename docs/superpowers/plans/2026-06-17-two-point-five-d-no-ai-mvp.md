# 2.5D No-AI Tileset MVP Plan

**Date:** 2026-06-17  
**Status:** Active implementation plan  
**Scope:** Local, deterministic 2.5D terrain tileset pipeline. Live provider
work is limited to a guarded raw material-source bridge; WFC productization,
multi-level worlds, and broad provider-quality claims remain outside this
foundation.

## Goal

Build a fixed-height 2.5D pixel terrain tileset pipeline where external image
models may provide raw material/style sources through a guarded bridge, but the
final atlas structure is owned by local deterministic code.

The first production-shaped milestone is a no-AI demo that generates and
validates a `1024 x 1024` strict atlas from local rules and procedural material
inputs.

## Existing Coverage

Already implemented in the schema-first smoke:

- JSON tileset contract.
- Explicit `1024 x 1024` strict atlas size in the contract.
- Derived full atlas grid from strict size and sprite cell size.
- Neutral `corner_mask_16` rule profile with a separate `4 x 4` occupied grid.
- Separation of logical tile size and sprite cell size.
- Fixed-height `orthographic_2_5d` projection metadata.
- Bottom-center pivot metadata.
- Logical-footprint collision metadata.
- 16-mask atlas plan.
- Procedural local material profile with deterministic pattern fills for top,
  side, edge, corner, transition, shadow, and decal slots.
- Procedural strict atlas, runtime padded atlas, material swatches, preview,
  metadata, validation report, Tiled JSON, and TSX export.
- Pixel-level validation report for strict atlas size, cell alignment, alpha,
  palette count, visible bounds, collision bounds, and stray pixels.
- Grid overlay, collision overlay, and seeded random map preview artifacts.
- Runtime padding policy, strict-to-runtime coordinate mapping, per-tile role,
  terrain, visual bounds, z-order, and validation-status metadata.
- Tiled JSON and TSX per-tile export metadata for the same local contract.
- Guarded Rule Map / LDtk Prototype v1 with seeded corner-grid rule maps,
  corner-mask edge validation, `map_rule_profile.json`, `tile_map.json`,
  `tile_map_validation.json`, `rule_map_preview.png`, single-level
  `project.ldtk`, and `ldtk_project_validation.json`.
- LDtk Auto-layer Rules / Constraint Solver / Headless Map Editor Workflow v1
  with `ldtk_auto_layer_rules.json`, `constraint_solver_report.json`,
  `map_editor_workflow.json`, and `map_editor_preview.png`.
- Map Editor / Workflow Productization Closure v1 with a browser 2.5D map
  editor tab, real local API job, `ldtk_workflow_validation.json`, and
  `workflow_release_evidence.json` / `.md`.
- Export Consumer Validation / Release Demo Pack v1 with
  `consumer_package_audit.json`, `import_validation.json`,
  `release_demo_manifest.json`, `release_demo_README.md`, and
  `release_demo_pack.zip`.
- External Editor Round-trip / Consumer Tool Probe v1 with
  `external_tool_probe.json`, `external_import_smoke.json`,
  `external_roundtrip_validation.json`, and
  `external_roundtrip_checklist.md`.
- AI Material Source Bridge v1 with
  `two_point_five_d_material_source_prompt_contract_v1_0`,
  `ai_material_source_bridge.json`, `ai_material_source_prompt.txt`, and
  `provider_material_source.png`.
- Multi-candidate Material Source Benchmark v1 with
  `material_source_benchmark_plan.json`, `material_source_benchmark.json`, and
  `material_source_benchmark.md`.
- Optional manual material source normalization and sampled material-profile
  extraction through `--material-source`.
- Material source diagnostics, configurable sampling layout, and sample-region
  overlay preview artifacts for manual sources.
- Material source authoring guidance JSON/Markdown for manual source iteration.
- Manual Source Material Extraction v1 with fixed-size material patches,
  patch-quality gates, patch sheet preview, and patch-texture atlas rendering.
- Reviewed Manual Source Evidence Gate v1 with manifest validation, batch
  source review, JSON/Markdown evidence report, comparison contact sheets, and
  pass/warning/fail policy.
- CLI entries through `tileset build-two-point-five-d` and
  `tileset material-source-evidence`.
- A first reviewed local evidence run across eight manually generated raw
  terrain sheets, recorded in
  `docs/decisions/2026-06-17-two-point-five-d-material-source-evidence-review.md`.
- Semantic Material Layout Assist v1 with baseline, `4 x 4` tile-sheet, and
  connected-terrain layout candidates, selected/rejected layout evidence,
  layout scoring reasons, CLI/evidence summary fields, and
  `material_layout_candidates.png` reviewer previews.
- Material Source Quality Closure v1 with local material-patch palette limiting,
  canonical warning grouping, release-readiness status, prioritized samples, and
  recommended next actions in the evidence gate.
- Semantic Slot Extraction v1 with per-slot scored source candidates,
  selected/rejected slot evidence, CLI/evidence summary fields, and
  `material_slot_candidates.png` reviewer previews.
- Tileable Patch Extraction v1 with local opposing-edge normalization for
  extracted material patches and tileability evidence in extraction reports.
- Material Slot Separation v1 with deterministic role palette separation,
  recolored patch textures, raw/separated color provenance, and evidence-gate
  release-readiness reporting.

This proves the contract, rule-profile, procedural material-composition, pixel
validation, preview-artifact shape, metadata/export hardening, and the first
manual-source material extraction path with quality diagnostics and patch-based
rendering plus reviewed source evidence. Semantic Material Layout Assist v1 now
makes the first source-layout choice reviewable instead of assuming every source
uses the fixed six-region grid. This is still a layout-selection assist, not
full arbitrary source segmentation. Material Source Quality Closure v1 removes
the always-on rendered-palette warning from reviewed manual sources and turns the
remaining warnings into a release-readiness report instead of a duplicated raw
taxonomy list. Semantic Slot Extraction v1 and Tileable Patch Extraction v1 now
make slot choice reviewable at the material-slot level and remove patch
repeated-edge warnings from the reviewed local source set. Material Slot
Separation v1 now applies deterministic 2.5D role separation to extracted
material patches and moves the reviewed local source set to
`ready_with_advisories`; the remaining advisory is source file format
normalization. Guarded Rule Map / LDtk Prototype v1 connected this local tileset
foundation to a deterministic map-rule sample and concrete editor project
export. The ordered expansion added LDtk-style auto-layer rule authoring, a
local constraint solver, and a headless map-editor workflow. The productization
closure exposed that workflow through the browser, added static LDtk
import-readiness checks, and wrote end-to-end workflow release evidence. The
consumer validation closure now packages the current exports into a portable
release demo ZIP and statically verifies Tiled/LDtk references, required
payloads, and local path hygiene. The external round-trip closure now records
local tool availability, validates the packed editor payloads from the ZIP, and
writes a manual-ready round-trip evidence slot while still avoiding claims of
unattended external editor launch, saved editor round-trip editing, or full WFC
productization. AI Material Source Bridge v1 now connects the unified provider
adapter layer to the 2.5D material-source path while preserving the raw-source
claim boundary: provider output is normalized and sampled locally, never treated
as a clean tileset or atlas. Multi-candidate Material Source Benchmark v1 now
adds bounded candidate generation and deterministic local ranking. Browser
Material Source Benchmark Entry v1 now exposes dry-run planning and guarded live
benchmark execution from the local 2.5D tab without weakening the quota guard or
the raw-source claim boundary.

## Remaining Corrections

No remaining corrections are currently tracked for the local no-AI MVP
foundation. Future work should add new sections rather than weakening the
current schema, validation, preview, and export guarantees.

## Latest Implementation Block

**Benchmark Report Review / Decision Summary v1** is implemented.

Delivered:

- add a pure local benchmark-review module that reads
  `material_source_benchmark.json` shape and emits a deterministic review
  object,
- distinguish `ready_to_expand`, `review_warnings`, `needs_quality_work`,
  `provider_blocked`, and `invalid_report` outcomes,
- map review outcomes to explicit next actions such as `run_larger_sample`,
  `improve_material_extraction`, `improve_source_normalization`,
  `fix_provider_route`, and `review_warning_taxonomy`,
- persist the review object in `material_source_benchmark.json`,
- add a Markdown Decision Summary with review status, release readiness, next
  action, priority, and rationale,
- render the same decision summary in the browser 2.5D benchmark panel with
  selected-candidate rows, top issue taxonomy, provider-error count, and claim
  boundary.

This block is intentionally scoped: it makes benchmark evidence easier to act
on, but it is not a large-sample provider-quality claim and does not loosen the
rule that provider output remains raw material source only.

## Previous Implementation Block

**Browser Material Source Benchmark Entry v1** is implemented.

Delivered:

- add a 2.5D browser Source Benchmark panel with material brief, candidate
  count, image size, max provider calls, provider config controls, live-quota
  confirmation, dry-run planning, and guarded live execution,
- add `/api/two-point-five-d-material-source-benchmark` as a local API wrapper
  around the existing material-source benchmark runner,
- write real `material_source_benchmark_plan.json` artifacts for dry-run plans
  without provider calls,
- require `confirm_live_generation: true` and explicit `maxProviderCalls` before
  a live browser benchmark can enqueue provider generation,
- route live browser benchmark jobs through the same local candidate generation,
  deterministic ranking, atlas validation, export, package audit, and import
  validation path as the CLI,
- render plan/report artifact links, provider-call budget, selected usable rate,
  candidate summaries, and claim boundary in the 2.5D result panel.

This block is intentionally scoped: it productizes the already-implemented
benchmark loop for local browser use. It is not a large-sample provider-quality
claim, not arbitrary-source production readiness, not hosted generation, and not
a claim that providers can emit final strict atlases.

## Previous Implementation Block

**Multi-candidate Material Source Benchmark v1** is implemented.

Delivered:

- add `tileset material-source-benchmark` as a guarded live-provider benchmark
  for 2.5D raw material-source candidates,
- support default benchmark cases, explicit `--case-id`, focused
  `--description`, bounded `--candidate-count`, and `--dry-run-plan`,
- require `--yes` plus `--max-provider-calls` before live candidate generation,
- generate each provider candidate through the neutral material-source bridge
  and route every completed candidate through the local normalizer, material
  builder, patch-texture composer, validator, Tiled/LDtk export, package audit,
  and import validation path,
- rank candidates with deterministic local evidence: validation status,
  source-normalization warnings, material-source warnings, quality-gate warnings,
  guidance issues, patch warning counts, and slot-distinction counts,
- record failed provider or invalid-image candidates without pretending they
  passed, and continue to later candidates when the failure is retryable,
- write `material_source_benchmark_plan.json`,
  `material_source_benchmark.json`, and `material_source_benchmark.md` with
  selected-candidate summaries and failure taxonomy.

This block is intentionally scoped: it gives the project repeatable evidence
for choosing among provider raw material-source candidates. It is not a
large-sample provider-quality claim, not arbitrary source production readiness,
and not a claim that providers can emit final strict atlases.

## Previous Implementation Block

**AI Material Source Bridge v1** is implemented.

Delivered:

- add a neutral `two_point_five_d_material_source_prompt_contract_v1_0` that
  asks providers for a square raw material board, not a strict atlas, mask chart,
  or final asset,
- add a provider bridge that reuses the unified OpenRouter/Gemini prompt-image
  adapters without reusing character-generation prompts,
- require explicit CLI quota through `--max-provider-calls 1` for
  `tileset build-two-point-five-d --generate-source`,
- require `confirm_live_generation: true` before the local API spends provider
  quota for `/api/build-two-point-five-d-tileset`,
- route provider output through the existing source normalizer, material
  builder, patch-texture composer, validator, Tiled/LDtk export, and consumer
  package path,
- write `ai_material_source_bridge.json`, `ai_material_source_prompt.txt`, and
  `provider_material_source.png` next to the existing normalized source,
  material-source, atlas, map, validation, and export artifacts,
- expose bridge status, provider/model metadata, prompt contract summary,
  budget usage, and raw-source claim boundary in CLI output, server job
  summaries, and metadata.

This block is intentionally scoped: it proves Product A's provider route can
feed Product B's deterministic material-source pipeline. It is not a claim that
providers can generate strict 2.5D atlases, not multi-candidate provider
benchmarking, not arbitrary-source production readiness, and not a browser UI
entry point for provider material-source generation.

## Previous Implementation Block

**External Editor Round-trip / Consumer Tool Probe v1** is implemented.

Delivered:

- write `external_tool_probe.json` for every 2.5D build, detecting supported
  local editor command/app availability without recording absolute local paths
  or launching tools,
- route that probe into `import_validation.json` so external-editor readiness
  is visible alongside static Tiled/LDtk checks,
- write `external_import_smoke.json` by unpacking the generated
  `release_demo_pack.zip`, parsing packed JSON payloads, and validating packed
  Tiled/LDtk image references against the actual ZIP entries,
- write `external_roundtrip_validation.json` and
  `external_roundtrip_checklist.md` as a manual-ready evidence slot,
- expose tool probe, import smoke, round-trip validation, and checklist through
  CLI summaries, server job artifacts, reviewed source evidence, local UI export
  links, and smoke coverage.

This block is intentionally scoped: it proves local tool availability can be
observed and the packed editor payload can be statically smoke-tested from the
same ZIP users download. If no supported local editor is detected, round-trip
status remains `not_run` while `ready_for_manual_roundtrip` can still be true.
It is not unattended external editor launch, not a saved editor round-trip edit
evaluation, not a multi-level world package, and not full WFC productization.

## Previous Implementation Block

**Export Consumer Validation / Release Demo Pack v1** is implemented.

Delivered:

- audit generated 2.5D consumer package payloads for required files, relative
  package paths, duplicate paths, PNG/JSON parseability, local absolute path
  leaks, and editor image-reference consistency,
- add practical static import validation for Tiled JSON/TSX and LDtk project
  payloads without claiming external editor launch,
- write `consumer_package_audit.json`, `import_validation.json`,
  `release_demo_manifest.json`, `release_demo_README.md`, and
  `release_demo_pack.zip` for every `tileset build-two-point-five-d` run,
- include root-level `strict_atlas.png`, `runtime_padded_atlas.png`,
  `project.ldtk`, `tileset.tiled.json`, and `tileset.tsx` in the demo ZIP so
  existing relative references remain portable,
- expose the new audit, import validation, manifest, README, and demo ZIP
  through CLI summaries, server job artifacts, reviewed source evidence, and
  the browser export list.

This block is intentionally scoped: it proves local package portability and
static practical import-readiness for the generated sample pack. It is not an
external LDtk/Tiled launch, not an editor round-trip edit evaluation, not a
multi-level world package, and not full WFC productization.

## Previous Implementation Block

**Map Editor / Workflow Productization Closure v1** is implemented.

Delivered:

- add a visible browser `2.5D Tileset` tab without replacing existing
  character, scene, sprite, or project-pack tabs,
- wire material-source upload, map dimensions, solver/border/density/seed, and
  rule-safe paint/erase/corner edit operations to a real local
  `/api/build-two-point-five-d-tileset` job,
- keep the browser canvas as an editor-intent preview while the server pipeline
  remains authoritative for final atlas, map, validation, LDtk, Tiled, and
  evidence artifacts,
- add static LDtk workflow validation for project JSON round-trip,
  layer-definition references, UID collisions, TerrainMasks int-grid values,
  auto-rule tile references, tileset relPath consistency, and auto-layer tile
  coverage,
- write `ldtk_workflow_validation.json`,
  `workflow_release_evidence.json`, and `workflow_release_evidence.md`,
- expose strict atlas, runtime atlas, map editor preview, Tiled, LDtk, workflow
  validation, and release evidence links in the browser result panel,
- extend local smoke coverage so the browser/server path runs a real 2.5D
  material-source build with a map edit and validates release evidence.

This block is intentionally scoped: it productizes the local workflow enough to
operate and verify in the browser. It is not an external LDtk editor launch, not
multi-level world authoring, not decoration placement, and not full WFC
productization.

## Previous Implementation Block

**LDtk Auto-layer Rules / Constraint Solver / Headless Map Editor Workflow v1**
is implemented.

Delivered:

- author LDtk-style auto-layer rules for all 16 corner masks and write
  `ldtk_auto_layer_rules.json`,
- add a `TerrainMasks` IntGrid layer with mask-plus-one values and rule groups
  to `project.ldtk`,
- switch the default map builder to `constraint_map_solver_v1`, which uses
  local domain propagation plus deterministic backtracking,
- write `constraint_solver_report.json` with constraints, decisions,
  propagation, and contradiction evidence,
- support CLI map constraints such as `--map-solver`, `--map-border`,
  `--map-fixed`, and `--map-allowed-mask`,
- add a headless map-editor workflow with safe corner-grid operations,
  `map_editor_workflow.json`, `map_editor_preview.png`, and `--map-edit`
  command input,
- expose auto-layer, solver, editor workflow, and LDtk validation summaries
  through metadata, CLI output, and material-source evidence artifacts.

This block is intentionally scoped: it is local rule authoring, constraint
solving, and scriptable map editing. It is not browser map-editor UI, not an
LDtk editor round-trip evaluation, and not full WFC productization.

## Previous Implementation Block

**Guarded Rule Map / LDtk Prototype v1** is implemented.

Delivered:

- add a neutral map-rule profile artifact with corner-mask edge compatibility
  tables for every mask,
- generate deterministic seeded corner-grid maps that preserve 2.5D logical
  tile size, sprite cell size, pivot, collision, terrain role, source rect, and
  runtime rect metadata per map cell,
- validate map edge constraints so incompatible neighboring masks are blocking
  failures before export,
- render `rule_map_preview.png` from the validated map instead of relying only
  on random tile previews,
- export a concrete single-level `project.ldtk` with logical grid placement and
  tileset custom data for sprite/pivot/collision metadata,
- expose map-rule and LDtk validation summaries through metadata, CLI output,
  and material-source evidence artifacts.

## Previous Implementation Block

**Material Slot Separation v1** is implemented.

Delivered:

- detect initial material-slot low-distinction warnings before local correction,
- keep layout scoring aware of the initial slot-distinction count so layout
  assist still penalizes weak source layouts,
- apply deterministic role palette separation to top, side, edge, corner,
  transition, shadow, and decal slots when automatic semantic selection is
  active,
- recolor extracted patch textures so strict/runtime atlas previews reflect the
  separated role materials,
- persist raw source colors, separated colors, changed slot counts, and remaining
  slot-distinction warnings in reports, material profiles, guidance, CLI
  summaries, and evidence-gate items,
- keep explicit `--material-layout` color authority by reporting
  `slot_separation.status: disabled`.

Post-implementation evidence has been rerun as
`local_2_5d_real_sources_slot_separation_v2_20260617`: all eight samples
processed without deterministic blockers, all eight used active slot separation,
initial slot-distinction warnings dropped from 29 to 0, and
`quality_closure.status` moved to `ready_with_advisories`. The only remaining
taxonomy item is `source_normalization.source_format_normalized_to_png`, an
advisory caused by JPEG payloads with `.png` filenames. WFC, LDtk auto-layer
expansion, or broader map-editor export can now be considered as a guarded next
prototype against this reviewed local set, not as a broad arbitrary-source claim.

## Previous Implementation Block

**Semantic Slot Extraction v1 and Tileable Patch Extraction v1** are
implemented.

Delivered:

- score semantic source candidates per material slot after the source-layout
  candidate has been selected,
- keep explicit `--material-layout` overrides authoritative by using
  `explicit_slot_regions_v1`,
- persist selected/rejected slot evidence in material source reports, material
  profiles, guidance, CLI summaries, and evidence-gate items,
- write `material_slot_candidates.png` when automatic semantic slot selection is
  active,
- normalize opposing material-patch edges locally before diagnostics and
  patch-texture atlas rendering,
- persist tileability status, changed patch count, and changed pixel count in
  extraction reports and CLI/evidence summaries.

Post-implementation evidence was rerun as
`local_2_5d_real_sources_semantic_tileable_20260617`: all eight samples still
processed without deterministic blockers, all eight wrote semantic slot-candidate
previews, and all eight used active tileable patch extraction. Patch repeated-edge
warnings were no longer present and every sample had `warning_patch_count: 0`.
`quality_closure.status` remained `not_ready` because all eight samples still
carried material-slot distinction release warnings. The next quality work targeted
material slot separation.

## Earlier Implementation Block

**Material Source Quality Closure v1** is implemented.

Delivered:

- limit extracted material-patch palettes from the contract `palette.max_colors`
  budget before patch-texture atlas rendering,
- persist the material-patch palette policy in extraction reports, material
  profiles, guidance, and CLI summaries,
- add `quality_closure` to reviewed material-source evidence reports,
- canonicalize duplicated `guidance.*`, `material_source.*`, and
  `quality_gate.*` warnings into one release-readiness issue group per sample,
- rank samples by risk score and expose next actions such as semantic slot
  extraction and tileable patch extraction,
- keep `source_format_normalized_to_png` as an advisory rather than confusing it
  with material release blockers.

Post-implementation evidence was rerun as
`local_2_5d_real_sources_quality_closure_20260617`: all eight samples still
processed without deterministic blockers, `palette_color_count_exceeds_max` was
removed from the taxonomy, and `quality_closure.status` remained `not_ready`
because all eight samples still carried release warnings. The next quality work
targeted semantic slot extraction and tileable patch extraction.

## Earlier Implementation Block

**Semantic Material Layout Assist v1** is implemented.

Delivered:

- keep `six_region_material_grid_v0` as the baseline manual-source layout,
- add scored source-layout candidates for common raw inputs such as `4 x 4`
  tile sheets and connected terrain/map-like images,
- score candidates with layout-oriented diagnostics, especially slot
  distinction and patch repeated-edge mismatch, while keeping low-color and
  low-contrast warnings visible without letting them dominate layout choice,
- persist selected layout, rejected layout candidates, score reasons, and
  reviewer-facing previews in the material-source report,
- write `material_layout_candidates.png` as the reviewer-facing companion
  preview,
- expose selected layout and score in CLI and evidence-gate summaries,
- keep atlas structure, masks, pivots, collision, validation, and export owned
  by local deterministic code.

The reviewed local source evidence was rerun with this assist enabled. WFC,
LDtk auto-layer expansion, and broader map-editor export should remain gated
until evidence shows materially lower slot-distinction and patch-repeat
warnings.

Post-implementation evidence has been rerun as
`local_2_5d_real_sources_layout_assist_20260617`: all eight samples processed
without deterministic blockers, five selected the `4 x 4` tile-sheet layout,
three selected the connected-terrain probe layout, and all eight still remained
`warning`. This keeps WFC and LDtk auto-layer expansion gated while confirming
that source-layout selection is now observable and no longer fixed to the
six-region baseline.

## First-Phase Scope

The first-phase MVP supports:

- `1024 x 1024` strict atlas.
- `64 x 64` sprite cell.
- `32 x 32` logical tile.
- Fixed visual height, initially `24px`.
- Top face, front face, optional side faces, edge trim, shadow, and transparent
  background.
- Basic solid, empty, edge, inner corner, outer corner, isolated block, and
  transition roles.
- Procedural local material inputs before manual raw image ingestion.
- Metadata for pivot, logical footprint, collision, visual bounds, source rect,
  tile role, adjacency/corner mask, and z-order hint.
- Validation report with global diagnostics, per-tile diagnostics, warnings,
  errors, and suggested fixes.
- Preview artifacts for random map, grid overlay, and collision overlay.
- Basic Tiled export.

## Non-Goals

Do not include these in the first-phase MVP:

- Calling image generation APIs.
- Treating arbitrary model output as a clean tileset.
- Production-grade arbitrary source segmentation beyond the current semantic
  layout and slot assists.
- Full arbitrary material understanding from manual source images.
- Unattended external editor launch or saved editor round-trip evaluation of
  generated LDtk/Tiled payloads.
- Full WFC productization.
- Multi-height terrain, slopes, stairs, water animation, or multi-layer
  occlusion.
- Side-view 2D implementation, beyond keeping the schema extensible enough for
  a later projection.

## Pipeline Boundaries

The intended stage boundary remains:

1. `source_normalizer`: later accepts arbitrary manual raw images and reports
   whether they are diagnostic, normalized, candidate material source, or failed.
2. `material_builder`: extracts or generates top, side, edge, shadow,
   transition, and decal material slots, including patch assets for manual
   source profiles.
3. `rule_aware_composer`: locally composes final tile sprites from schema,
   masks, and material slots.
4. `tileset_validator`: verifies atlas dimensions, cell alignment, alpha,
   palette, bounds, pivots, collision, 2.5D height, and transition structure.
5. `atlas_exporter`: writes strict atlas, runtime padded atlas, metadata,
   validation report, preview images, and basic editor-facing formats.
6. `preview_generator`: renders stitched review maps without changing asset
   truth.

## Implementation Sequence

1. Contract update: `Done`
   - add explicit strict atlas size,
   - derive full atlas grid from output size and sprite cell,
   - keep occupied rule profile separate from available atlas cells.
2. Rule profile update: `Done`
   - move 16-mask behavior behind a neutral `corner_mask_16` profile,
   - keep room for later blob and Wang-style profiles without making them core
     assumptions.
3. Procedural material MVP: `Done`
   - generate local material swatches or deterministic texture fills,
   - compose visible 2.5D tiles from those slots instead of flat placeholders.
4. Pixel validator MVP: `Done`
   - check exact atlas dimensions,
   - check divisibility by sprite cell,
   - check semi-transparent pixels,
   - check per-cell visual bounds,
   - check collision bounds remain within logical footprint.
5. Preview MVP: `Done`
   - emit grid overlay,
   - emit collision overlay,
   - emit seeded random map preview.
6. Metadata/export update: `Done`
   - add tile role, terrain type, visual bounds, source rect, z-order hint,
     validation status, and runtime padding policy.
7. Source normalizer / manual material builder MVP: `Done`
   - normalize arbitrary manual material source images to controlled PNG input,
   - extract sampled material colors into top, side, edge, corner, transition,
     shadow, and decal slots,
   - keep final atlas structure owned by local rule-aware composition.
8. Material extraction quality / source diagnostics: `Done`
   - report empty, low-coverage, low-contrast, overexposed, and underexposed
     sample regions,
   - write material source sample overlay previews,
   - allow sampling layouts to be configured without changing composer rules.
9. Source authoring guidance: `Done`
   - convert source normalization and sample diagnostics into actionable JSON
     guidance,
   - write Markdown guidance for manual Gemini/GPT source-image iteration,
   - keep guidance advisory so it does not weaken deterministic atlas
     validation.
10. Manual Source Material Extraction v1: `Done`
   - extract fixed-size PNG material patches from each configured sample region,
   - add patch quality gates for coverage, contrast, color variety, and repeated
     edge mismatch,
   - render manual-source atlas tiles from extracted patches rather than only
     sampled color summaries,
   - write `material_patches.png` as review evidence.
11. Reviewed Manual Source Evidence Gate v1: `Done`
   - validate a local 2.5D material source manifest,
   - batch each source through normalizer, extraction, composer, validator, and
     preview export,
   - write JSON/Markdown evidence reports,
   - write per-sample comparison contact sheets,
   - apply automatic pass/warning/fail policy.
12. Semantic Material Layout Assist v1: `Done`
   - score baseline, `4 x 4` tile-sheet, and connected-terrain layout
     candidates,
   - keep explicit `--material-layout` overrides authoritative,
   - persist selected and rejected layout evidence in material source reports,
   - write `material_layout_candidates.png` and expose selected layout in CLI
     and evidence summaries.
13. Material Source Quality Closure v1: `Done`
   - enforce local material-patch palette budgets from the contract palette
     policy,
   - persist patch palette-limit evidence through reports, guidance, and CLI
     summaries,
   - add canonical warning groups, release-readiness status, prioritized
     samples, and recommended next actions to the evidence gate,
   - rerun reviewed local evidence and confirm palette pressure is no longer a
     top taxonomy item.
14. Semantic Slot Extraction and Tileable Patch Extraction v1: `Done`
   - score slot candidates inside the selected source layout,
   - persist selected/rejected slot evidence and `material_slot_candidates.png`,
   - normalize opposing extracted patch edges before diagnostics and rendering,
   - rerun reviewed local evidence and confirm patch repeated-edge warnings are
     no longer present while slot distinction remains the release blocker.
15. Material Slot Separation v1: `Done`
   - record initial and remaining slot-distinction warnings,
   - apply role-based local material separation and recolor extracted patches,
   - keep explicit layout colors authoritative unless the caller opts into
     automatic semantic selection,
   - rerun reviewed local evidence and confirm release warnings are cleared with
     only source-format advisories remaining.
16. Guarded Rule Map / LDtk Prototype v1: `Done`
   - emit a map-rule compatibility profile for the current corner-mask rules,
   - generate deterministic seeded corner-grid maps from the validated tileset
     plan,
   - validate rule-map edge compatibility before export,
   - render rule-map previews from the actual validated map,
   - export a concrete single-level LDtk project with logical grid placement
     plus 2.5D sprite/pivot/collision metadata,
   - keep full WFC, LDtk auto-layer rule authoring, and interactive map editing
     outside this guarded prototype.
17. LDtk Auto-layer Rules v1: `Done`
   - write `ldtk_auto_layer_rules.json`,
   - add a `TerrainMasks` IntGrid layer and auto-rule groups to `project.ldtk`,
   - validate auto-rule group and rule counts before accepting export.
18. Constraint Map Solver v1: `Done`
   - replace the default seeded map with an AC-3/backtracking local solver,
   - support fixed mask, allowed mask, density, seed, and border constraints,
   - persist `constraint_solver_report.json`.
19. Headless Map Editor Workflow v1: `Done`
   - expose rule-safe edit operations over the corner grid,
   - persist `map_editor_workflow.json` and `map_editor_preview.png`,
   - support `--map-edit` CLI operations before map validation and LDtk export.
20. External Editor Round-trip / Consumer Tool Probe v1: `Done`
   - detect supported local editor command/app availability without launching
     or installing external tools,
   - unpack the release demo ZIP and statically smoke-test packed Tiled/LDtk
     payload references,
   - persist manual-ready round-trip evidence and checklist artifacts while
     keeping saved editor round-trip claims out of scope.
21. Verification:
   - update unit tests,
   - run targeted 2.5D tests,
   - run full `npm test` before committing.

## Acceptance Criteria

The first phase is complete when:

- A no-AI command can generate a deterministic `1024 x 1024` strict atlas.
- Every sprite is aligned to a `64 x 64` cell.
- The logical tile footprint remains `32 x 32`.
- The output has transparent background and no semi-transparent dirty pixels
  unless explicitly allowed by the contract.
- Metadata includes projection, logical tile size, sprite cell size, pivot,
  collision, visual bounds, tile role, and adjacency/corner mask.
- `validation_report.json` can fail or warn with clear global and per-tile
  diagnostics.
- Random, rule-map, grid, and collision previews make 2.5D ordering and
  footprint visible.
- A guarded map-rule sample validates corner-mask edge constraints before
  export.
- A concrete single-level LDtk project can be written with logical grid
  placement and 2.5D sprite/pivot/collision metadata.
- LDtk-style auto-layer rule definitions cover all 16 corner masks.
- The default map can be produced by a local constraint solver with reportable
  decisions and contradictions.
- Headless map editor operations can modify a map while preserving edge
  validation and exportability.
- The release demo ZIP can be smoke-tested as the actual consumer package and
  round-trip evidence can honestly report `not_run` until a supported external
  editor is manually or explicitly automated.
- No external image generation API or network dependency is required.
- Code and file names use neutral project-owned terminology.

## Release Impact

This plan deferred WFC and deeper map-editor features until the local material
bridge could produce strict, reviewable, exportable 2.5D terrain atlases without
relying on provider grid accuracy. The reviewed local material-source set is now
`ready_with_advisories`; guarded map/export, LDtk-style auto-layer rules, a
local constraint solver, and a headless map-editor workflow are implemented.
Browser workflow, consumer package validation, external tool probing, ZIP import
smoke, and manual-ready round-trip evidence are implemented. The remaining
expansion path is saved external-editor round-trip automation, broader
map-editor workflows, larger reviewed source evidence, multi-level worlds, and
full WFC productization; none of those are claimed by this block.
