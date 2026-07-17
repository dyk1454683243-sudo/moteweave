# Character Pack Artifacts

The pipeline emits both internal runtime artifacts and compatibility exports.

## Internal Runtime Artifacts

```text
source.png
source_layout_overlay.png
source_quality_report.json
generation_release_gate.json  # live generation only
normalized_sheet.png
multi_resolution.json
normalized_sheet_96.png
normalized_sheet_64.png
normalized_sheet_48.png
normalized_sheet_32.png
normalized_sheet_16.png
animations.json
metadata.json
editor_metadata.json
debug_report.json
debug_overlay.png
onion_skin_overlay.png
<animation>.gif
character_pack.zip
```

Use `normalized_sheet.png + animations.json` as the primary game runtime input. GIF files are previews only.

Use `multi_resolution.json` when selecting a smaller runtime sheet. Each `normalized_sheet_<size>.png` keeps the same 8x8 frame order and animation semantics as `normalized_sheet.png`; only the per-frame pixel size changes.

The active Character Workbench Recipe adapter requests these artifacts with
the canonical `outputs.frame_sizes` / `outputFrameSizes` list
`[96, 64, 48, 32, 16]`. Legacy `outputs.scales` is not a Character Workbench
execution contract.

Use `editor_metadata.json` as the editor/workflow companion for frame tags, frame rectangles, attachment points, visible bounds, and source provenance.

For `fixed_region_motion_v0`, use `source_quality_report.json` before judging
the normalized runtime sheet. It records per-region occupancy, visible bounds,
background/halo residue, source edge pressure, source-layout alignment, expected
static reuse, and duplicate source-action motion warnings.

## Live Generation Release Evidence

Live `production_sheet_v0` and `quality_character_v0` results write
`generation_release_gate.json`. Candidate score is ranking evidence only; this
gate is the publication authority.

For a release-ready generation, the ordinary Character/T2I ZIP and applicable
engine exports are written and the terminal status is `done`.

When Provider generation and local processing succeed but every candidate is
blocked, the terminal status is `failed_quality_gate`, the failure status is
`generation_release_gate_failed`, and artifact disposition is
`diagnostic_only`. The writer retains exact inspection evidence such as source,
processed result, gate/debug/source-quality reports, prompt/generation metadata,
and review previews. Quality Character additionally retains its existing
`candidate_<n>.png` evidence; Production Sheet retains the selected diagnostic
source/result and candidate report, but does not persist every generated
candidate image. The writer does not write or expose
`character_pack.zip`, `t2i_pack.zip`, engine packs, runtime metadata exports, or
multi-resolution release outputs. The browser also ignores stale export URLs on
a blocked job.

Artifact directories are single-assignment. A writer creates
`<output_dir>/<job_id>` exclusively and fails on collision instead of reusing or
overwriting an existing job directory. This prevents a diagnostic-only run from
inheriting release ZIPs from an earlier run with the same identifier.

Provider-free `/api/process-sheet` jobs do not receive this live-generation
gate and retain their existing validation/writer policy.

## Multi-Resolution Outputs

Every processed job emits nearest-neighbor resized normalized sheets:

```text
normalized_sheet_96.png  # 96x96 frames, 768x768 sheet
normalized_sheet_64.png  # 64x64 frames, 512x512 sheet
normalized_sheet_48.png  # 48x48 frames, 384x384 sheet
normalized_sheet_32.png  # 32x32 frames, 256x256 sheet
normalized_sheet_16.png  # 16x16 frames, 128x128 sheet
```

`multi_resolution.json` records the source sheet, profile id, frame size, sheet size, and file name for each generated sheet.

These files are included both as standalone generated artifacts and inside `character_pack.zip`.

## Workbench Recipe Evidence Ownership

The Character Workbench Recipe-to-pipeline binding, provider-free Preview job,
specialized acceptance, and managed-evidence orchestration are active.

A Workbench Preview job writes these required evidence files after the standard
Character Pack writer completes and before terminal job publication:

```text
processing_recipe.json
editor_reprocess_context.json
```

`processing_recipe.json` is the canonical submitted Recipe.
`editor_reprocess_context.json` binds the preview job and parent project,
asset, and revision identities to the exact managed input key/reference and
SHA-256, optional black-matte SHA-256, source layout,
implementation revision, full `recipe_hash`, and revision-neutral
`draft_settings_hash`. Its `submitted_at`, the public job `created_at`, and
generated `metadata.json.created_at` share the service-created job timestamp.
The context is an exact `editor_reprocess_context_v0` object; extra or
cross-bound fields are invalid. A `normalized_sheet_fallback` context always
records `topdown_rpg_v0` as its authoritative source layout. These are
immutable evidence artifacts, never
embedded binary project payloads and never mutable UI state.

Every reprocess job seals this exact base integrity set:

```text
source.png
source_layout_overlay.png
normalized_sheet.png
multi_resolution.json
normalized_sheet_96.png
normalized_sheet_64.png
normalized_sheet_48.png
normalized_sheet_32.png
normalized_sheet_16.png
animations.json
metadata.json
editor_metadata.json
debug_report.json
debug_overlay.png
onion_skin_overlay.png
processing_recipe.json
editor_reprocess_context.json
character_pack.zip
```

When, and only when, the canonical Recipe records the active revision's
dedicated managed black matte, the sealed set additionally contains:

```text
input_black_matte.png
```

The file is private integrity evidence and is not published as a general job
URL. Row GIFs, inspection evidence, source-quality reports, and engine exports
may remain ordinary known Character Pack artifacts, but cannot replace any
base integrity file.

The full `recipe_hash` includes the server-owned `implementation_revision` and
owns processing evidence and acceptance. `draft_settings_hash` forces only that
revision to `null` and owns draft freshness; it cannot authorize acceptance.
The server recomputes both hashes. Accepted revisions copy validated evidence
into managed immutable storage, set `processing_recipe_ref` to the controlled
Recipe path, and may register the reprocess context as provenance. Legacy jobs
without Recipe evidence retain `processing_recipe_ref: null`.

Acceptance resolves each sealed filename through generated-job containment,
verifies the recorded size and lowercase SHA-256, and captures each file once.
Before any copy, acceptance parses the captured Recipe, context, metadata, and
quality report as plain JSON and requires metadata `created_at` to equal both
the job and context timestamps. The specialized importer then verifies the
captured Recipe/context by deep identity, reserves a never-existing child
directory, writes without overwrite, and re-hashes every managed target. The
parent revision and generated job remain unchanged. Pre-copy verification,
copy, or formal-save failure cannot change project JSON; reserved orphans from
post-reservation failures are not automatically cleaned or reused.

Only an underlying `done` job with strict `pass` and empty warnings/blocking
errors, or strict `warning` with empty blocking errors plus an explicit
job/full-hash confirmation, is acceptable. Contradictory quality evidence is
an integrity failure. A complete
`failed_post_processing` job with valid fail evidence remains inspectable as
`blocked_quality`; incomplete failure evidence remains `failed`. Neither can be
accepted.

## Godot NPC Plugin Export

Phase 1 adds a compatibility export for the free NPC plugin:

```text
godot_npc_pack.zip
AI资源库/一图全动作/<character_id>/
  npc.json
  sprite.png
  thumb.png
```

The same folder is also included inside `character_pack.zip` so one download contains both the internal artifacts and the plugin import pack.

## Debug Flow

When a generated character looks wrong:

```text
debug_report.json
-> validation.status / warnings / blocking_errors
-> background_mode
-> component_cleanup
-> grid.correction
-> normalization.auto_correction
-> normalization.motion_stabilization
-> normalization.manual_adjustments
-> source_layout.actions
-> source_quality / source_quality_report.json
-> animations.<runtime_action>.label / source_actions
-> frames[].source_frame / runtime_action
-> frames[].source_bbox / source_anchor
-> frames[].normalized_bbox / normalized_anchor
-> source_layout_overlay.png
-> debug_overlay.png
-> onion_skin_overlay.png
```

If the browser preview works but Godot import does not, inspect `godot_npc_pack.zip` first. If Godot import works but animation semantics look wrong, inspect `animations.json` and `npc.json` together.
