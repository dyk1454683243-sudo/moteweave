# Technology Reference Roadmap

**Date:** 2026-05-25  
**Status:** Active  
**Owner:** Project lead  
**Scope:** External tool patterns, public formats, interoperability ideas, and ecosystem entry points that may influence future product work.

This document is a roadmap filter, not an implementation plan. It records what the project may learn from adjacent tools and ecosystems, but it does not approve source-code copying, asset redistribution, competitor branding, or feature work outside the current release scope.

Before proposing a feature inspired by another tool:

1. Search this document for the feature or format.
2. If it is listed, respect its current classification and target version.
3. If it is not listed, discuss adding it before planning implementation work.
4. If the feature depends on third-party code, assets, model training data, or brand-sensitive naming, check `AGENTS.md` and `ATTRIBUTIONS.md` first.

## Classifications

- `Core`: Expected to enter the near-term product path once tests and design are clear.
- `Candidate`: Plausibly useful, but requires benchmark results, user pressure, or direction selection.
- `Experiment`: Worth testing in a narrow prototype before committing to product scope.
- `Deferred`: Keep out of the current roadmap unless the product strategy changes.

## Current Direction

The near-term product path is:

1. Make failures observable before adding large new features.
2. Stabilize character generation, normalization, preview, and export.
3. Add ecosystem exports that improve real workflows.
4. Use benchmarks and real generated sheets to decide which candidates graduate.

### 2026-07-16 Character And Motion Quality Insert

The advisory review recorded in
`docs/superpowers/plans/2026-07-16-character-production-quality-master-plan.md`
adds five original repository-owned blocks to the near-term sequence:

| Block | Classification | Current decision |
| --- | --- | --- |
| Generation Release Gate | Core / P0 | Implemented and provider-free focused-verified on 2026-07-16 |
| Motion Source Correctness & Safety | Core / P0 | Implemented and provider-free guarded-verified on 2026-07-16; closed in the independent B commit |
| Pixel Grid v2 | Candidate / P1 | Complete; implementation commit `0a6353a` |
| Motion Selection v2 | Candidate / P1 | Complete; implementation commit `f6a6a03` |
| Guided Motion Source UI/HUD | Candidate / P2 | Complete; implementation commit `493f609` |

Semantic release blocking, adaptive candidate spending, per-action
high-quality generation, and default OKLab refinement remain `Experiment` or
`Deferred`. The external suggestion page is evidence for prioritization only;
it does not authorize copied code, UI, algorithms, prompts, branding, or assets.
This roadmap entry originally recorded direction only. The project lead later
authorized sequential C, D, and E implementation; all three are now complete
under their own design/contracts, guarded verification, and independent
implementation commits. That authorization does not extend to the deferred
experiments above.

The Motion P0 contract is intentionally narrower than future selection/UI work.
It makes Auto/Manual authority explicit, streams raw browser media under
200 MiB video, 64 MiB GIF/ZIP, 32 MiB raster, and 16 MiB legacy Motion JSON
ceilings, and binds source SHA-256, operation id, canonical options hash, job id,
and browser source epoch. Poll abort, server cancellation, and same-process
Resume remain distinct; a restart requires re-upload. Browser/API local input,
output, FFmpeg, and rembg paths are rejected. Decode budgets and a
single-concurrency 1536 MiB process-tree boundary protect optional local FFmpeg
and rembg work. Upload storage is explicitly releasable and current-process
bounded at 16 live uploads/writes, 512 MiB live-plus-reserved capacity, and 1024
upload-operation records; Motion lifecycle bindings have a separate 1024 cap.
Release intent can be recorded before a descriptor arrives, active references
defer unlink, and an exact bound operation can replay after release while new
operations cannot. ZIP central-directory preflight plus actual chunk-counted
inflation and bounded FFmpeg scale/output evidence close compressed-media risks.
External-tool process-group supervision is POSIX-only; Windows fails closed
before spawn. This block makes no Provider call and bundles no tool, model,
weight, plugin, or asset.

Final guarded verification passed `1357 / 1357` tests in `135.864s` at
`831568 KiB` peak process-tree RSS. The self-hosted local smoke passed in
`3.741s` at `708432 KiB` peak RSS, used provider-free routes, and left no
tracked smoke/server process. These are implementation and lifecycle results,
not live Provider-quality evidence.

Final C/D/E closure verification passed `1431 / 1431` tests in `151.804s` at
`846,256 KiB` peak RSS and `6` peak processes. The Guided Motion Source Chrome
matrix passed in `11.734s` at `1,630,048 KiB` peak RSS and `11` peak
processes, with real provider-free operations, 1440/1024/800/390 responsive
checks, stale/missing/unreadable artifact fault injection, and no console
errors. The final independent local smoke passed in `3.867s`, at
`735,920 KiB` peak RSS and `3` peak processes. Two read-only reviews found no
remaining Blocker/High.

For v0.4, Direction A (Scene Generation) is selected. The first work is not tile
generation itself; it is Phase 0 pixel style pipeline debt so scene tiles can be
measured and corrected on stable local primitives before arrangement/export work.
After starter contracts, the next priority is a provider-free scene tile quality
gate for seam, self-loop, and shared-style checks.
The following step is a dry-run tile prompt contract before any live model calls.
The delivery layer now writes local scene pack artifacts and ZIPs. Single-level
LDtk project export is in place, and provider-free scene tile preview now accepts
real padded tile sheets. A guarded one-call live scene tile smoke now routes
provider output through the same ingestion, quality gate, LDtk export, and ZIP
artifact path; broader tile-generation claims still require real gate results.
The first prompt-only seam/self-loop closure pass upgraded the tile prompt
contract to `scene_tile_prompt_contract_v0_2`, but two live smokes still failed
the quality gate. A minimal opt-in local edge-conditioning prototype now makes
those stored source sheets pass the structural seam/self-loop gate without a
provider call, but visual inspection still shows this is a structural repair
rather than final tile art quality. The next scene-quality unit should decide
between finer edge-aware conditioning and stricter raw tile-structure
generation before WFC or map-editor work.
That decision is now made: `edge_aware_conditioning_v1` reduces mutation and
passes structural gates, but live visual review still warns. The next scene
quality block should improve raw tile structure before WFC or map-editor work.
The first raw-structure unit now upgrades the provider prompt contract to
`scene_tile_prompt_contract_v0_3` and adds a warning-only
`source_atlas_structure` gate so generated sheets that read as one continuous
scene can be detected before arrangement work.
The next raw-quality unit adds a raw tile policy layer: duplicate referenced
runtime tiles and continuous source-atlas structure still default to warnings
for exploratory upload/generation, but release/live gates can now run in
`strict` mode and fail on those signals. Scene tile reports now summarize sample
size, raw tile policy, correction paths, gate status, and taxonomy together.
The pixel style pipeline now has opt-in scene tile palette snapping via
`--style-snap`; default character and scene outputs remain unmutated unless the
flag is explicitly used.
The scene tile quality gate now also warns when distinct referenced masks
collapse to duplicate runtime tile images, reducing false confidence before WFC.
A deterministic `rule_based_dual_grid_v0` arrangement mode now gives preview,
ingestion, and LDtk export a seeded procedural path without claiming full WFC.
Project pack export now combines existing character and scene outputs into one
manifested ZIP while keeping child artifacts in separate folders.
The browser UI now exposes scene tile rule/style/edge controls and a project
pack tab that combines current character and scene jobs through the local API.
The v0.4 release closure live scene gate passed once with style snap and
edge-aware conditioning enabled; treat this as release-smoke evidence, not a
large-sample scene quality claim.
After character text-to-image cleanup, background cleanup, local image
benchmarking, and first GitHub publication, insert a short v0.4.1 Quality
Infrastructure block before the next scene/tile deepening unit. This block
formalizes neutral local golden sets, gate layering, user-configured
provider/model adapters, live benchmarks through the unified adapter, and
visual quality reports. It is recorded in
`docs/superpowers/plans/2026-06-16-v041-quality-infrastructure.md` and should
not be treated as a replacement for the selected scene/tile direction.
The next scene/tile deepening unit now adds bounded multi-candidate live tile
generation, deterministic best-candidate selection, candidate evidence files,
and live report taxonomy for failed candidates. This improves evidence quality
for raw tile generation, but it is not WFC readiness by itself. Use strict live
gate samples from this layer before deciding whether to proceed to LDtk
auto-layer rules, WFC/rule arrangement expansion, or another raw-quality pass.
A first 5-case, 4-candidate strict live gate was planned on 2026-06-17, but no
provider route returned an image: OpenRouter routes were blocked before
generation and the native Gemini route had no usable quota. Treat this as a
provider-access blocker, not as tile-quality evidence.
The goal now has a manual external scene evidence branch: five Gemini-generated
scene images created outside the unified adapter were ingested provider-free
through the strict scene tile path and passed after style snap plus edge-aware
conditioning. This lets evidence review and next-step planning continue, but it
does not replace the original 5-case, 4-candidate live gate because there is no
candidate-selection distribution, failed-candidate taxonomy, or unified provider
metadata. The next implementation block should reduce raw-output correction
dependency before WFC, LDtk auto-layer rules, or broader map-editor work. A
provider-free raw/style/edge correction matrix now makes that dependency
measurable from source sheets. The raw-output quality pass is planned in
`docs/superpowers/plans/2026-06-17-scene-tile-raw-output-quality-pass.md`.
Raw-quality closure is now underway with per-sample raw diagnostics,
`scene_tile_prompt_contract_v0_6`, and a provider-free manual prompt pack for
external Gemini re-tests. The first v0.5 external images were supplied, but the
original files were JPEG-encoded `1024x1024` images with `.png` names and were
rejected by the retest helper as `source_sheet_size_mismatch`. A normalized
`192x192` PNG diagnostic run completed, but raw readiness remained `not_ready`
with raw seam, self-loop, and source-atlas failures. WFC and LDtk auto-layer
expansion remain gated until a contract-compliant v0.6 manual matrix or a live
`5 x 4` gate reaches raw readiness. The v0.6 prompt/handoff layer removes
visible mask-coordinate placement lists from the model-facing prompt, adds a
true PNG/`192x192` export checklist, and preflights present manual inputs for
format and size before matrix execution.
The next large scene/tile block is now a local 2.5D no-AI tileset MVP rather
than another attempt to make external image models emit strict atlases. The
schema-first smoke exists, but the implementation plan now requires a
deterministic `1024 x 1024` strict atlas, neutral 16-corner-mask rule profile,
procedural material composition, pixel-level validation, richer metadata, and
random/grid/collision previews before WFC, LDtk auto-layer expansion, or broader
provider-quality claims. This plan is recorded in
`docs/superpowers/plans/2026-06-17-two-point-five-d-no-ai-mvp.md` and refines
the protocol in `docs/protocols/two-point-five-d-tileset-pipeline.md`.
The first contract/rule-profile unit is complete: strict atlas size is explicit,
the full atlas grid is derived from that size, and the occupied 16-mask rule
profile is now neutral `corner_mask_16` instead of a hard-coded atlas grid.
The procedural material unit is also complete: local deterministic material
profiles now drive top, side, edge, corner, transition, shadow, and decal fills
for strict/runtime atlas renders plus material-profile evidence artifacts. Pixel
validation and richer preview artifacts are now complete as local hardening
blocks: strict atlas reports include rendered-pixel diagnostics, and the pipeline
emits grid, collision, and seeded random-map previews. Runtime padding metadata
and export metadata polish are also complete: strict-to-runtime coordinate
mapping, tile roles, terrain types, visual bounds, z-order hints, validation
status, and Tiled per-tile properties are now recorded. The next implementation
block adds a first manual-source bridge: optional material sources are normalized
to a controlled PNG canvas, sampled into material profiles, and routed through
the deterministic composer without treating the source image as a clean atlas.
Material extraction quality diagnostics are now added as well: sample regions
report empty, low-coverage, low-contrast, overexposed, and underexposed inputs,
sampling layouts can be configured, and overlay previews make source regions
reviewable. Source authoring guidance now converts those diagnostics into
JSON/Markdown feedback for the next manually generated material source. The
first Manual Source Material Extraction v1 block is now implemented: normalized
manual sources produce fixed-size material patches, patch-quality gates,
`material_patches.png`, and patch-texture atlas rendering while deterministic
local code still owns the 2.5D tile structure. Reviewed Manual Source Evidence
Gate v1 is now implemented as well: local manifests batch material sources
through normalization, extraction, validation, report generation, and comparison
contact sheets with automatic pass/warning/fail policy. The next scene/tile
block used those reviewed results to decide between broader semantic extraction
and map-rule/export expansion: eight local manually generated terrain sources
all processed without deterministic blockers, but all remained warnings because
fixed six-region sampling does not understand arbitrary `4 x 4` dual-grid or
connected terrain layouts. The next implementation block is therefore Semantic
Material Layout Assist v1: scored source-layout candidates and reviewable
selected/rejected layout evidence before WFC, LDtk auto-layer rules, or broader
map-editor export. Semantic Material Layout Assist v1 is now implemented with
baseline, `4 x 4` tile-sheet, and connected-terrain layout candidates,
selected/rejected layout evidence, `material_layout_candidates.png`, and
CLI/evidence summary fields. A reviewed local rerun selected `4 x 4` layout for
five samples and connected-terrain probes for three samples, with no
deterministic blockers, but all eight samples remained warnings. Keep WFC, LDtk
auto-layer rules, and broader map-editor export gated until material-source
warnings drop further. Material Source Quality Closure v1 is now implemented:
material patches are locally palette-limited from the contract budget, evidence
reports include canonical `quality_closure` release-readiness data, and the
reviewed rerun removed `palette_color_count_exceeds_max` from the eight-sample
taxonomy. Semantic Slot Extraction v1 and Tileable Patch Extraction v1 are now
implemented: reviewed local evidence writes slot-candidate previews for all eight
samples, activates tileable patch normalization for all eight samples, and removes
`material_patch_repeat_edge_delta_*` from the taxonomy with
`warning_patch_count: 0` on every sample. At that point closure still remained
`not_ready` because all eight samples carried material-slot distinction release
warnings, so the next quality work targeted stronger material-slot separation
rather than tileability.
Material Slot Separation v1 is now implemented as that follow-up: reviewed local
evidence uses deterministic role palette separation and patch recoloring for all
eight samples, reduces initial slot-distinction warnings from 29 to 0, and moves
`quality_closure.status` to `ready_with_advisories`. The only remaining reviewed
taxonomy item is the source-format advisory for JPEG payloads with `.png`
filenames. WFC, LDtk auto-layer rules, or broader map-editor export can now be
considered as a guarded prototype against this reviewed local material-source set,
but not as a broad arbitrary-source production claim.
The first guarded prototype is now implemented: deterministic seeded corner-grid
rule maps write `map_rule_profile.json`, `tile_map.json`,
`tile_map_validation.json`, `rule_map_preview.png`, single-level `project.ldtk`,
and LDtk validation evidence from the 2.5D contract. This is concrete
map/export evidence, not full WFC productization, LDtk auto-layer rule authoring,
or an interactive map editor.
The next ordered expansion is also implemented in guarded form: LDtk-style
auto-layer rules now cover all 16 corner masks, the default map path uses a
local AC-3/backtracking constraint solver with `constraint_solver_report.json`,
and a headless map-editor workflow supports rule-safe corner-grid edits through
CLI/artifact inputs. The workflow productization closure now adds a browser
2.5D map editor tab backed by a real local tileset job, static LDtk
import-readiness validation, and end-to-end workflow release evidence. This
still does not claim external LDtk editor launch, editor round-trip evaluation,
or full WFC productization. Export consumer validation now adds a portable
release demo ZIP, package audit, and static practical import validation for the
Tiled/LDtk payloads. This proves self-contained local consumer artifacts, while
external editor launch, round-trip editing, multi-level worlds, and full WFC
productization remain later boundaries. External editor round-trip evidence now
has a first local layer: supported tool availability probing, packed ZIP import
smoke, and manual-ready round-trip artifacts are written without claiming
unattended editor launch or saved editor round-trip success.
AI Material Source Bridge v1 now connects the unified provider adapters to the
2.5D material-source path through a neutral raw-source prompt contract and
guarded one-call quota flow. Provider output is saved as raw source evidence and
then normalized/sampled by local deterministic code; it is not treated as a
strict atlas, clean tileset, or broad provider-quality claim. Multi-candidate
Material Source Benchmark v1 now adds bounded provider raw-source candidates and
deterministic local ranking evidence. Browser Material Source Benchmark Entry v1
now exposes dry-run plans and guarded live benchmark jobs through the 2.5D tab
without weakening quota confirmation. Focused benchmark report review is now in
place as a deterministic decision summary in JSON, Markdown, and the browser UI,
separating provider blockers from local material-quality warnings. The next
provider-facing work, if selected, should be a larger sampled benchmark or a
targeted fix from the review decision, while arbitrary-source production
readiness still depends on broader source evidence.

The next cross-cutting cleanup before more character generation claims is a
commercial naming audit for the character fixed-region source layout. Public
UI, docs, API payloads, and newly written metadata should move toward neutral
project-owned names such as `fixed_region_motion_v0` / "fixed-region motion
sheet"; the older source-layout id may remain only as a backwards-compatible
alias during migration. This is a naming and claim-boundary cleanup, not a
change to export compatibility. This cleanup is now implemented for the default
layout id, prompt-contract metadata, UI option values, provider prompts, debug
reports, editor metadata, benchmark summaries, and current runbooks. The first
source-quality block is now implemented: fixed-region processing writes
per-region occupancy, white-edge/halo, edge-pressure, source-layout alignment,
expected static reuse, and multi-frame source-action motion evidence to
`source_quality_report.json`, and production-sheet candidate selection uses
those metrics before choosing the selected provider image. Character quality
closure now produces provider-agnostic repair tasks, and the targeted repair
loop can apply provider-free local halo/anchor stabilization, revalidate the
normalized sheet, write before/after evidence, and emit provider dry-run
contracts for semantic animation repairs. The remaining character-quality work
is to connect those provider dry-run contracts to an explicit live repair pass
after local repair evidence is reviewed. The recent youth/RM plugin ZIP review
confirms that adjacent tooling
also consumes `252 x 252` fixed-region source sprites through local slicers, but
the supplied package does not expose a provider-side model-control algorithm
that can be copied or treated as a quality guarantee.

Character Repair UI and Pixel Finishing have moved from planning into the first
browser/local productization layer, recorded in
`docs/superpowers/plans/2026-06-21-character-repair-ui-pixel-finishing.md`.
The explicit one-action provider repair loop now has browser entry points, dry
repair plans, quota-confirmed one-call live repair, repaired strip/sheet
artifacts, and export continuation. It remains a user-selected repair workflow:
the project does not claim automatic semantic facing/action judgment,
multi-candidate blending, or unconfirmed replacement. The recent preview and
local-upload hardening also records the current product boundary: character
inspection previews are emitted as artifacts, the workspace preview prefers the
transparent inspection sheet over the raw upload, the action gallery uses a
fixed-zoom inspection view for easier human review, local fixed-region uploads
share the same staged crop/matte cleanup as generation, and local-only prompt
fields are hidden from the upload flow. The remaining Pixel Finishing direction
is a deterministic character-pack output path: palette snap, alpha/edge cleanup,
small-component cleanup, optional outline, nearest-neighbor scale/export, and
before/after metrics. Public references support these neutral technical
patterns, but implementation must remain project-owned and must not copy
competitor code, private templates, assets, naming, or product claims.

The next small cross-cutting UI polish item is a language surface for the
browser app, starting with Chinese and English labels. This should be a neutral
dictionary-backed UI layer with a top-right language switcher and persisted
local preference. It should start with the Character Pack workflow and should
not change provider prompts, generated metadata, export formats, or quality
claims until those strings have their own explicit contract.

Editor Workspace is selected as the v0.5 direction, recorded in
`docs/decisions/2026-06-22-editor-workspace-direction.md` and planned in
`docs/superpowers/plans/2026-06-22-editor-workspace-v0-plan.md`. The first step
is documentation and protocol only: `editor_project_v0`,
`editor_asset_ref_v0`, `editor_scene_v0`, `editor_interaction_v0`, and
`processing_recipe_v0`. Scene Authoring Workspace, Artifact Registry, Project
Store, Asset Library, Layer Editor/Inspector, Timeline, and Visual Repair are
Core once their protocol and tests exist. Interaction, Playtest, and Scene Flow
remain Candidate until the core editor path is stable. PixiJS/WebGL rendering is
Deferred and performance-gated. Full Pixel Editor remains Not Planned. This path
must be parallel-not-replace, use real generated/uploaded artifacts, and keep
existing character, motion, scene, 2.5D, provider, benchmark, and exporter
contracts unchanged unless a later phase explicitly authorizes a contract change.
Editor Workspace v0 is now implemented on the main line, including the parallel
`/editor` shell, project persistence, scene authoring canvas, timeline,
project asset library, interaction/playtest support, scene flow, project pack
export, engine handoff preview metadata, export review UI, and consumer evidence
review files. The current boundary remains preview handoff metadata only: no
bundled engine plugin, no generated native Godot scene file, no complete LDtk
world export, no provider calls, and no replacement of legacy endpoints.

The next character-production direction is a third, parallel Motion Source
track rather than another attempt to make one provider call emit a complete
multi-action sheet. Phase A is provider-free: user-provided GIFs, frame
sequence ZIPs, single images, and optional local videos are treated as raw
motion sources, then local code extracts frames, selects a single-action strip,
cleans background edges, normalizes anchors, and applies the reviewed strip to
the existing character-pack validator/export path. This work is planned in
`docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md` and specified
in `docs/protocols/motion-source-pipeline.md`. The existing GIF/ZIP/single-image
extractor, flood defringe fix, and low-level external-FFmpeg frame extraction
are already implemented; apply-strip, guarded source-set apply, API/UI entry,
and editor handoff are now provider-free production features for reviewed local
inputs. AI video source creation remains deferred. Source authoring guidance
must require transparent alpha or a flat solid key-color background for
externally generated motion sources. `motion_source_contract_v1`
and provider-free source analysis are now implemented with corrupt-source
preflight and FFmpeg availability metadata. The deterministic frame selector is
now implemented as a quality gate with duplicate filtering, stable frame
sampling, motion-delta evidence, and loop-seam warnings before strip building.
The single-action strip MVP is also implemented: extracted GIF/ZIP/single-image
frames can build `normalized_motion_strip.png`, `motion_contact_sheet.png`,
`motion_source_report.json`, and `selected_frames.json` through the provider-free
CLI path while recording halo cleanup, source-background warnings, selected
frames, and normalization evidence. Apply-strip into `topdown_rpg_v0` is now
implemented as a CLI/core path: one runtime action can be replaced, 8-to-4 frame
mismatches are rejected by default, and explicit nearest-keyframe resampling
records its source-to-target mapping without blending pixel art. The
multi-action identity guard is now implemented as a provider-free CLI/core
analysis path: `motion_source_set_v1` manifests are validated, short per-action
strips can be checked against a shared identity anchor, and
`identity_consistency_report.json` blocks multi-strip apply when palette,
silhouette, bbox, baseline, or direction evidence fails. Local async API
endpoints are now available for motion source analysis, strip building, strip
apply, and source-set analysis; they write real job artifacts and do not require
provider keys. The browser `Motion Source` entry is now implemented as a
parallel provider-free tab: it uploads GIF/ZIP/still/video sources, exposes real
video timing, max-frame, background cleanup, anchor/resample, frame-preview, and
manual frame-selection controls, renders contact sheets, selected-frame
evidence, normalized strips, generic sequence-frame exports, apply results, and
identity reports only from completed job artifacts, and keeps existing character
generation reachable. Video upload requires local FFmpeg; optional local
rembg/U2Net matting is gated behind an external user-installed CLI. Editor
handoff v1 is now implemented as neutral JSON-array frame metadata,
a same-size strip re-import manifest, artifact writing, and an optional local
editor command bridge gated by `SPRITE_EDITOR_PATH`; no editor binary or plugin
is bundled. An encoded GIF/ZIP workflow regression now exercises analyze,
extraction, single-action strip build, identity gate, apply-strip, character
validation, and editor handoff using temporary generated media, without
committing motion-source fixture files. This is integration evidence for the
provider-free path, not a broad real-user sample benchmark. Guarded multi-strip
apply is now implemented in CLI, API, and browser UI: `motion_source_set_v1`
plus the identity gate assemble reviewed single-action strips into one
normalized sheet, with an explicit `motion_source_set_apply_report_v1` and no
provider or AI-video dependency. Do not treat one long AI-generated video as the
default route for a full action library.

The approved Motion Source Correctness and Safety v1 hardening keeps this
provider-free product boundary while correcting authority and resource
semantics. Preview frames are candidates and default to Auto; Manual requires an
explicit ordered index list and can be restored to Auto. Browser media uses a
server-owned raw upload descriptor rather than Base64 amplification. Analyze,
Preview, Build, artifact rendering, cancellation, and same-process Resume are
bound to exact source/operation/options/job identities. Legacy Motion JSON is
bounded at 16 MiB, compressed/decompressed media has independent decode budgets,
and browser/API FFmpeg/rembg operations are serialized behind bounded
process-tree supervision with stable no-retry errors. Uploads have explicit and
deferred release, pre-descriptor release intent, bounded session ledgers, and
exact replay after release. ZIP declarations and actual inflated bytes are both
bounded; FFmpeg records dynamic `bounded_scale_v1` and output-byte evidence.
In-process JSZip/Sharp cancellation is cooperative, POSIX external tools receive
verified process-group termination, and Windows fails closed before spawn.
Client-provided local/tool paths are not authority. Motion Selection v2 registration/global clustering/
periodicity/action phases/temporal matte and the Guided Motion Source UI/HUD were
delivered in the separate D/E blocks and are not part of this P0 baseline.

Scene/tile work remains on the already-recorded raw-quality path. The 2.5D
local tileset pipeline has progressed through guarded map/export, auto-layer,
solver, browser workflow, consumer package, and benchmark-review layers. Broader
scene WFC, multi-level worlds, saved external-editor round-trip, or additional
map-editor expansion should stay gated until raw/corrected scene evidence shows
less dependency on heavy palette snap and visible edge mutation.

For v0.3, prioritize diagnostics and validation ahead of broad feature expansion:

1. Source-region edge pressure diagnostics for fixed-layout sheets. `Done; debug-only unless normalized runtime frames also show edge/crop risk`
2. A real-generation benchmark gate. `Done for 20-case data collection; OCAD is now default generation entry, expected source reuse split from duplicate-motion debt, source-region pressure reclassified as diagnostic`
3. Structured prompt contracts for generation layouts, style identity, negative constraints, and validation expectations. `Done`
4. Aseprite-compatible frame tag export. `Data layer done`
5. Aseprite-compatible slices for attachment points. `Data layer done`
6. CLI access once the pipeline behavior is stable. `Done`
7. Palette/style enforcement as report-only or opt-in at first. `Moved to v0.4 Phase 0; first report-only local metrics implemented, automatic correction deferred`
8. Multi-resolution output and preview polish after the above. `Multi-resolution output done; preview transition polish remains`

## Mode Boundary

Keep exploratory generation separate from production slicing:

- `Exploration Mode`: generate animation direction, key poses, style variants, and asset-family ideas before strict cleanup. Outputs may be useful as references, but they are not assumed to be immediately sliceable.
- `Production Mode`: enforce exact layout, frame count, background, source-layout semantics, Row GIF validation, debug reports, and export packages.

This boundary lets the project learn from broad game-asset ideation tools without weakening the strict character-pack pipeline.

## Reference Items

| # | Source | Pattern / Format | Classification | Target | Effort | Needs SD? | Notes |
|---|---|---|---|---|---:|---|---|
| 1 | Retro Diffusion | Pixel-art post-process pipeline: palette extraction, palette snap, nearest-neighbor downsample, outline strengthening, upscale | Core | v0.4 Phase 0 | 2-3 days | No | First provider-free report-only unit implemented; outline strengthening and automatic correction remain deferred. |
| 2 | Aseprite | Frame tag JSON export in hash-style spritesheet metadata | Core | v0.3 | 1-2 days | No | Data layer shipped in `editor_metadata.json`; importer/editor UI polish remains optional follow-up. Interoperability format only; do not copy editor code. |
| 3 | Aseprite | Slice metadata for attachment points | Core | v0.3 | 1-2 days | No | Data layer shipped in `editor_metadata.json`; visual overlay/importer polish remains optional follow-up. |
| 4 | Aseprite / TexturePacker | CLI command exposure for generate, process, export, and benchmark flows | Core | v0.3 | 1 day | No | Best after pipeline outputs are stable. |
| 5 | Spine | Animation mix/crossfade behavior in playable preview | Core | v0.3 | <1 day | No | Preview-only polish; no runtime dependency. |
| 6 | PixelLab | Multi-resolution sprite outputs: 96, 64, 48, 32, 16 px | Core | v0.3 | Done | No | Shipped as nearest-neighbor `normalized_sheet_<size>.png` artifacts plus `multi_resolution.json`; preview transition polish remains separate. |
| 7 | TexturePacker | Declarative export profiles with JSON config plus one executor | Core | v0.3.1 | 1-2 days | No | Keep as cleanup after v0.3 exports settle. |
| 8 | PixelLab | Chat/community command entry point for text-to-pack generation | Candidate | v0.4 | 2-3 days | No | Useful only after the core workflow is good enough to share. |
| 9 | PixelLab | Runtime API for game-engine server-side generation calls | Candidate | v0.4 | 1-2 days | No | More valuable if the project is used by the owner's game pipeline. |
| 10 | PixelLab | Aseprite editor integration through Lua scripting | Candidate | v0.4 | 1 week | No | Consider after CLI and exports are solid. |
| 11 | PixelLab | Inpainting/edit endpoint with mask plus instruction | Candidate | v0.4 | 3-5 days | No | High value if single-frame fixes become the main pain. |
| 12 | LDtk | Auto-tile rule format | Candidate | v0.4 scene direction | Done | No | 2.5D guarded path now writes LDtk-style `TerrainMasks` IntGrid values and auto-rule groups for all 16 corner masks; package/static import validation, tool probe, and ZIP import smoke are done; saved external editor round-trip remains later. |
| 13 | LDtk | Entity field definitions | Candidate | v0.4 scene direction | Done | No | First pass shipped in single-level LDtk project export; entity placement UI remains later. |
| 14 | LDtk | JSON project export | Candidate | v0.4 scene direction | Done | No | Single-level project JSON shipped with tileset, Tiles, TerrainMasks, Entities, auto-rule metadata, package audit, static import validation, release demo ZIP, tool probe, and round-trip evidence slot; multi-level worlds remain later. |
| 15 | WFC | Wave Function Collapse for tile map generation | Experiment | v0.4 scene direction | Prototype done | No | Local AC-3/backtracking constraint solver now produces validated 2.5D maps with reports; full WFC productization and benchmark breadth remain later. |
| 16 | PixelLab | 8-direction rotation lock through pose/control guidance | Experiment | v0.5 | 2-3 weeks | Yes | Too heavy until basic generation is stable and SD adoption is justified. |
| 17 | Scenario.gg | Custom style model training from user uploads | Experiment | v0.5 | 2-3 weeks | Yes | Requires strict training-data policy and model-card metadata. |
| 18 | Spine | Skin/equipment separation system | Candidate | v0.5 | 2-3 weeks | No | Valuable for games, but not needed for the first reliable character pack workflow. |
| 19 | DragonBones | File format and browser runtime export path | Deferred | v0.5+ | 1-2 weeks | No | Defer until users request it. |
| 20 | Inworld AI | NPC dialogue and behavior integration | Deferred | v0.5+ | 1-2 weeks | No | Outside the current sprite pipeline. |
| 21 | PixelLab | Community asset library for shared packs | Deferred | v1.0+ | 2-3 weeks | No | Needs users, moderation, licensing, and storage policy first. |
| 22 | PixelLab | Credit-based subscription billing | Deferred | v1.0 | 1 week | No | Commercialization work belongs after product validation. |
| 23 | Meowa | Structured game-asset prompt contracts: layout, identity, style, negative constraints, and validation expectations compiled into provider prompts | Core | v0.3 | 1-2 days | No | Shipped in `promptContracts.js`; learn from asset-workflow framing, not copy wording. |
| 24 | Meowa | Local benchmark gallery: prompt, provider config, output image, Row GIF contact sheet, debug report, validation status, and failure taxonomy | Core | v0.3 | 2-3 days | No | Shipped as a private/local gallery and benchmark report layer. Use larger gates before making product claims. |
| 25 | Meowa | Style brief reuse across related asset families: camera, palette, outline, lighting, mood, and scale stored as a portable JSON contract | Candidate | v0.4 | 2-3 days | No | Useful once character generation is stable and the project chooses scene/prop expansion. |
| 26 | Meowa | Animation-direction Exploration Mode for key poses and timing ideas before strict Production Mode slicing | Candidate | v0.4 | 2-4 days | No | Keep separate from Production Mode so exploratory prompts do not weaken exact frame-count, source-layout semantics, Row GIF validation, or export guarantees. |
| 27 | Holopix | Prompt comparison UI: side-by-side A/B generation with parameter diff, prompt history, and saved-prompt store | Candidate | v0.3.1 | 1 week | No | Belongs after the benchmark gallery so comparisons share the same artifact and report structure. |
| 28 | Meowa | Two-reference tile interpolation: tile A plus tile B as paired conditioning to generate transition tiles between biomes or styles | Candidate | v0.4 scene direction | 1-2 weeks | No | Only relevant if scene direction is selected. Useful for biome edges that pure auto-tile rules cannot describe well. |
| 29 | Meowa | Isometric tileset profile parallel to the topdown tileset profile | Candidate | v0.4 scene direction | 1 week | No | Schema and slicing work; image generation reuses tile prompt contracts. |
| 30 | Meowa | Canvas map editor with rectangle selection that schedules region-scoped generation requests | Experiment | v0.4 late | Browser workflow done | No | 2.5D browser canvas UI now supports rule-safe paint/erase/corner edits wired to local export/evidence jobs; region-scoped generation and saved external editor round-trip remain later. |
| 31 | Holopix | Smart layer decomposition: split a generated character into body, hair, clothing, and equipment layers as separate transparent PNGs | Candidate | v0.4 | 2-3 weeks | No | A lighter alternative to a full skeletal system; outputs are still raster sprite layers but enable runtime swaps. Quality bound by segmentation accuracy on small pixel images. |
| 32 | Holopix | General asset extraction pipeline: split UI screens, prop sheets, and scene-object sheets into transparent PNG assets plus bbox metadata | Candidate | v0.4 | 1-2 weeks | No | Start with alpha/background-based connected components and manual bbox merge/split. Do not require semantic segmentation on day one. Feeds the existing sprite-sheet composer and ZIP metadata export. |
| 33 | Holopix | Per-frame masked repair workflow: select one managed frame, derive/refine a bounded mask, review one explicit call, locally composite the candidate, then revalidate and accept a sealed child revision | Core | v0.4 | Done | No | Deterministic mask, pixel-integrity, one-call/recovery, evidence, specialized Accept, and Workbench MVP are implemented. The eight-case Quality Gate infrastructure, deterministic controls, and provider-free browser/zero-call verification coverage are implemented. Real first-call visual quality, the 70% live threshold, and production readiness remain unverified until a separately authorized gate with a maximum budget of 8 provider calls publishes a reviewed live report. |
| 34 | Holopix | Multi-reference weighted fusion: simulate model-combination behavior by passing several reference images with explicit weights through the provider prompt | Candidate | v0.4 | 1 week | No | Provider-agnostic substitute for model stacking. Requires prompt-contract support before it is safe to expose. |
| 35 | Meowa | Skeletal character export from provider-generated parts: bind generated parts to predefined authored skeleton templates and export editor-friendly skeletal artifacts | Experiment | v0.5 | 3-4 weeks | No | High value, high complexity. Only attempt after sprite sheet pipeline is stable and the project has real users requesting skeletal output. Requires authored skeleton templates per archetype and careful third-party format licensing review. |
| 36 | Meowa | HD non-pixel character generation as a parallel track to pixel output | Deferred | v0.5+ | 2-3 weeks | No | Out of scope for the current pixel-focused product. Revisit only if user research shows non-pixel demand. |
| 37 | Meowa | Per-action fine-grained credit accounting: pixelate, animate, remove-background, and full asset-pack each priced and metered independently | Deferred | v1.0 | 1 week | No | Commercialization detail. Adopt only after a billable v1.0 product is decided. |
| 38 | FrameRonin youth/RM package | Fixed-region sprite consumption in a Godot plugin: `252 x 252` source image, local fixed-rect slicer, resource-library schema, RPG Maker slicer, preview, and scene drag-in workflow | Candidate | Naming/quality audit | 1-2 days | No | Use only as public/comparison workflow evidence. The reviewed ZIP shows local consumption and plugin UX patterns, not an exposed provider-side strict-template generation algorithm. Do not copy package code, bundled assets, private templates, or confusing names; re-implement only neutral behavior already aligned with this repository's own fixed-region pipeline. |
| 39 | Public 2D editor workflow patterns | Editor Workspace core: persistent project protocol, artifact registry, scene authoring workspace, asset library, layer inspector, timeline, visual repair, and project export | Core | v0.5 | Phase 0 docs first | No | Clean-room behavior reference only. Build around existing artifacts and protocols; do not copy source code, assets, private behavior, names, or runtime implementation. |
| 40 | Public 2D editor workflow patterns | Interaction authoring, playtest runtime, scene flow board, and expanded engine scene export | Candidate | v0.5+ | After core editor evidence | No | Promote only after project core, artifact registry, scene authoring, and timeline have tests and real-artifact UI smoke evidence. |
| 41 | Browser rendering ecosystem | PixiJS/WebGL high-performance editor renderer | Deferred | Performance-gated | Prototype only if needed | No | Start with DOM + Canvas + SVG overlay. Consider PixiJS only if measured visible-entity, tile-map, or DOM-node performance crosses the documented threshold. |

## Not Planned

These ideas were considered and should not enter the roadmap without a new decision:

- Rebuilding a full pixel editor. The project should integrate with existing editors instead of replacing them.
- One-shot rewrite of the whole application into an editor. Editor Workspace must be parallel, staged, and artifact-first.
- Copying competitor source code, private API behavior, or closed-source web bundles.
- Bundling third-party executables, icons, templates, model weights, or commercial art without explicit redistribution rights.
- Scraping commercial pixel-art repositories for model training.
- Making TMX the primary scene format before LDtk direction is validated.

## v0.3 Working Scope

v0.3 should be framed as pipeline reliability plus export usefulness, not platform expansion.

Recommended sequence:

1. Add source-region edge pressure diagnostics. `Done; debug-only unless normalized runtime frames also show edge/crop risk`
2. Run a benchmark on real generated character sheets. `20-case topdown and OCAD gates done; OCAD default generation entry selected, expected source reuse split from duplicate-motion debt, source-region pressure reclassified as diagnostic`
3. Add structured prompt contracts and provider prompt compilation for 8x8 and OCAD layouts. `Done`
4. Add a local benchmark gallery for generated sheets, Row GIF previews, debug reports, and prompt-version comparison. `Done for gallery and taxonomy; prompt A/B UI remains v0.3.1 candidate`
5. Add Aseprite-compatible frame tag export. `Data layer done`
6. Add Aseprite-compatible slice metadata for attachment points. `Data layer done`
7. Add CLI commands for generate, process, export, and benchmark. `Done`
8. Add optional/report-only style enforcement. `Moved to v0.4 Phase 0; first provider-free report-only metrics implemented`
9. Add multi-resolution output options. `Done for generated artifacts and download links`
10. Polish preview animation transitions.
11. Publish a benchmark note and release notes. `Done`

## v0.4 Direction Gate

Direction A is selected after v0.3 benchmark results and v0.3.1 stabilization.
See `docs/decisions/2026-06-05-v04-scene-tile-direction.md` and
`docs/superpowers/plans/2026-06-05-v0.4-master-plan.md`.

### Direction A: Scene Generation

Best if the owner is using this tool to build a Terraria-style game pipeline.

- LDtk auto-tile rules.
- LDtk entity fields.
- LDtk JSON project export.
- WFC or another rule-based tile arrangement system.
- Character and scene packs in one project manifest.

### Direction B: Ecosystem Expansion

Deferred unless the priority becomes sharing the tool with more users.

- Community/chat command entry point.
- Runtime API for game engines.
- Aseprite editor integration through Lua.
- Inpainting/edit workflow for broken frames.
- General asset extraction for UI, props, and scene-object sheets.
- Per-frame masked repair for otherwise-good sprite sheets.

## Governance

- This document decides whether a feature is worth planning.
- `docs/superpowers/specs/` describes a selected feature.
- `docs/superpowers/plans/` describes exact implementation steps.
- `docs/decisions/` records why a major choice was made.
- `docs/protocols/` records stable file formats and data contracts.
- `docs/runbooks/` records repeatable operational workflows.

## Update Log

| Date | Change |
|---|---|
| 2026-07-16 (C/D/E closure) | Completed Pixel Grid v2 (`0a6353a`), Motion Selection v2 (`f6a6a03`), and Guided Motion Source UI/HUD (`493f609`) under separate contracts. Final provider-free verification passed `1431 / 1431`, the guarded Chrome fault matrix covered responsive and stale/missing/unreadable evidence states, and two read-only reviews found no remaining Blocker/High. |
| 2026-07-16 | Implemented and guarded-verified the Motion Source Correctness and Safety v1 baseline: explicit Auto/Manual authority, raw upload limits, explicit/deferred and pre-descriptor release, bounded session ledgers, exact replay after release, truthful poll/cancel/Resume semantics, client-path rejection, central-directory plus actual-inflation ZIP budgets, cooperative in-process cancellation, POSIX process-group supervision with Windows fail-closed behavior, and bounded FFmpeg normalization/output evidence; final full suite and self-hosted smoke passed provider-free. |
| 2026-07-13 | Recorded item 33's eight-case Quality Gate infrastructure, deterministic controls, and browser/provider-free zero-call coverage as implemented; kept real first-call quality, the 70% live threshold, and production readiness explicitly unverified pending a separately authorized live report. |
| 2026-07-11 | Promoted item 33 after deterministic Targeted Frame Repair v1 implementation and guarded verification; kept live first-call quality Experimental/opt-in pending the separately authorized benchmark. |
| 2026-05-25 | Initial roadmap created from multi-turn reference analysis and v0.3 planning discussion. |
| 2026-05-28 | Added Meowa-inspired prompt-contract, local benchmark gallery, style-brief, and animation-direction references without approving source copying or platform cloning. |
| 2026-05-28 (later) | Added second-pass Meowa.ai and Holopix.cn analysis items: prompt-comparison UI, tile-A/B interpolation, isometric profile, canvas map editor, smart layer decomposition, multi-reference fusion, skeletal export from provider-generated parts, HD parallel track, fine-grained credit accounting. Items distinguish between Core (v0.3), Candidate (v0.3.1-v0.4), Experiment (v0.4 late, v0.5), and Deferred (v0.5+, v1.0). |
| 2026-05-29 | Added Holopix-inspired general asset extraction and per-frame masked repair candidates, and neutralized provider/model wording in roadmap notes. |
| 2026-05-31 | Started v0.3 generation observability implementation: prompt contracts, prompt contract metadata, and local benchmark gallery. |
| 2026-06-04 | Closed v0.3 release: OCAD default generation route, benchmark decisions, source-edge/duplicate reclassification, UI decoupling, multi-resolution outputs, release notes, and final verification. |
| 2026-06-04 (later) | Started v0.3.1 quality stabilization by clarifying OCAD static source reuse in prompt contracts and benchmark Markdown reports, then added provider-free OpenRouter report recompute for historical run audits. |
| 2026-06-05 | Closed v0.3.1 as a small provider-free stabilization release before v0.4 planning. |
| 2026-06-05 (later) | Selected v0.4 Direction A and started Phase 0 with provider-free report-only pixel style metrics before tile generation. |
| 2026-06-05 (later) | Started v0.4 Phase 1 with a padded 16-tile dual-grid profile before prompt, map, or export work. |
| 2026-06-05 (later) | Started v0.4 Phase 2 with shared-edge tile map validation and an LDtk-style JSON skeleton. |
| 2026-06-05 (later) | Started v0.4 Phase 3 with a character plus scene project manifest and shared style contract. |
| 2026-06-05 (later) | Added the first provider-free scene tile quality gate for visual seams, self-loop checks, and style drift. |
| 2026-06-05 (later) | Added provider-free scene tile prompt dry-run artifacts for the padded dual-grid source sheet. |
| 2026-06-05 (later) | Added provider-free scene pack artifact writing, generated URLs, and `scene_pack.zip` packaging. |
| 2026-06-05 (later) | Added single-level LDtk project JSON export and `project.ldtk` scene pack artifacts. |
| 2026-06-05 (later) | Added provider-free scene tile preview UI backed by deterministic dual-grid maps. |
| 2026-06-05 (later) | Added real `topdown_tile_dual_grid_v0` tile sheet ingestion with quality gate, CLI/API export, and uploaded-sheet preview. |
| 2026-06-05 (later) | Added guarded live scene tile generation smoke via `scene tile-generate --yes`, with provider metadata and scene pack artifacts. |
| 2026-06-05 (later) | Upgraded the scene tile prompt contract to `scene_tile_prompt_contract_v0_2`; live smokes still failed seam/self-loop gates, so edge-conditioning remains the next blocker. |
| 2026-06-05 (later) | Added opt-in scene tile edge conditioning, provider-free raw/conditioned comparison artifacts, and structural seam-gate closure notes. |
| 2026-06-05 (later) | Added edge-aware conditioning v1 plus raw-vs-conditioned visual review artifacts; live gate still warns, so raw tile structure remains the next quality blocker before WFC. |
| 2026-06-06 | Started raw tile-structure quality with `scene_tile_prompt_contract_v0_3` and a warning-only source-atlas continuity gate before WFC/map-editor work. |
| 2026-06-06 (later) | Added opt-in scene tile palette-snap correction and `style_correction.json` evidence without changing default outputs. |
| 2026-06-06 (later) | Added warning-only scene tile distinctness checks for duplicate runtime tiles across distinct referenced masks. |
| 2026-06-06 (later) | Added deterministic rule-based dual-grid arrangement for preview, ingestion, and LDtk export paths. |
| 2026-06-06 (later) | Added project pack export for combining existing character and scene artifact directories into a single manifested ZIP. |
| 2026-06-06 (later) | Added Project Pack local API/UI integration and browser controls for scene tile rule/style/edge options. |
| 2026-06-06 (later) | Recorded v0.4 release closure with live scene gate `v04_scene_live_gate_20260606_01`: `1 / 1` pass, usable rate `1.00`, no failure taxonomy entries. |
| 2026-06-16 | Inserted v0.4.1 Quality Infrastructure before the next scene/tile deepening block: neutral local golden set, quality gate layers, user-configured provider/model adapter, live benchmark adapter path, and visual quality report. |
| 2026-06-16 (later) | Started the next scene/tile deepening block with strict raw tile quality policy for release/live gates and richer scene tile evidence reports. |
| 2026-06-17 | Added bounded multi-candidate scene tile generation, deterministic candidate selection, candidate evidence artifacts, live gate provider-call accounting, and report taxonomy for failed candidates; WFC and LDtk auto-layer readiness remain gated by strict live evidence. |
| 2026-06-17 (later) | Planned a 5-case, 4-candidate strict scene tile live gate, but provider routes blocked before image generation; added explicit `--max-provider-calls` budget guards for scene tile live generation and live gates. |
| 2026-06-17 (later) | Added scene tile correction-dependency summaries to reports and recomputed the five manual external scene samples; corrected gates pass, but dependency level is `high`, so the next scene block remains raw-output quality before WFC/LDtk expansion. |
| 2026-06-17 (later) | Added a provider-free scene tile correction matrix for raw/style/edge-aware comparisons; the five manual external samples were `0 / 5` raw pass, `1 / 5` style-snap pass, and `5 / 5` style-plus-edge pass. |
| 2026-06-17 (later) | Added raw-readiness interpretation for scene tile correction matrices; the manual external sample set remains `not_ready`, so WFC/LDtk expansion stays gated. |
| 2026-06-17 (later) | Started raw-quality closure with per-sample raw diagnostics, `scene_tile_prompt_contract_v0_5`, and provider-free manual prompt packs; the v0.5 matrix is pending new external Gemini images. |
| 2026-06-17 (later) | Ran the v0.5 manual retest handoff: original external images failed the `192x192` PNG source-sheet contract, and a normalized diagnostic matrix still reported raw readiness `not_ready`; WFC/LDtk expansion remains gated. |
| 2026-06-17 (later) | Hardened the manual scene tile handoff with `scene_tile_prompt_contract_v0_6`, removed visible mask-coordinate placement lists from the prompt, added `manual_handoff.md`, and made retest preflight report invalid JPEG/size inputs before matrix execution. |
| 2026-06-17 (later) | Started a schema-first local 2.5D tileset pipeline with neutral contracts, logical-vs-sprite sizing, deterministic 16-mask atlas planning, validation reports, preview PNGs, and first-stage Tiled exports; source normalization and material building remain future stages. |
| 2026-06-17 (later) | Added Material Source Quality Closure v1 for 2.5D manual sources: palette-limited material patches, canonical release-readiness grouping, prioritized samples, and reviewed evidence showing palette pressure closed while semantic slot and tileable-patch warnings still gate WFC/LDtk. |
| 2026-06-18 | Added External Editor Round-trip / Consumer Tool Probe v1 for the 2.5D path: local supported-tool availability probe, release-demo ZIP import smoke, and manual-ready round-trip evidence artifacts without claiming unattended editor launch or saved editor round-trip success. |
| 2026-06-18 (later) | Added AI Material Source Bridge v1 for the 2.5D path: neutral raw-source prompt contract, guarded one-call provider budget flow, provider source artifacts, and CLI/API routing into the deterministic normalizer/material-builder/composer/export pipeline without claiming clean-atlas provider output. |
| 2026-06-18 (later) | Added Multi-candidate Material Source Benchmark v1 for the 2.5D path: guarded live-provider candidate plan, explicit quota accounting, deterministic local candidate ranking, JSON/Markdown benchmark evidence, and retryable failure reporting without claiming broad provider-quality readiness. |
| 2026-06-19 | Added the browser Motion Source entry: provider-free analyze/build/apply/source-set jobs now have a parallel tab with real artifact rendering, cleanup/anchor/resample controls, and explicit browser-video degradation; editor handoff and full multi-action assembly remain later. |
| 2026-06-19 (later) | Added Motion Source editor handoff v1: neutral JSON-array frame metadata, same-size strip re-import manifest, artifact writer, and optional local editor command bridge using `SPRITE_EDITOR_PATH` without bundling editor binaries or plugins. |
| 2026-06-19 (later) | Added encoded Motion Source GIF/ZIP workflow regression coverage: temporary generated media now runs through analyze, extraction, strip build, identity gate, apply-strip, character validation, and editor handoff without committed media fixtures. |
| 2026-06-22 | Selected Editor Workspace as the v0.5 direction through Phase 0 docs and protocols: editor project, asset reference, scene, interaction, processing recipe, design spec, and implementation plan. |
| 2026-06-23 | Added Editor Workspace Phase 0.1 protocol tightening: asset revisions, project-managed immutable storage, scene coordinate rules, interaction schemas, full processing recipes, and editor-specific guardrails before Phase 1 implementation. |
| 2026-06-23 (later) | Merged Editor Workspace v0, Engine Handoff v1, Export Review UI, and Consumer Evidence layers into main with preview-only engine handoff boundaries preserved. |
| 2026-06-23 (later) | Added Motion Source guarded set apply API/UI: `/api/apply-motion-source-set` and the browser `Apply Set` action now emit set-apply reports and applied sheets from reviewed identity-consistent strips without provider calls. |
| 2026-06-27 | Expanded Motion Source video workflow: browser/API frame preview, start/end/max-frame controls, local FFmpeg status, manual frame selection/reordering before strip build, generic `video_frames_sheet.png` / `frames_index.json` / `frames.zip` exports, and optional user-installed rembg/U2Net matting. |
