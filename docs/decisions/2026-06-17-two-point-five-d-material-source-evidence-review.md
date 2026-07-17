# 2.5D Material Source Evidence Review

**Date:** 2026-06-17  
**Status:** Accepted  
**Scope:** Reviewed local manual material-source evidence for the next scene/tile implementation block.

## Evidence Run

Command:

```bash
npm run character-pack -- tileset material-source-evidence \
  --manifest <home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/two-point-five-d-material-source-manifest.json \
  --output-dir generated/two-point-five-d-material-source-evidence \
  --run-id local_2_5d_real_sources_20260617
```

Local-only artifacts:

```text
generated/two-point-five-d-material-source-evidence/local_2_5d_real_sources_20260617/material_source_evidence_gate.json
generated/two-point-five-d-material-source-evidence/local_2_5d_real_sources_20260617/material_source_evidence_gate.md
generated/two-point-five-d-material-source-evidence/local_2_5d_real_sources_20260617/items/<sample-id>/evidence_contact_sheet.png
```

The input manifest lives outside the repository and marks samples as
`user_provided_local_only`. The source images and generated evidence artifacts
must not be committed unless rights are explicitly cleared.

## Result Summary

The gate processed eight manually generated raw terrain sheets:

| Metric | Result |
|---|---:|
| Manifest validation | pass |
| Samples processed | 8 |
| Pass | 0 |
| Warning | 8 |
| Fail/error | 0 |
| Usable artifact rate | 1.0 |
| Blocking deterministic validation errors | 0 |

Per-sample patch warnings:

| Sample | Status | Patch warnings | Notes |
|---|---|---:|---|
| `dual_grid_terrain_test` | warning | 2 | patches extracted, but slot distinction warnings remain |
| `dual_grid_mossy_forest` | warning | 0 | patch texture is usable, slot semantics are weak |
| `dual_grid_dry_rocky` | warning | 5 | repeated-edge patch warnings are high |
| `dual_grid_snowy_ruins` | warning | 2 | patches extracted, but many slots are visually similar |
| `dual_grid_wet_cave` | warning | 0 | patch texture is usable, slot semantics are weak |
| `dual_grid_village_dirt` | warning | 0 | patch texture is usable, slot semantics are weak |
| `dual_grid_mossy_forest_960_prompt` | warning | 7 | all patches warn for repeated-edge mismatch |
| `dual_grid_mossy_forest_connected` | warning | 0 | connected-map structure is sampled as material texture |

Top recurring issues:

- `source_format_normalized_to_png` on all samples: these files have `.png`
  names but JPEG image payloads.
- `palette_color_count_exceeds_max` on all samples: raw model output still
  exceeds the limited-palette contract.
- `material_slot_low_distinction_*` across most samples: fixed six-region
  sampling often extracts visually similar regions for top, corner, shadow,
  transition, and side materials.
- `material_patch_repeat_edge_delta_*` on the weaker samples: extracted patches
  can contain non-loopable tile edges or visible structure.

## Visual Review

Contact sheets support the automated warnings:

- The deterministic composer can produce strict atlas, metadata, and random-map
  preview artifacts for every sample.
- The current fixed `six_region_material_grid_v0` sampler does not understand
  a `4 x 4` dual-grid source sheet. It cuts broad vertical regions across tile
  cells and treats those regions as 2.5D material slots.
- Connected terrain attempts can produce visually interesting previews, but
  path boundaries and map layout structure leak into material patches.
- The later `960` prompt attempt is the weakest extraction case because every
  extracted patch triggers repeated-edge warnings.

## Decision

Do not move directly to WFC, LDtk auto-layer rules, or broader map-editor export
as the next implementation block.

The next implementation block should be **Semantic Material Layout Assist v1**:

1. Keep current `six_region_material_grid_v0` as the baseline layout.
2. Add neutral source-layout candidates such as a `4 x 4` tile-sheet candidate
   and a connected-map/scene-like candidate detector.
3. Score each layout candidate using existing evidence signals: source format,
   palette pressure, sample coverage, slot distinction, patch repeated-edge
   mismatch, and deterministic atlas validation.
4. Persist candidate evidence, selected layout, rejected layouts, and scoring
   reasons in the material-source report.
5. Upgrade the contact sheet or companion preview so reviewers can see why a
   layout was selected.
6. Keep final atlas structure, pivots, masks, collision, metadata, validation,
   and export under deterministic local code.

## Implementation Update

Semantic Material Layout Assist v1 is now implemented. The material-source
builder scores the baseline six-region layout, a compact `4 x 4` tile-sheet
layout, and a connected-terrain probe layout. Explicit `--material-layout`
configuration remains authoritative.

Reports now persist:

- selected layout,
- rejected layout candidates,
- score reasons,
- per-candidate sample regions,
- selected layout fields in CLI and evidence summaries,
- `material_layout_candidates.png` reviewer preview.

The next evidence action is to rerun the local material-source evidence set with
layout assist enabled and compare slot-distinction and patch-repeat warnings
before unblocking WFC, LDtk auto-layer rules, or broader map-editor export.

## Post-Implementation Evidence

The local material-source evidence set was rerun with layout assist enabled:

```bash
npm run character-pack -- tileset material-source-evidence \
  --manifest <home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/two-point-five-d-material-source-manifest.json \
  --output-dir generated/two-point-five-d-material-source-evidence \
  --run-id local_2_5d_real_sources_layout_assist_20260617
```

Result:

| Metric | Result |
|---|---:|
| Manifest validation | pass |
| Samples processed | 8 |
| Pass | 0 |
| Warning | 8 |
| Fail/error | 0 |
| Blocking deterministic validation errors | 0 |

Selected layouts:

| Layout | Count |
|---|---:|
| `tile_sheet_4x4_center_patches_v0` | 5 |
| `connected_terrain_probe_v0` | 3 |
| `six_region_material_grid_v0` | 0 |

This proves the assist is active and can move raw dual-grid or connected terrain
sources away from the baseline six-region assumption. It does not yet justify
WFC or LDtk auto-layer expansion because every sample still carries material
source warnings, especially palette pressure, slot distinction, and repeated
patch-edge issues.

## Quality Closure Update

The next source-quality block added local material-patch palette limiting and a
canonical `quality_closure` report to the evidence gate. The same local source
set was rerun as:

```bash
npm run character-pack -- tileset material-source-evidence \
  --manifest <home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/two-point-five-d-material-source-manifest.json \
  --output-dir generated/two-point-five-d-material-source-evidence \
  --run-id local_2_5d_real_sources_quality_closure_20260617
```

Result:

| Metric | Result |
|---|---:|
| Manifest validation | pass |
| Samples processed | 8 |
| Pass | 0 |
| Warning | 8 |
| Fail/error | 0 |
| Blocking deterministic validation errors | 0 |
| `palette_color_count_exceeds_max` present | no |
| `quality_closure.status` | `not_ready` |

This removes the global palette-pressure warning from the reviewed manual
source path. The remaining release blockers are now clearer: slot distinction is
the top action, followed by tileable patch extraction. `source_format_normalized_to_png`
is still reported, but quality closure treats it as an advisory rather than a
material release blocker.

## Semantic Slot And Tileable Patch Update

The next source-quality block added semantic slot extraction and tileable patch
edge normalization. The same local source set was rerun as:

```bash
npm run character-pack -- tileset material-source-evidence \
  --manifest <home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/two-point-five-d-material-source-manifest.json \
  --output-dir generated/two-point-five-d-material-source-evidence \
  --run-id local_2_5d_real_sources_semantic_tileable_20260617
```

Result:

| Metric | Result |
|---|---:|
| Manifest validation | pass |
| Samples processed | 8 |
| Pass | 0 |
| Warning | 8 |
| Fail/error | 0 |
| Blocking deterministic validation errors | 0 |
| `quality_closure.status` | `not_ready` |
| `material_patch_repeat_edge_delta_*` present | no |
| Samples with `warning_patch_count: 0` | 8 |
| Samples with slot-candidate preview | 8 |
| Samples with active tileability policy | 8 |

Selected layouts:

| Layout | Count |
|---|---:|
| `tile_sheet_4x4_center_patches_v0` | 4 |
| `connected_terrain_probe_v0` | 4 |
| `six_region_material_grid_v0` | 0 |

Semantic candidate pools:

| Candidate count | Samples |
|---:|---:|
| 16 | 4 |
| 32 | 4 |

This closes tileable patch extraction as a top blocker for the reviewed local
source set. The remaining release blocker is material-slot distinction: all
eight samples still carry `material_slot_low_distinction_*` release warnings,
with `dual_grid_snowy_ruins` ranked highest risk.

## Material Slot Separation Update

The next source-quality block added deterministic local material slot
separation. It keeps raw source colors recorded, applies role-separated colors
to top, side, edge, corner, transition, shadow, and decal slots, and recolors
the extracted patches used by strict/runtime atlas renders. The same local
source set was rerun as:

```bash
npm run character-pack -- tileset material-source-evidence \
  --manifest <home>/.gemini/antigravity/brain/3fcf5fac-f4c2-46a2-9016-be474549b35c/two-point-five-d-material-source-manifest.json \
  --output-dir generated/two-point-five-d-material-source-evidence \
  --run-id local_2_5d_real_sources_slot_separation_v2_20260617
```

Result:

| Metric | Result |
|---|---:|
| Manifest validation | pass |
| Samples processed | 8 |
| Pass | 0 |
| Warning | 8 |
| Fail/error | 0 |
| Blocking deterministic validation errors | 0 |
| `quality_closure.status` | `ready_with_advisories` |
| `quality_closure.release_ready` | true |
| Initial slot-distinction warnings | 29 |
| Remaining slot-distinction warnings | 0 |
| Samples with active slot separation | 8 |
| Remaining taxonomy items | `source_normalization.source_format_normalized_to_png` |

Selected layouts stayed balanced across the reviewed set:

| Layout | Count |
|---|---:|
| `tile_sheet_4x4_center_patches_v0` | 4 |
| `connected_terrain_probe_v0` | 4 |
| `six_region_material_grid_v0` | 0 |

This closes material-slot distinction as the current reviewed-set release
blocker. The evidence gate still reports `warning` because all eight local files
have `.png` names with JPEG payloads, but quality closure classifies that as a
source-format advisory rather than a material release blocker.

## Guarded Map Rule / LDtk Prototype Update

The next implementation block added deterministic map-rule and LDtk project
artifacts to the default 2.5D build. It uses the existing `corner_mask_16`
profile to produce seeded corner-grid maps, validates edge compatibility before
export, and writes concrete single-level LDtk project JSON.

New default artifacts:

```text
map_rule_profile.json
tile_map.json
tile_map_validation.json
rule_map_preview.png
project.ldtk
ldtk_project_validation.json
```

Current scope:

- `map_rule_profile.json` records compatible neighbor masks for each edge.
- `tile_map_validation.json` fails incompatible adjacent masks before export.
- `rule_map_preview.png` renders the actual validated map, separate from the
  older random tile preview.
- `project.ldtk` uses logical grid placement and stores 2.5D sprite cell,
  pivot, collision, and visual-bounds metadata in tileset custom data.

This is a guarded prototype. It proves concrete map/export plumbing from the
current 2.5D contract; it does not claim full WFC productization, LDtk
auto-layer rule authoring, or an interactive map editor.

## Ordered Map Expansion Update

The next ordered expansion implemented the three follow-up blocks in guarded
form:

1. **LDtk auto-layer rule authoring** now writes `ldtk_auto_layer_rules.json`
   and embeds a `TerrainMasks` IntGrid layer plus auto-rule groups in
   `project.ldtk`.
2. **Constraint map solver** now uses a local AC-3/backtracking solver by
   default and writes `constraint_solver_report.json` with constraints,
   propagation, decision, and contradiction evidence.
3. **Headless map-editor workflow** now writes `map_editor_workflow.json` and
   `map_editor_preview.png`, and supports rule-safe CLI edit operations such as
   terrain rectangle paint/erase before validation and LDtk export.

This moves the map/export layer beyond a static preview while keeping claim
boundaries intact: there is still no browser map-editor UI claim, no LDtk editor
round-trip evaluation, and no full WFC productization claim.

## Map Editor / Workflow Productization Closure Update

The next productization closure moved the guarded headless workflow into a real
browser/API path:

1. **Browser map editor UI** now exposes a `2.5D Tileset` tab with material
   source upload, map dimensions, solver/border/density/seed controls,
   paint/erase/corner operations, local preview, export links, and release
   evidence summary.
2. **LDtk workflow validation** now writes `ldtk_workflow_validation.json` with
   static import-readiness checks for JSON round-trip, layer references, UID
   collisions, TerrainMasks int-grid values, auto-rule tile references, tileset
   relPath consistency, and auto-layer tile coverage.
3. **End-to-end workflow evidence** now writes
   `workflow_release_evidence.json` and `.md`, tying source normalization,
   material slots, atlas validation, constraint solving, map editor edits, LDtk
   readiness, and Tiled exports into one checklist.

Local smoke coverage now runs the browser/server path against a generated
material source and one map edit operation. This is product workflow evidence,
not an external LDtk editor launch or full WFC productization claim.

## Export Consumer Validation / Release Demo Pack Update

The next closure validates the generated payload as a portable downstream
consumer package:

1. **Consumer package audit** now writes `consumer_package_audit.json` and
   checks required payloads, package-relative paths, duplicate package paths,
   PNG/JSON parseability, local absolute path leaks, and editor image-reference
   consistency.
2. **Practical import validation** now writes `import_validation.json` and
   statically verifies the Tiled JSON/TSX and LDtk project payloads against the
   same strict atlas reference without claiming external editor launch.
3. **Release demo pack** now writes `release_demo_manifest.json`,
   `release_demo_README.md`, and `release_demo_pack.zip` with root-level
   `strict_atlas.png`, `runtime_padded_atlas.png`, `project.ldtk`,
   `tileset.tiled.json`, and `tileset.tsx` so relative editor references remain
   portable.

This closes the local consumer handoff loop for a demoable sample pack. It is
still not an external LDtk/Tiled editor round-trip, multi-level world authoring,
or full WFC productization claim.

## External Editor Round-trip / Consumer Tool Probe Update

The next evidence block adds a guarded external-consumer layer without launching
or automating third-party editors:

1. **Tool availability probe** now writes `external_tool_probe.json` and records
   whether supported local editor commands or app bundles are detected. It does
   not install, launch, import, save, or store absolute local tool paths.
2. **External import smoke** now writes `external_import_smoke.json` by unpacking
   `release_demo_pack.zip`, parsing the packed JSON payloads, and validating
   packed Tiled/LDtk image references against actual ZIP entries.
3. **Round-trip evidence slot** now writes
   `external_roundtrip_validation.json` and
   `external_roundtrip_checklist.md`. When no supported editor is detected, the
   status remains `not_run`, while `ready_for_manual_roundtrip` can still be
   true if static package/import checks pass.

This makes the next manual or automated editor round-trip measurable instead of
implicit. It is still not a saved external editor round-trip result, not
multi-level world authoring, and not full WFC productization.

## Release Impact

This review moves the next scene/tile block from source-quality hardening toward
guarded map-rule/export prototyping, and the ordered map expansion, browser
workflow closure, export consumer validation pack, tool availability probe, ZIP
import smoke, and round-trip evidence slot are now implemented. Saved external
editor round-trip validation, region-scoped generation, broader map-editor
workflows, multi-level worlds, and full WFC productization remain separate
follow-up blocks with their own evidence requirements.

The claim boundary remains: manual model output can be used as raw local
material evidence after deterministic local normalization and separation, but
arbitrary raw terrain sheets are not yet proven production-ready without larger
and more diverse reviewed evidence.
