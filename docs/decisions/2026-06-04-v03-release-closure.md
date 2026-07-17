# v0.3 Release Closure

## Status

Accepted on 2026-06-04.

## Scope

v0.3 is closed as a reliable character-pack pipeline release before broader scene, layer, public sharing, or production deployment work.

## Completed

- `processSheetBuffer()` remains the public orchestration entry point, with pipeline stages split into focused modules.
- Provider code is split into config, image utilities, OpenRouter adapter, Gemini adapter, and shared generation entry points.
- `ocad_motion_v0` is the default AI generation entry while `topdown_rpg_v0` remains the runtime/export profile and upload/manual source path.
- 20-case generation quality decisions are recorded, including the OCAD default route, expected source reuse split, and source-region edge pressure reclassification.
- Local benchmark reports, quality gates, failure taxonomy, and gallery browsing are available.
- Godot NPC, RPGMaker, OCAD, editor metadata, Row GIF previews, debug overlays, source-layout overlays, and multi-resolution outputs are emitted by the character-pack workflow.
- CLI process/generate/benchmark/repair workflows are documented and covered by tests.
- `CHANGELOG.md` records the `0.3.0` release, and package metadata is bumped to `0.3.0`.

## Deferred

- Preview animation transition polish.
- Attachment and slice visualization polish.
- Optional/report-only style enforcement beyond palette/reference metadata.
- Godot `.tres` export.
- Scene/tile/parallax generation, layer workflows, public persistence, auth, billing, and deployment hardening.

## Verification Plan

Release closure must pass provider-free verification:

```text
npm test
npm run character-pack -- process --input test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png --output-dir <tmp> --job-id release_cli --name release_sample_hero --background-mode flood
node --test test/localSmokeScript.test.js
git diff --check
```

Live provider gates are not rerun for the release closure commit because this commit only updates release metadata and documentation. The v0.3 live generation evidence is recorded in the generation-quality and OCAD decision notes.
