# v0.3 Output Polish Multi-Resolution Sheets

## Status

Accepted on 2026-06-04.

## Context

The v0.3 quality work moved fresh AI generation to `ocad_motion_v0` while keeping `topdown_rpg_v0` as the runtime/export profile. The OCAD gate is structurally usable, expected source reuse is separated from true duplicate motion, and source-region edge pressure is now diagnostic unless normalized runtime frames also show edge/crop risk.

That makes output polish safe to resume without masking generation failures.

## Decision

Emit multi-resolution normalized sheets for every processed character pack:

```text
normalized_sheet_96.png
normalized_sheet_64.png
normalized_sheet_48.png
normalized_sheet_32.png
normalized_sheet_16.png
multi_resolution.json
```

The files use nearest-neighbor resizing from the validated runtime sheet and preserve the same 8x8 frame order and animation semantics as `normalized_sheet.png`.

Expose the files in:

- `character_pack.zip`
- generated artifact URLs
- CLI output directories
- Character Pack download links

## Non-Goals

- Do not change the internal runtime profile.
- Do not introduce per-size validation gates yet.
- Do not change Godot, RPGMaker, or OCAD compatibility exporter semantics.

## Verification

Provider-free checks:

```text
node --test test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js test/character-pack/cli.test.js test/serverOpenRouter.test.js
node --test test/uiCharacterPackStructure.test.js test/localSmokeScript.test.js
```
