# Scene Pack Artifacts Protocol

**Status:** Draft
**Owner:** Scene pack pipeline
**Introduced:** v0.4 Scene Pack Artifact Writer

## Purpose

Scene pack artifacts define the local delivery layer for scene and tile work. It
turns an in-memory scene result into stable files, generated URLs, and a single
`scene_pack.zip` archive without calling providers or changing tile quality
semantics.

This layer is intentionally small so later CLI, UI, and project export work can
depend on one file contract.

## Modules

```text
src/scene-pack/zipExport.js
src/scene-pack/artifactManifest.js
src/scene-pack/artifactWriter.js
```

Public entry points:

```text
buildScenePackZip(result)
buildScenePackArtifactManifest(jobId, result)
writeScenePackArtifacts({ jobId, outputDir, result })
```

## File Set

The writer emits these core files:

```text
scene.json
tile_atlas.json
tile_map.json
quality_gate.json
scene_pack.zip
```

Optional files are included when present on the result:

```text
project.ldtk
project_manifest.json
style_correction.json
edge_conditioning.json
tile_conditioning_review.json
tile_conditioning_review.png
tileset.png
prompt.txt
generation.json
candidate_selection.json
candidates/candidate_XX/tileset.png
candidates/candidate_XX/quality_gate.json
candidates/candidate_XX/generation.json
```

`scene_pack.zip` includes the same scene, tile, quality, LDtk project, project
manifest, optional style-correction report, optional edge-conditioning report,
optional tile-conditioning review artifacts, tileset, prompt, generation
artifacts, candidate-selection metadata, and candidate evidence artifacts. It
does not include itself.

Real tile sheet ingestion supplies `tileset.png` from the uploaded/source atlas.

## Manifest URLs

`buildScenePackArtifactManifest()` maps each artifact into a stable generated
URL under the job id:

```json
{
  "scene_url": "/generated/scene_job/scene.json",
  "tile_atlas_url": "/generated/scene_job/tile_atlas.json",
  "tile_map_url": "/generated/scene_job/tile_map.json",
  "quality_gate_url": "/generated/scene_job/quality_gate.json",
  "style_correction_url": "/generated/scene_job/style_correction.json",
  "edge_conditioning_url": "/generated/scene_job/edge_conditioning.json",
  "tile_conditioning_review_url": "/generated/scene_job/tile_conditioning_review.json",
  "tile_conditioning_review_image_url": "/generated/scene_job/tile_conditioning_review.png",
  "candidate_selection_url": "/generated/scene_job/candidate_selection.json",
  "candidate_artifact_urls": {
    "candidates/candidate_01/tileset.png": "/generated/scene_job/candidates/candidate_01/tileset.png",
    "candidates/candidate_01/quality_gate.json": "/generated/scene_job/candidates/candidate_01/quality_gate.json",
    "candidates/candidate_01/generation.json": "/generated/scene_job/candidates/candidate_01/generation.json"
  },
  "ldtk_project_url": "/generated/scene_job/project.ldtk",
  "scene_pack_zip_url": "/generated/scene_job/scene_pack.zip",
  "zip_url": "/generated/scene_job/scene_pack.zip"
}
```

Optional URL fields are present only when the corresponding file exists.
`candidate_artifact_urls` preserves nested candidate evidence paths as keys.

## Writer Summary

`writeScenePackArtifacts()` returns a compact status summary:

```json
{
  "job_id": "scene_job",
  "dir": "generated/scene_job",
  "status": "done",
  "reason": null,
  "retry_hint": null,
  "urls": {}
}
```

When the scene tile quality gate has failed, the writer still emits diagnostic
files and returns:

```json
{
  "status": "failed_quality_gate",
  "reason": "tile.visual_seam_mismatch",
  "retry_hint": "inspect_tile_quality_gate"
}
```

## Non-Goals

- No live tile generation.
- No prompt compilation changes.
- No default image correction or seam repair.
- No UI preview.
- No automatic publishing outside the local output directory.

## Verification

```bash
node --test test/scene-pack/artifactWriter.test.js
```
