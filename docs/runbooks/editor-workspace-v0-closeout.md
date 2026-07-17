# Editor Workspace v0 Closeout

**Date:** 2026-06-23
**Branch:** `codex/editor-workspace-v0-closeout`
**Baseline:** `codex/editor-workspace-phase-10-project-pack-v1`

Use this runbook to review, merge, and verify Editor Workspace v0 after the
Phase 5-10 implementation sequence. It is intentionally a closeout document:
do not add new v1 exporter behavior here.

## 1. Merge Route

Recommended route:

1. Keep the closeout branch based on `codex/editor-workspace-phase-10-project-pack-v1`.
2. Add only acceptance coverage and review documentation on top of the Phase 10 branch.
3. Open the final review/merge request from `codex/editor-workspace-v0-closeout`
   into the chosen integration branch.
4. Merge only after the checks in this runbook pass and the reviewer accepts the
   v0 feature boundary.

The closeout branch is cumulative: it contains the Phase 5-10 commits plus the
closeout commit. If maintainers prefer per-phase review, use the phase branches
below as the review slices and reserve this branch for final acceptance.

| Phase | Branch | Commit | Scope |
| --- | --- | --- | --- |
| 5 | `codex/editor-workspace-phase-5-animation-timeline` | `d106c35` | Animation timeline |
| 6 | `codex/editor-workspace-phase-6-visual-repair` | `36eefaf` | Visual repair workspace |
| 7 | `codex/editor-workspace-phase-7-asset-library` | `4aa5af7` | Project asset library |
| 8 | `codex/editor-workspace-phase-8-interaction-playtest` | `82077f5` | Interaction protocol and playtest |
| 9 | `codex/editor-workspace-phase-9-scene-flow-board` | `3fc5ba7` | Scene flow board |
| 10 | `codex/editor-workspace-phase-10-project-pack-v1` | `9f21396` | Editor project pack export |

Do not rewrite the phase branches during closeout. If a fix is required, make
the smallest forward commit on the closeout branch or on the relevant phase
branch, then re-run the verification set.

## 2. v0 End-to-End Acceptance

Automated acceptance coverage lives in
`test/editor-project/editorWorkspaceV0Acceptance.test.js`.

The test exercises the v0 spine:

- create an editor project through `/api/editor/projects`;
- import a managed character asset from a generated character job;
- import a managed scene asset from a generated scene job;
- author a second scene, scene-flow link, character layer, animation playback,
  and interaction actions;
- validate and save with revision checks;
- export a project pack through `/api/editor/projects/:id/export-pack`;
- inspect the produced ZIP for project JSON, scene JSON, asset references, and
  copied engine payloads.

Manual browser acceptance, when reviewing the UI:

- `/` still opens the original app.
- `/editor` opens the parallel Editor Workspace.
- A project can be created or loaded without mock pipeline data.
- Explicit generated character and scene job ids can be imported into the
  project asset library.
- A character layer can be placed, animated, and linked to an interaction.
- Scene flow links remain visible and save/load without changing ids.
- Project pack export produces a downloadable ZIP through the editor namespace.
- The legacy `/api/project-pack` behavior remains available.

Required local checks:

```bash
git diff --check
node --test test/editor-project/editorWorkspaceV0Acceptance.test.js test/editor-project/editorProjectPack.test.js test/editor-project/editorProjectApi.test.js test/project-pack/projectPack.test.js
npm test
npm run smoke:local
```

Run the smoke command against a local server URL if the default port is already
busy.

## 3. Release And Review Note

Editor Workspace v0 shipped the parallel editor route and project-owned authoring
model while preserving the existing generation app.

Included in v0:

- Phase 5: animation timeline controls for layer playback.
- Phase 6: visual repair workspace entry points and project-aware repair flow.
- Phase 7: project asset library with immutable managed asset revisions.
- Phase 8: interaction protocol, interaction authoring, and playtest runtime.
- Phase 9: scene flow board for multi-scene project structure.
- Phase 10: editor project pack export with project docs, managed assets, and
  supported engine payloads.

Supported boundaries:

- editor-native project JSON, validation, migration, command helpers, and store;
- project-managed immutable asset storage under `workspace/projects/...`;
- `/api/editor/*` namespace for editor project operations;
- `/editor` as a parallel workspace, with old `/` behavior preserved;
- project pack export that copies supported existing engine payloads.

Not included in v0:

- a full pixel editor;
- mutation of `generated/` job artifacts;
- provider keys or secrets in browser state;
- a new engine scene exporter;
- replacement of the existing app or `/api/project-pack` endpoint;
- claims that unsupported engine-native scene files are production-ready.

## 4. Follow-On Rounds

Engine Handoff v1, Export Review UI, and Consumer Evidence are now merged after
this v0 closeout. Current review references:

- `docs/superpowers/plans/2026-06-23-editor-workspace-engine-handoff-v1-plan.md`
- `docs/runbooks/editor-workspace-engine-handoff-v1.md`
- `docs/runbooks/editor-workspace-consumer-evidence-review.md`

The next Editor Workspace implementation round should start from latest `main`
and keep the same boundary: explicit preview handoff contracts, reviewable
prototype metadata, no legacy exporter behavior changes, and no claims of
complete engine-native scene export.
