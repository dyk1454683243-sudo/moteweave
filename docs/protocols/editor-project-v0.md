# Editor Project Protocol v0

**Status:** Draft, documentation-only  
**Owner:** Editor Workspace  
**Introduced:** 2026-06-22  
**Decision:** `docs/decisions/2026-06-22-editor-workspace-direction.md`

## Purpose

`editor_project_v0` is the durable project document for the future Editor
Workspace. It references validated pipeline artifacts and scene documents. It
does not embed images, provider keys, raw generation payloads, or generated job
contents.

The first implementation should make this protocol validatable and
round-trippable before adding a browser editor.

## Document Shape

```json
{
  "version": "editor_project_v0",
  "id": "project_demo",
  "name": "Demo Project",
  "revision": 1,
  "created_at": "2026-06-22T00:00:00.000Z",
  "updated_at": "2026-06-22T00:00:00.000Z",
  "active_scene_id": "scene_main",
  "assets": {},
  "scenes": {
    "scene_main": {
      "id": "scene_main",
      "version": "editor_scene_v0",
      "name": "Main Scene",
      "world": {
        "w": 1280,
        "h": 720
      },
      "viewport": {
        "w": 1280,
        "h": 720
      },
      "camera": {
        "x": 0,
        "y": 0,
        "zoom": 1
      },
      "background": "#101418",
      "state_defaults": {},
      "entities": [],
      "layers": [],
      "created_at": "2026-06-22T00:00:00.000Z",
      "updated_at": "2026-06-22T00:00:00.000Z"
    }
  },
  "scene_flow": {
    "nodes": {
      "scene_main": {
        "x": 80,
        "y": 60,
        "w": 320,
        "h": 180
      }
    },
    "links": []
  },
  "settings": {
    "pixel_art": true,
    "default_snap": 16,
    "default_viewport": {
      "w": 1280,
      "h": 720
    }
  }
}
```

## Required Fields

- `version`: must be `editor_project_v0`.
- `id`: stable project id. Use lowercase letters, numbers, `_`, and `-`.
- `name`: user-facing project name.
- `revision`: positive integer incremented on formal save.
- `created_at` / `updated_at`: ISO-8601 timestamps.
- `active_scene_id`: id of an existing scene.
- `assets`: object keyed by asset id. Values follow
  `docs/protocols/editor-asset-ref-v0.md`.
- `scenes`: object keyed by scene id. Values follow
  `docs/protocols/editor-scene-v0.md`.
- `scene_flow`: optional board layout and links between scenes.
- `settings`: editor project defaults.

`revision` is the project document save revision. It is separate from asset
revision ids inside `editor_asset_ref_v0`.

## State Separation

Only persistent project state belongs in this file.

Do not persist:

- selected layer;
- hover state;
- current drag draft;
- modal state;
- clipboard contents unless a later protocol explicitly adds it;
- animation tick state;
- runtime flags and inventory;
- queue/job status snapshots;
- provider keys or provider-session config.

Ephemeral editor state may live in a separate UI preference store later, but it
is not part of `editor_project_v0`.

## Scene Flow

`scene_flow.nodes` stores optional board positions for scene cards:

```json
{
  "scene_main": {
    "x": 80,
    "y": 60,
    "w": 320,
    "h": 180
  }
}
```

`scene_flow.links` stores explicit scene links:

```json
[
  {
    "id": "link_main_to_room",
    "from_scene_id": "scene_main",
    "to_scene_id": "scene_room",
    "label": "Door"
  }
]
```

## Validation Rules

A validator must reject documents when:

- `version` is unknown;
- required ids are missing or malformed;
- `active_scene_id` does not resolve;
- an asset map key does not equal `asset.id`;
- a scene map key does not equal `scene.id`;
- an asset reference violates `editor_asset_ref_v0`;
- a scene violates `editor_scene_v0`;
- a scene contains duplicate layer ids;
- a scene contains duplicate entity ids;
- a scene layer references a missing asset;
- a scene flow link references a missing scene;
- a scene flow node key does not resolve to an existing scene;
- a scene flow link id is duplicated;
- a scene flow link `from_scene_id` or `to_scene_id` does not resolve;
- `revision` is not a positive integer;
- viewport, world, or snap values are non-positive where required;
- the JSON contains base64 image payloads;
- the JSON contains raw provider keys, tokens, or obvious secret fields;
- a persisted path is absolute or contains `..`.

## Migration

The first migration function may be an identity migration for
`editor_project_v0`.

Future versions must:

- keep old documents readable through explicit migration steps;
- increment `revision` only on save, not merely on migration preview;
- record the original version in migration diagnostics;
- avoid silent data loss.

## Persistence Requirements

The later Project Store must:

- write through an atomic temp-file plus rename flow;
- validate before writing;
- preserve a backup of the previous formal save;
- keep autosave separate from formal save;
- generate project paths from sanitized project ids only;
- never copy generated artifacts into project JSON.

Phase 2 should use project-managed immutable asset storage:

```text
workspace/
  projects/
    <project-id>/
      project.json
      project.backup.json
      autosave.json
      assets/
        <asset-id>/
          <revision-id>/
      recipes/
```

Project JSON stores relative artifact references to these managed files. It
must not embed binary data. Imported generated job artifacts remain immutable
sources; accepting a repair or import creates a new managed asset revision
instead of changing the old job directory in place.

Phase 2 must update `.gitignore` to exclude `/workspace/` before writing local
project assets.

## Non-goals

- No full game-engine scene format in v0.
- No remote storage.
- No multiplayer collaboration.
- No embedded binary image data.
- No direct provider calls.
- No mutation of generated artifact directories.
