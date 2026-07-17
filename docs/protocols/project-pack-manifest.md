# Project Pack Manifest Protocol

**Status:** Active Draft
**Owner:** Project pack pipeline
**Introduced:** v0.4 Phase 3

## Purpose

The project pack manifest is the integration contract between character packs,
scene packs, and a shared pixel style reference. It lets the project describe
one game-ready bundle while keeping character and scene artifacts separable.

## Manifest

`buildProjectManifest()` emits:

```json
{
  "version": "scene_character_project_v0",
  "project_id": "demo_project",
  "created_at": "2026-06-05T00:00:00.000Z",
  "packs": {
    "character": {
      "id": "hero_pack",
      "profile": "topdown_rpg_v0",
      "artifacts": {
        "sheet": "character/normalized_sheet.png",
        "animations": "character/animations.json"
      }
    },
    "scene": {
      "id": "meadow_scene",
      "profile": "topdown_tile_dual_grid_v0",
      "artifacts": {
        "scene": "scene/scene.json",
        "tileset": "scene/tiles.png"
      }
    }
  },
  "style_contract": {
    "mode": "shared_reference",
    "source": "pixel_style_report",
    "palette": {
      "max_colors": 16,
      "colors": []
    }
  }
}
```

`style_contract` is intentionally compatible with the v0.4 pixel style report
shape. Later work can derive it from a user-selected palette image, a generated
asset family, or a curated style preset.

## Shared Style Validation

`buildProjectPack()` now records a `validation.style_contract` section. The
project pack does not fail solely because style evidence is incomplete, but it
does warn when the combined pack cannot prove shared visual consistency.

Current warning signals:

- `style_contract_palette_empty`: the contract has no comparable palette colors.
- `character_style_report_missing`: the character pack did not include a
  `debug_report.json.pixel_style` report.
- `scene_style_report_missing`: the scene pack did not include
  `style_correction.json` or `quality_gate.json.style_correction`.
- `character_style_palette_mismatch`: the contract palette has less than 25%
  overlap with the character style report palette.
- `scene_style_palette_mismatch`: the contract palette has less than 25%
  overlap with the scene style correction palette.

Metrics are written under `project_validation.json.metrics` with `style_`
prefixes, including palette color counts, overlap ratios, and booleans for
whether character/scene style evidence was present.

By default, style-contract validation uses policy `warn`. Callers that need a
hard release gate can pass strict style policy:

- Core: `buildProjectPack({ stylePolicy: "strict" })`
- CLI: `project pack --strict-style-contract`
- API: `POST /api/project-pack` with `strictStyleContract: true` or
  `stylePolicy: "strict"`

In strict mode, any style-contract warning also adds the blocking error
`style_contract_failed`, making the project pack status fail while preserving
the original style warning list for diagnosis.

## Project Pack Artifact

`buildProjectPack()` accepts existing character and scene result objects and
emits:

```json
{
  "status": "pass",
  "projectManifest": {},
  "validation": {
    "status": "pass",
    "blocking_errors": [],
    "warnings": []
  }
}
```

`buildProjectPackZip()` writes a project archive with this layout:

```text
project_manifest.json
project_validation.json
character/metadata.json
character/animations.json
character/editor_metadata.json
character/debug_report.json
character/source.png
character/normalized_sheet.png
character/character_pack.zip
scene/scene.json
scene/tile_atlas.json
scene/tile_map.json
scene/quality_gate.json
scene/project.ldtk
scene/tileset.png
scene/scene_pack.zip
```

`project pack --character-dir <dir> --scene-dir <dir>` reads existing artifact
directories and writes `project_manifest.json`, `project_validation.json`, and
`project_pack.zip` to the output job directory.

## Local API And UI

The browser UI exposes a `project-pack` tab. It can sync the latest completed
character and scene jobs from the current session, or accept explicit generated
job ids.

```http
POST /api/project-pack
```

Request:

```json
{
  "projectId": "demo_project",
  "characterJobId": "job_character",
  "sceneJobId": "job_scene"
}
```

Snake-case aliases are accepted for local automation:

```json
{
  "project_id": "demo_project",
  "character_job_id": "job_character",
  "scene_job_id": "job_scene"
}
```

The server resolves job ids to `generated/<job-id>` artifact directories. It
does not accept arbitrary browser-supplied filesystem paths.

## Validation

`validateProjectManifest()` fails when:

- `project_id` is missing,
- the character pack section is missing or lacks `id` / `profile`,
- the scene pack section is missing or lacks `id` / `profile`,
- the shared style contract is missing or lacks `mode` / `palette`.

`buildProjectPack()` also fails project validation when the referenced child
artifact directories are incomplete, or when the child character/scene quality
status is already failed.

Style-contract validation warnings do not block archive writing in default
`warn` mode. They are intended to make cross-pack style drift visible before
teams opt into strict shared-style release gates.

## Non-Goals

- No live character or scene generation inside the project pack command.
- No live scene generation.
- No new engine-specific exporter beyond preserving the scene LDtk project.
- No remote storage or multi-user project library.

LDtk project JSON now lives in `src/scene-pack/ldtkProjectExport.js`; archive
and UI integration remain separate work.

## Verification

```bash
node --test test/project-pack/projectManifest.test.js
node --test test/project-pack/projectPack.test.js test/character-pack/cli.test.js
```
