# Editor Workspace Guardrails

**Date:** 2026-06-23  
**Status:** Active for Editor Workspace planning and implementation  
**Applies to:** Any task touching `src/editor-project/`, `src/ui/editor/`,
`editor.html`, `src/editor-app.js`, `/api/editor/*`, or Editor Workspace
protocols.

The Editor Workspace is a parallel product surface around existing artifacts.
It must not replace or weaken the current character, motion-source, scene,
2.5D, project-pack, provider, benchmark, or exporter contracts.

## Allowed New Boundaries

These paths are allowed for Editor Workspace phases when the relevant protocol
and plan authorize them:

- `src/editor-project/*` for editor project core, validation, serialization,
  migration, command history, artifact registry, and project storage.
- `editor.html` as the parallel editor entry point.
- `src/editor-app.js` as the parallel editor browser bootstrap.
- `src/ui/editor/*` for editor-specific UI modules.
- `/api/editor/*` as the future local editor API namespace.

`server.js` may add only thin route delegation for `/api/editor/*` and `/editor`.
Existing endpoint behavior must not change.

## Hard Rules

1. Use real artifacts. No mock, fake, placeholder, hardcoded, or sample pipeline
   results may stand in for character, motion-source, scene, 2.5D, or
   project-pack outputs.

2. The old app stays reachable. The existing `/` app must remain active while
   the editor is introduced at `/editor`.

3. Generated artifacts are immutable. The editor may import or copy artifacts
   into project-managed immutable asset storage, but it must not mutate old
   generated job directories in place.

4. Project JSON does not embed binaries. Do not store base64 images, raw PNGs,
   provider request payloads, or other binary asset data inside project JSON.

5. Provider keys stay server-side. Provider keys must not enter browser state,
   project JSON, local editor preferences, logs, or generated metadata.

6. Path access is controlled. Project and asset paths must be generated from
   sanitized ids or validated relative references. Reject absolute paths and
   `..`.

7. Do not scan all of `generated/` or `output/` to discover assets. Import only
   explicit job ids or explicit user-selected files. Continue following
   `AGENTS.md` artifact-directory restrictions.

8. No raw SVG injection. Editor overlays may use SVG DOM nodes, but do not use
   external SVG `innerHTML` or untrusted SVG strings.

9. Keep state layers separate:
   - persistent project state;
   - ephemeral editor UI state;
   - runtime simulation state;
   - processing job state.

10. Every editor project write goes through validator/store code. Do not let UI
    code directly write project JSON.

11. New dependencies require justification, tests, and attribution updates.
    Phase 0.1 through Phase 3 should not introduce React, PixiJS, Konva, or a
    full game engine dependency.

12. Full Pixel Editor remains Not Planned. Visual Repair is scoped to existing
    pipeline controls, processing recipes, masks/regions when approved, and
    before/after quality evidence.

## Phase Boundaries

- Phase 0.1: docs and guardrails only.
- Phase 1: `src/editor-project/*` core only; no UI, no server endpoints.
- Phase 2: project store, artifact registry, and `/api/editor/*` thin route
  delegation; no editor shell.
- Phase 3: parallel editor shell; old app still reachable.
- Phase 4+: scene authoring canvas, timeline, repair workspace, interaction,
  and export features in separate verified stages.

Do not advance to the next phase inside the same task unless the human user
explicitly asks.

## Verification

Every editor phase must run:

- `git status --short`
- `git diff --check`
- the complete `npm test` suite, reporting the actual pass/fail count

UI phases must also run:

- `npm run smoke:local`

If a full verification command cannot be run, report the reason and residual
risk before committing.
