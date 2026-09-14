# Character Pack Artifacts

The pipeline emits both internal runtime artifacts and compatibility exports.

## Internal Runtime Artifacts

```text
raw_provider_output.<ext>               # live generation only; exact Provider bytes
background_removed_provider_output.png # fixed-region live generation; full-resolution RGBA
source.png
source_layout_overlay.png
source_quality_report.json
generation_release_gate.json  # live generation only
manual_acceptance.json         # accepted strict full-sheet publication only
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

A strict full-sheet live Job first remains an immutable `review_required`
evidence directory without release ZIPs. Explicit human acceptance creates a
separate single-assignment `accepted_v1_<sourceJobId>` directory; it does not
rewrite that source Job. The publication keeps the exact reviewed raw Provider
bytes, the full-resolution `background_removed_provider_output.png` when the
source Job contains that evidence, `source.png`, and `normalized_sheet.png`, and adds
`manual_acceptance.json` plus an accepted `generation_release_gate.json`.
`manual_acceptance.json` binds the source/publication ids, human decision,
reviewed issue count, sealed Review and Prompt hashes, reviewed artifact hashes,
the exact hash/length of every engine ZIP, timestamp, and
`provider_calls_used: 0`. It is also included in `character_pack.zip`.

Manual acceptance is provider-free. Before publishing, the server rebuilds the
packages locally and requires the reviewed Prompt, source, and normalized hashes
to remain byte-identical. Automated reports and overlays are retained as
evidence and are not converted into semantic human findings. Repeating an
identical acceptance reopens the sealed Review and revalidates Prompt copies,
the Character Pack, and all engine ZIPs; changed bindings or an existing
conflicting publication fail closed.

For new fixed-region generation, `background_removed_provider_output.png`
separates matte removal from sizing. Its dimensions match the decoded Provider
image, and its metadata binds it to `raw_provider_output.<ext>`. It is never a
replacement for the raw image or the calibrated `source.png`. The acceptance
path verifies and copies the exact intermediate bytes; older immutable Jobs are
left unchanged when the artifact does not exist.

The provider-free `background-remove-preview` CLI creates a new single-use
preview directory containing an input-dimension
`background_removed_provider_output.png` and
`background_removal_preview.json`. It returns `preview_ready`, uses zero
Provider calls, writes no release gate or human decision, and never mutates the
source Job. Background Matte V2 preview additionally publishes its quality,
review, frozen-mask, six-background comparison, and spill-overlay evidence as
defined by `docs/protocols/background-matte-v2.md`, including the three debug
Mask PNGs, Alpha estimate, and foreground reconstruction. Its report seals the
exact eleven-file whitelist with MIME type, byte length, and SHA-256.

Strict `full_sheet_fixed_region_v1` Reviews now seal the V2 Recipe by default,
and the same evidence files are retained for `review_required`. Strict topdown
remains unactivated. Existing manual Accept does not add request fields or a
second decision state: it validates the sealed V2 evidence and preserves
byte-identical standalone and Character Pack ZIP copies. Missing, extra,
changed, malformed, or cross-bound evidence fails closed with zero additional
Provider calls. Only immutable historical Jobs created before V2 activation
remain valid without V2 evidence under their historical contract.

For legacy generation and Quality Character, when Provider generation and local
processing succeed but every candidate is blocked, the terminal status is
`failed_quality_gate`, the failure status is
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

A successfully processed strict `full_sheet_*` candidate instead remains
`done + review_required` when its mandatory evidence is well formed. Automated
visual findings do not turn it into `failed_quality_gate`; only execution,
Artifact, Alpha, Scope, or Hash-integrity failures can fail automatically.

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

## Retired Workbench Recipe Evidence

The former provider-free Character Workbench Preview and specialized local
reprocess acceptance flow was retired on 2026-08-08. Production runtime no
longer creates or accepts `editor_reprocess_context.json`, and the Editor Repair
workspace no longer exposes Recipe, Build Preview, or local Accept controls.

Existing `processing_recipe.json` and `editor_reprocess_context.json` files are
historical evidence only. The persistent context marker is deliberately
recognized solely to block old specialized output from entering through the
general `import-job` route. `processing_recipe_ref` remains in the project
schema for previously accepted immutable revisions; it does not make the
retired reprocess workflow executable.

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
