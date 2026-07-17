# Release Closeout - 2026-06-23

**Status:** Release closeout candidate verified locally
**Main baseline:** `0732956` (`Merge roadmap status sync after Motion Source Apply Set UI`)
**Scope:** Local provider-free product surface through Editor Workspace v0,
Engine Handoff v1, Consumer Evidence, Motion Source Apply Set, and current
2.5D/scene tooling.

## Included Mainline Blocks

- Editor Workspace v0: parallel `/editor` shell, project persistence, scene
  authoring canvas, animation timeline, project asset library, interaction and
  playtest support, scene flow, and editor project pack export.
- Editor Workspace handoff stack: neutral engine handoff manifest, Godot and
  LDtk preview metadata, export review UI, static consumer validation, manual
  evidence, and generated reviewer checklist.
- Motion Source Phase A: provider-free source analysis, frame selection,
  strip building, single-action apply, source-set identity gate, editor
  handoff, encoded GIF/ZIP regression coverage, and guarded source-set apply
  through CLI, API, and browser UI.
- Scene and 2.5D tooling: local scene/tile processing, 2.5D material source
  normalization, material benchmark/review evidence, terrain map workflow,
  atlas exports, Tiled/LDtk preview payloads, and consumer package evidence.
- Character pack quality surface: structured text-to-image options,
  fixed-region source contracts, quality-character mode, pixel finishing,
  repair planning/apply paths, and compatibility exports.

## Claim Boundaries

- No provider calls are required for Motion Source, Editor Workspace, engine
  handoff preview, consumer evidence, local scene/2.5D review, or this closeout.
- Engine handoff remains preview metadata only: no bundled engine plugin, no
  generated native Godot scene file, and no complete LDtk world export.
- Motion Source Apply Set assembles reviewed local strips only. It is not AI
  video generation, arbitrary action semantics, or full motion planning.
- Existing `/` app, legacy `/api/project-pack`, provider configuration, and
  generated job artifact immutability remain preserved.

## Release Gate Checklist

- [x] `git diff --check`
- [x] `npm test`
- [x] `npm run smoke:local -- --base-url http://localhost:4186`
- [x] Confirm GitHub has no open release-blocking PRs.
- [x] Confirm local working tree has no staged release changes before closeout
  commit.
- [x] Record any local-only workspace issues that should not enter the release.

## Verification Evidence

- `git diff --check`: passed with no output.
- `npm test`: passed, `661 passed / 0 failed`.
- `npm run smoke:local -- --base-url http://localhost:4186`: passed; verified
  tabs markup, editor shell, AI provider state, GIF API, scene/project/2.5D
  APIs.
- `gh pr list --state open`: no open PRs at closeout start.

## Local Workspace Notes

At closeout start, the workspace contained unrelated untracked duplicate files
named like `* 2.js` under `src/` and `test/`. They are not part of this release
closeout, should not be staged, and should be handled manually because project
rules forbid bulk deletion by agents. The full `npm test` run still passed, but
the duplicate untracked test files increased the discovered test count from the
clean mainline count; use a clean checkout for official release-tag validation
after manual cleanup.

## Next Recommended Work

- Manual cleanup or confirmation of the local `* 2.js` duplicate files.
- Optional release tag/version decision after the closeout gate is accepted.
- User-facing polish pass, starting with the already-recorded bilingual UI
  surface, if the next goal is packaging the tool for broader use.
