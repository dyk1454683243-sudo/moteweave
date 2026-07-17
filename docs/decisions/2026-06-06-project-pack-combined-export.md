# Project Pack Combined Export

**Date:** 2026-06-06
**Status:** Recorded

## Context

v0.4 has separate character pack and scene pack artifact writers. The project
manifest existed, but it was manifest-only and did not produce a combined
project archive.

## Change

Added a project pack export layer:

- builds a project manifest from existing character and scene result objects,
- derives a default shared style contract from the character pixel style report
  when available,
- validates child character and scene statuses before export,
- writes `project_manifest.json`, `project_validation.json`, and
  `project_pack.zip`,
- exposes a provider-free CLI command:
  `project pack --character-dir <dir> --scene-dir <dir>`.

The project ZIP keeps child artifacts under `character/` and `scene/`, and also
preserves `character_pack.zip` plus `scene_pack.zip` for standalone consumers.

## Decision

Keep this as a local packaging layer rather than a new generation pipeline.

Reasons:

- it reuses already verified character and scene artifacts,
- it does not couple scene generation to character generation,
- it gives downstream engine/import work one project-level entrypoint,
- it keeps future UI integration optional.

## Verification

```bash
node --test test/project-pack/projectManifest.test.js test/project-pack/projectPack.test.js test/character-pack/cli.test.js
npm test
```
