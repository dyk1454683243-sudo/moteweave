# Editor Workspace Engine Handoff v1

**Date:** 2026-06-23
**Scope:** Review `engine_handoff_manifest_v1`, Godot preview metadata, and
LDtk preview metadata produced by Editor Workspace project pack export.

Use this runbook after exporting an editor project pack through
`POST /api/editor/projects/:projectId/export-pack` or the Editor Workspace UI.

## Required Artifacts

The exported ZIP should contain:

- `engine_handoff_manifest.json`
- `engines/godot/scene_handoff.json`
- `engines/ldtk/scene_handoff.json`
- `consumer_evidence/engine_consumer_validation.json`
- `consumer_evidence/manual_import_evidence.json`
- `consumer_evidence/manual_import_checklist.md`
- `engine_payloads.json`
- `asset_references.json`
- `project.json`
- `scenes/index.json`
- `scenes/<scene-id>.json`

Existing managed payloads, such as Godot character ZIPs and scene LDtk files,
should still appear only when the imported asset revision already had those
artifacts.

## Static Review

1. Open `engine_handoff_manifest.json`.
2. Confirm `version` is `engine_handoff_manifest_v1`.
3. Confirm `validation.status` is `pass` or an expected `warning`.
4. Confirm `unsupported_items` is empty for clean scenes or lists every omitted
   engine/action item.
5. Confirm every layer `asset_id` appears in `assets`.
6. Confirm every scene-flow link references scenes listed in `scenes`.
7. Confirm no absolute paths, `..`, base64 payloads, provider keys, or secrets
   appear in the handoff files.

Review `consumer_evidence/engine_consumer_validation.json`:

- `version` is `engine_consumer_validation_v1`.
- `status` is `pass` for clean preview metadata or `warning` when unsupported
  items are intentionally present.
- `claim_boundary` is
  `preview_metadata_only_no_engine_native_scene_files_generated`.
- `engines.godot.status` and `engines.ldtk.status` match the expected review
  state.
- `engine_payloads.policy` remains
  `reference_existing_supported_payloads_only`.
- Any warning named `engine_consumer_unsupported_items_present` is paired with
  explicit unsupported items in the neutral and engine-specific handoff files.

Review `editor_project_pack_manifest.json` or the `/api/editor/.../export-pack`
response:

- `review_status.status` is `pass`, `warning`, or `fail`.
- `review_status.consumer_readiness` is `preview_metadata_only`.
- `review_status.unsupported_items_status` is `pass` or
  `unsupported_items_present`.
- `review_status.flags` includes `preview_metadata_only`, and includes
  `unsupported_items_present` only when unsupported items exist.

## Godot Preview Checklist

Review `engines/godot/scene_handoff.json`:

- `version` is `godot_scene_handoff_v1`.
- `claim_boundary` says no plugin or scene file is generated.
- World-space layers appear under `nodes`.
- Viewport-space layers appear under `ui_nodes`.
- Layer `transform.position` matches the editor pivot point.
- `pivot`, `frame_size`, `top_left_position`, `flip_x`, and `flip_y` are present.
- Interaction metadata is present only as metadata.
- `unsupported_items` lists actions that need future runtime contracts.

Manual consumer experiment, if desired:

1. Create a blank Godot project manually.
2. Unzip the editor project pack outside the repository.
3. Inspect `engines/godot/scene_handoff.json`.
4. Manually create a scene matching the metadata.
5. Record any missing importer requirement as a future task, not as a v1
   regression.

Do not add copied Godot plugin code or generated `.tscn` files as part of this
review.

## LDtk Preview Checklist

Review `engines/ldtk/scene_handoff.json`:

- `version` is `ldtk_scene_handoff_v1`.
- `claim_boundary` says this is not a complete LDtk world export.
- Each supported editor scene appears as one level record.
- World-space layers and scene entities appear as entity metadata.
- Viewport-space layers appear in `omitted_layers`.
- `custom_fields` include pivot, frame size, top-left position, flip flags,
  parallax, z-index, playback, and supported actions.
- Existing scene-pack LDtk payload copying remains represented by
  `engine_payloads.json`; the preview file does not replace it.

Manual consumer experiment, if desired:

1. Open LDtk separately.
2. Create a scratch project manually.
3. Use the preview metadata to recreate one level by hand.
4. Record missing field or importer needs for a later importer task.

Do not claim saved LDtk editor round-trip or complete multi-level support from
this preview.

## Manual Evidence Package

Open `consumer_evidence/manual_import_evidence.json`:

- Confirm every `required_artifacts` entry exists in the ZIP.
- Confirm `review_status` matches `editor_project_pack_manifest.json`.
- Confirm `payload_summary.payloads` only lists already-managed payloads copied
  from project asset revisions.
- Confirm `stop_rules` preserve the v1 boundary: no copied engine plugin code,
  no generated native scene files, no production-ready engine scene claim.

Use `consumer_evidence/manual_import_checklist.md` as the reviewer worksheet.
It is generated from the evidence JSON so reviewers can fill in:

- reviewer and review date;
- Godot result;
- LDtk result;
- missing importer requirements;
- notes.

Treat this checklist as manual evidence only. A checked worksheet does not mean
the project has automated external editor launch or saved round-trip support.

## Verification Commands

Run:

```bash
git diff --check
node --test test/editor-project/editorEngineHandoff.test.js test/editor-project/editorProjectPack.test.js test/editor-project/editorWorkspaceV0Acceptance.test.js
npm test
```

Run `npm run smoke:local` as well if any UI entry point changes.

## Release Note Boundary

Suggested wording:

```text
Editor Workspace project pack export now includes a neutral
engine_handoff_manifest_v1 plus Godot-oriented and LDtk-oriented preview
metadata, static consumer validation, and a manual import evidence checklist.
Existing engine payload copying remains unchanged. The new files are
review/importer handoff artifacts, not production-ready Godot scenes or complete
LDtk worlds.
```
