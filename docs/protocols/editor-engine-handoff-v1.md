# Editor Engine Handoff Protocol v1

**Status:** Implemented preview handoff
**Owner:** Editor Workspace
**Introduced:** 2026-06-23
**Implementation:** `src/editor-project/engineHandoff.js`,
`src/editor-project/engineConsumerEvidence.js`

## Purpose

`engine_handoff_manifest_v1` is the bridge between `editor_project_v0` and
engine-specific consumer tooling. It records scenes, layers, entities, assets,
interactions, mapping rules, and unsupported items in a neutral JSON document.

The protocol does not generate engine plugin code, bundled templates, Godot
scene files, or complete LDtk worlds. It gives downstream importers enough
reviewable metadata to build those consumers later.

## Files In Editor Project Pack

`editor_project_pack_v1` includes these handoff files:

| File | Purpose |
| --- | --- |
| `engine_handoff_manifest.json` | Neutral handoff manifest for all engines. |
| `engines/godot/scene_handoff.json` | Godot-oriented preview metadata. |
| `engines/ldtk/scene_handoff.json` | LDtk-oriented single-level preview metadata. |
| `consumer_evidence/engine_consumer_validation.json` | Static consumer validation for manifest, Godot preview, LDtk preview, and copied payload references. |
| `consumer_evidence/manual_import_evidence.json` | Reviewer-ready summary of required artifacts, claim boundaries, payloads, stop rules, and result template. |
| `consumer_evidence/manual_import_checklist.md` | Manual import/review checklist generated from the evidence JSON. |

Existing payload files such as `engine_payloads.json` and copied character or
scene artifacts remain unchanged. Old consumers may ignore the new files.

`editor_project_pack_manifest.json` also includes `review_status`:

- `status`: `pass`, `warning`, or `fail` across project validation and static
  consumer validation.
- `validation_status`: original editor project pack validation status.
- `consumer_validation_status`: status from
  `engine_consumer_validation_v1`.
- `consumer_readiness`: currently always `preview_metadata_only` for v1.
- `unsupported_items_status`: `pass` or `unsupported_items_present`.
- `flags`: includes `preview_metadata_only` and, when applicable,
  `unsupported_items_present`.

## Neutral Manifest Shape

Top-level fields:

- `version`: `engine_handoff_manifest_v1`.
- `mapping_version`: `editor_engine_export_mapping_v1`.
- `project_id`, `project_name`, `project_revision`, `created_at`.
- `coordinate_model`: source-of-truth editor coordinate semantics.
- `capability_profiles`: Godot and LDtk mapping capability tables.
- `assets`: active project asset summaries and active revision artifacts.
- `scenes`: scene summaries with layers, entities, interactions, and transforms.
- `scene_flow`: copied scene-flow nodes and links.
- `unsupported_items`: per-engine unsupported action or placement records.
- `validation`: static validation status and metrics.

## Coordinate Mapping

Editor coordinates stay authoritative:

- origin is top-left;
- X points right;
- Y points down;
- one unit is one world pixel;
- layer position is the layer pivot, not texture top-left;
- viewport-space layers are not camera or parallax adjusted;
- rotation is recorded in degrees;
- scale is positive per axis;
- `flip_x` and `flip_y` are explicit booleans.

Godot preview mapping:

- world-space layers become `Node2DMetadata` records whose position is the
  editor pivot point;
- viewport-space layers become `ControlMetadata` records;
- sprite offsets or future importer logic must compensate from texture top-left
  to editor pivot;
- parallax is metadata only;
- no plugin code or `.tscn` file is generated.

LDtk preview mapping:

- each editor scene becomes one preview level record;
- world-space visual layers and scene entities become entity metadata records;
- positions store the editor pivot point;
- pivot, top-left offset, flip, parallax, and playback are custom-field
  metadata;
- viewport-space UI layers are omitted from level placement and reported;
- this is not a complete multi-level LDtk world export.

## Action Mapping

Actions are recorded in the neutral manifest with per-engine support status.

| Action | Godot preview | LDtk preview |
| --- | --- | --- |
| `show_text` | supported metadata | custom-field metadata |
| `play_animation` | supported metadata | unsupported |
| `toggle_layer` | supported metadata | unsupported |
| `set_state` | supported metadata | unsupported |
| `pickup_item` | unsupported | unsupported |
| `scene_link` | supported metadata | custom-field metadata |
| `emit_event` | reserved unsupported | reserved unsupported |
| `set_flag` | reserved unsupported; use `set_state` | reserved unsupported; use `set_state` |

Unsupported actions must be listed in `unsupported_items`. Engine-specific
preview files must either omit unsupported action payloads from their consumer
field lists or keep them only inside explicit unsupported diagnostics.

## Validation

`validateEngineHandoffManifest()` rejects:

- unknown manifest version;
- malformed project, scene, layer, entity, or asset ids;
- duplicate asset ids or scene ids;
- duplicate layer ids within a scene;
- layer asset references missing from the manifest asset list;
- unsafe artifact paths;
- scene-flow links that reference missing scenes;
- embedded base64 payloads or secret-like fields.

Unsupported engine mappings are warnings, not blocking errors. The pack-level
validation reports `engine_handoff_contains_unsupported_items` when any
unsupported item exists.

`engine_consumer_validation_v1` statically checks that:

- Godot and LDtk preview documents use the expected versions and claim
  boundaries;
- project ids and revisions match the neutral manifest;
- every neutral scene appears in the engine preview document;
- Godot world layers, viewport layers, and entity metadata are present in the
  expected arrays;
- LDtk levels, entity metadata, omitted viewport layers, and custom fields are
  present;
- unsupported items match the neutral manifest instead of being silently
  dropped;
- copied engine payload references keep safe pack paths and preserve the
  existing payload policy.

Static consumer validation does not launch external engines, copy plugin code,
or prove saved external editor round-trips.

## Claim Boundary

Allowed release wording:

- "Exports an editor engine handoff manifest for review."
- "Includes Godot-oriented and LDtk-oriented preview metadata."
- "Preserves existing Godot character ZIP and scene LDtk payloads when present."

Do not claim:

- production-ready Godot scenes;
- bundled Godot plugins;
- complete LDtk world export;
- automatic external editor round-trip;
- support for unsupported actions as runtime behavior.
