# Editor Workspace Consumer Evidence Review

**Date:** 2026-06-23
**Scope:** Review and merge route for the consumer evidence layer on top of the
Editor Workspace engine handoff and export review console stack.

Use this runbook when opening or reviewing the Consumer Evidence PR. It is a
merge-route document only; it does not add new exporter behavior.

## Branch Stack

Review the branches in this order:

| Order | Branch | Head commit | Scope |
| --- | --- | --- | --- |
| 1 | `codex/editor-workspace-engine-handoff-v1` | `df5e832` | Neutral engine handoff manifest plus Godot and LDtk preview metadata. |
| 2 | `codex/editor-workspace-ui-review-console` | `64f5b4c` | Export Review Console UI for handoff inspection, unsupported items, scene/layer preview, and checklist. |
| 3 | `codex/editor-workspace-consumer-evidence-v1` | `fe09832` | Static consumer validation, review status, and manual import evidence package. |

The Consumer Evidence PR should target:

- **base:** `codex/editor-workspace-ui-review-console`
- **head:** `codex/editor-workspace-consumer-evidence-v1`

Do not target the Consumer Evidence PR directly at the v0 closeout branch unless
the earlier stack branches have already been merged forward.

## Consumer Evidence PR Scope

Expected files and behavior:

- `src/editor-project/engineConsumerEvidence.js`
  - Builds `engine_consumer_validation_v1`.
  - Builds `engine_export_review_status_v1`.
  - Builds `engine_manual_import_evidence_v1` and Markdown checklist content.
- `src/editor-project/editorProjectPack.js`
  - Adds `consumer_evidence/engine_consumer_validation.json`.
  - Adds `consumer_evidence/manual_import_evidence.json`.
  - Adds `consumer_evidence/manual_import_checklist.md`.
  - Adds `review_status` to `editor_project_pack_manifest.json`.
- `src/editor-project/apiHandler.js`
  - Returns `review_status` from `/api/editor/projects/:projectId/export-pack`.
- `src/ui/editor/shell.js`
  - Displays consumer readiness and unsupported item status in the Export panel.
- `docs/protocols/editor-engine-handoff-v1.md`
  - Records the evidence files and review-status contract.
- `docs/runbooks/editor-workspace-engine-handoff-v1.md`
  - Adds static consumer validation and manual evidence review steps.

Non-goals:

- No Godot plugin, `.tscn` file, LDtk world export, external editor launch, or
  saved round-trip claim.
- No provider calls.
- No changes to legacy `/api/project-pack` behavior.
- No mutation of `generated/` job artifacts.

## Required Verification

The Consumer Evidence branch was last verified with:

```bash
git diff --check
node --test test/editor-project/editorEngineHandoff.test.js test/editor-project/editorProjectPack.test.js test/editor-project/editorProjectApi.test.js test/editor-project/editorShellStructure.test.js
npm test
npm run smoke:local -- --base-url http://localhost:4203
```

Recorded results:

- focused tests: 17 passed / 0 failed
- full `npm test`: 541 passed / 0 failed
- local smoke: passed
- browser check: `preview_metadata_only` visible, `overflowX:false`

Before merging after any new commit, re-run at least:

```bash
git diff --check
node --test test/editor-project/editorEngineHandoff.test.js test/editor-project/editorProjectPack.test.js test/editor-project/editorProjectApi.test.js test/editor-project/editorShellStructure.test.js
npm test
npm run smoke:local -- --base-url <local-server-url>
```

## Suggested PR Body

```markdown
## Summary

Adds the Editor Workspace consumer evidence layer on top of the export review
console. Project pack export now emits static consumer validation, manual import
evidence, and a reviewer checklist, while preserving the preview-only engine
claim boundary.

## Scope

- Add `engine_consumer_validation_v1`.
- Add `engine_export_review_status_v1`.
- Add `engine_manual_import_evidence_v1` and generated Markdown checklist.
- Include consumer evidence files in `editor_project_pack_v1` and ZIP output.
- Return `review_status` from `/api/editor/projects/:projectId/export-pack`.
- Surface consumer readiness in the Export panel.
- Update protocol and runbook docs.

## Boundary

This does not generate Godot scenes, ship plugins, export complete LDtk worlds,
launch external editors, call providers, or change legacy `/api/project-pack`.

## Verification

- `git diff --check`
- `node --test test/editor-project/editorEngineHandoff.test.js test/editor-project/editorProjectPack.test.js test/editor-project/editorProjectApi.test.js test/editor-project/editorShellStructure.test.js`
- `npm test` - 541 passed / 0 failed
- `npm run smoke:local -- --base-url http://localhost:4203`
- Playwright browser check: `preview_metadata_only` visible and `overflowX:false`
```

## Merge Route

Recommended route:

1. Review and merge `codex/editor-workspace-engine-handoff-v1`.
2. Retarget or merge `codex/editor-workspace-ui-review-console` onto the merged
   handoff branch.
3. Retarget or merge `codex/editor-workspace-consumer-evidence-v1` onto the
   merged UI review branch.
4. After all three are accepted, update the final integration branch or v0.5
   release branch with the combined stack.

If a reviewer needs one combined review, use the cumulative branch
`codex/editor-workspace-consumer-evidence-v1` and compare it against
`codex/editor-workspace-engine-handoff-v1`, but keep the merge order above so
the individual review boundaries remain understandable.

## Reviewer Checklist

- [ ] Consumer Evidence PR targets `codex/editor-workspace-ui-review-console`.
- [ ] `consumer_evidence/engine_consumer_validation.json` is written to disk and
      ZIP output.
- [ ] `consumer_evidence/manual_import_evidence.json` is written to disk and ZIP
      output.
- [ ] `consumer_evidence/manual_import_checklist.md` is written as Markdown, not
      JSON-encoded text.
- [ ] API response includes `review_status`.
- [ ] Export panel shows consumer readiness from real API data.
- [ ] Unsupported items stay explicit and visible.
- [ ] Preview-only claim boundary remains intact.
- [ ] Legacy `/api/project-pack` behavior is unchanged.
