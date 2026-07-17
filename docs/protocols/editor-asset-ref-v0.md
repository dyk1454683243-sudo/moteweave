# Editor Asset Reference Protocol v0

**Status:** Draft, documentation-only  
**Owner:** Editor Workspace  
**Introduced:** 2026-06-22

## Purpose

`editor_asset_ref_v0` records reusable project assets and their immutable
revisions. It references managed artifact files copied or registered from
existing pipeline outputs. It is an index and provenance layer, not a binary
asset container.

## Asset Reference Shape

```json
{
  "id": "asset_character_sample_hero",
  "kind": "character_pack",
  "name": "Sample Hero",
  "profile": "topdown_rpg_v0",
  "active_revision_id": "rev_002",
  "revisions": {
    "rev_001": {
      "id": "rev_001",
      "source_job_id": "job_original",
      "parent_revision_id": null,
      "created_at": "2026-06-22T00:00:00.000Z",
      "quality_status": "warning",
      "production_status": "review_required",
      "processing_recipe_ref": null,
      "artifacts": {
        "sheet": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_001/normalized_sheet.png",
        "animations": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_001/animations.json",
        "metadata": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_001/metadata.json",
        "editor_metadata": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_001/editor_metadata.json",
        "debug_report": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_001/debug_report.json"
      }
    },
    "rev_002": {
      "id": "rev_002",
      "source_job_id": "job_repaired",
      "parent_revision_id": "rev_001",
      "created_at": "2026-06-22T01:00:00.000Z",
      "quality_status": "pass",
      "production_status": "ready",
      "processing_recipe_ref": "workspace/projects/project_demo/recipes/rev_002.json",
      "artifacts": {
        "sheet": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_002/normalized_sheet.png",
        "animations": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_002/animations.json",
        "metadata": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_002/metadata.json",
        "editor_metadata": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_002/editor_metadata.json",
        "debug_report": "workspace/projects/project_demo/assets/asset_character_sample_hero/rev_002/debug_report.json"
      }
    }
  },
  "provenance": {
    "source_type": "upload",
    "provider": null,
    "model": null
  },
  "clips": {},
  "tags": []
}
```

`active_revision_id` selects the revision used by scene layers and exports.
`project.revision` in `editor_project_v0` records project saves; it is not an
asset revision id.

## Asset Kinds

Initial kinds:

- `character_pack`
- `scene_pack`
- `tilemap`
- `static_image`
- `spritesheet`
- `effect`
- `ui`

Reserved:

- `audio_future`

## Asset Revisions

Each revision records one imported, generated, or repaired asset state.

Revision fields:

- `id`: stable revision id, usually `rev_001`, `rev_002`, and so on.
- `source_job_id`: originating pipeline job id, if any.
- `parent_revision_id`: previous revision id or `null`.
- `created_at`: ISO-8601 timestamp.
- `quality_status`: status from validation evidence.
- `production_status`: editor readiness status.
- `processing_recipe_ref`: relative path to the recipe that created the
  revision, or `null`.
- `artifacts`: relative paths to immutable revision files.

Revision validation:

- `active_revision_id` must resolve.
- revision map key must equal `revision.id`.
- `parent_revision_id` must resolve or be `null`.
- revision parent graph must not contain cycles.
- `source_job_id` must be absent/null or match the controlled job-id format.
- each revision must record `created_at`.
- each revision must record its own quality and production status.
- old revisions must not be rewritten in place when a new repair is accepted.

## Artifact References

Artifact paths must be relative project/workspace paths. They must not be
absolute paths and must not contain `..`.

Phase 2 uses project-managed immutable storage under
`workspace/projects/<project-id>/assets/<asset-id>/<revision-id>/`. Generated
job artifacts may be the import source, but durable editor projects should not
depend only on temporary `generated/<job-id>/` paths.

Typical character-pack artifacts:

- `normalized_sheet.png`
- `animations.json`
- `metadata.json`
- `editor_metadata.json`
- `debug_report.json`
- Row GIF previews
- ZIP export

Typical scene or tileset artifacts:

- scene or tile map JSON
- tileset PNG
- metadata JSON
- validation JSON
- LDtk/Tiled export files
- preview PNGs
- ZIP export

## Clip Descriptor

`clips` normalizes animation metadata for timeline and playback:

```json
{
  "walk_down": {
    "id": "walk_down",
    "source": "animations.json",
    "frames": [16, 17, 18, 19],
    "fps": 8,
    "loop_mode": "loop",
    "frame_size": {
      "w": 96,
      "h": 96
    },
    "anchor": {
      "x": 48,
      "y": 88
    }
  }
}
```

The first implementation may derive clip descriptors from the active revision's
`animations.json` and `editor_metadata.json` artifacts.

## Asset Kind Requirements

| Kind | `source_job_id` | `profile` | `clips` | Required artifacts |
|---|---:|---:|---:|---|
| `character_pack` | required | required | required | `sheet`, `animations`, `metadata`, `editor_metadata`, `debug_report` |
| `scene_pack` | required | required | optional | `scene`, `tile_map`, `tile_atlas`, `validation`, `preview` |
| `tilemap` | optional | required | no | `tile_map`, `tileset` |
| `static_image` | optional | optional | no | `image` |
| `spritesheet` | optional | optional | required | `sheet`, `clip_metadata` |
| `effect` | optional | optional | optional | `image` or `sheet` |
| `ui` | optional | optional | optional | `image` or `sheet` |

`audio_future` is reserved and must not be accepted until a later protocol
defines audio artifact requirements.

## Quality And Production Policy

`quality_status` should be one of:

- `pass`
- `warning`
- `fail`
- `unknown`

`production_status` should be one of:

- `ready`
- `review_required`
- `blocked`

Default mapping:

| Quality | Default production status |
|---|---|
| `pass` | `ready` |
| `warning` | `review_required` |
| `fail` | `blocked` |
| `unknown` | `review_required` |

If a user overrides a warning, fail, or unknown asset to `ready`, the revision
must record an override object:

```json
{
  "reason": "accepted visual seam warning",
  "created_at": "2026-06-22T02:00:00.000Z"
}
```

Do not silently mark warning, fail, or unknown assets as ready.

## Provenance

`provenance.source_type` may include:

- `upload`
- `provider`
- `manual_import`
- `local_procedural`
- `derived_revision`

Provider metadata may record provider and model names, but must not store raw
API keys, credentials, or private request payloads.

## Validation Rules

Reject asset refs when:

- `id` is malformed;
- `kind` is unknown;
- `active_revision_id` is missing or does not resolve;
- a revision map key does not equal `revision.id`;
- a parent revision id does not resolve;
- the revision graph contains a cycle;
- a revision `quality_status` is unknown;
- a revision `production_status` is unknown;
- a revision marks warning/fail/unknown quality as ready without override
  reason and timestamp;
- required artifacts for the kind are missing;
- any artifact path is absolute or contains `..`;
- any field contains base64 image payloads;
- any field appears to contain provider secrets;
- a clip id is malformed;
- clip frames are not non-negative integers;
- clip fps is not positive;
- frame sizes and anchors are invalid.

## Non-goals

- No binary asset embedding.
- No external URL dependency for core local project playback.
- No copying generated artifacts into the project JSON.
- No automatic deletion of orphaned artifacts.
