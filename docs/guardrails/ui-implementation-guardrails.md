# UI Implementation Guardrails

**Date:** 2026-06-04
**Status:** Active
**Applies to:** Any AI tool or human contributor implementing or redesigning UI in this repository.

When an AI tool implements or redesigns UI, the task is to re-skin the EXISTING
working pipeline, NOT to build a static mockup. Backend behavior, the
`processSheet` pipeline, validator, exporters, and generation providers must
keep working after the change.

This document is a soft guardrail. The hard guardrail is `npm test` plus
parallel-not-replace structure. Both must hold.

## Hard Rules

1. No mock, fake, sample, dummy, placeholder, or hardcoded data in place of
   real pipeline output. The preview, quality report, gallery, and export
   surfaces must render REAL `processSheet` results, not canned JSON.

2. Contract files. Do NOT modify these without explicit human approval:
   - `src/character-pack/processSheet.js` and any pipeline module it calls
     (`framePipeline.js`, `processArtifacts.js`, `processReport.js`,
     `sourceLayouts.js`, `normalizer.js`, `sheetSlicer.js`,
     `backgroundRemoval.js`, `stylePipeline.js`, etc.)
   - `src/character-pack/validator.js`, `failureTaxonomy.js`
   - `src/character-pack/exporters/*`
   - `src/character-pack/providers/*`
   - existing `server.js` API endpoint behavior and the job-state enum
   - `src/character-pack/profile.js`, `generationDefaults.js`
   Existing application UI work lives in `src/ui/*` and `index.html`.
   Editor Workspace UI may additionally use `editor.html`,
   `src/editor-app.js`, and `src/ui/editor/*` under
   `docs/guardrails/editor-workspace-guardrails.md`.
   Future `/api/editor/*` endpoints may be added through thin route delegation
   after the approved Editor Workspace phase; existing endpoint behavior must
   not change. If a UI task seems to need an unrelated contract-file change,
   STOP and ask the human.

3. Before changing code, trace the real data flow and write it down:
   - `index.html` entry and which `src/ui/*` module mounts each tab
   - `src/ui/characterPack/api.js` (the fetch calls)
   - `server.js` endpoints: `/api/generate-character`, `/api/process-sheet`,
     `/api/jobs/:id`, `/api/gemini-state`
   - `processSheetBuffer(buffer, options)` — the options it accepts
   - the artifacts it returns (`animations.json`, `debug_report.json`,
     quality metrics, export zips, row GIF previews)

4. PARAMETER BINDING CONTRACT (this project's highest UI risk).
   Every option `processSheetBuffer` accepts MUST map to either a UI control
   or a documented default. After implementation, produce this table and
   confirm zero silent disconnects:
   `name`, `description`, `sourceLayout`/`preset`, `backgroundMode`,
   `backgroundTolerance`, `blackSourceBuffer`, `manualOverrides`,
   `anchorOffset`, `frameAdjustments`, `lockedAnimations`, `autoCorrect`,
   `motionStabilize`, `styleEnforcement`.
   If a backend capability has no UI control, LIST it. Do not silently drop it.

5. Do not lose the differentiators. The redesign MUST keep these visible:
   - the AI-generation entry (default preset `fixed_region_motion_v0`) AND the upload
     entry (default `topdown_rpg_v0`). Never ship upload-only.
   - the Quality Report surface (status + failure taxonomy + auto-repair).
   - the multi-engine export surface (Godot / RPG Maker / OCAD active;
     not-yet-built targets shown grayed as "Soon", not removed).

6. Async surfaces must handle the REAL job states, not generic spinners:
   `queued`, `generating`, `post_processing`, `done`,
   `failed_safety_filter`, `failed_model_error`, `failed_post_processing`.

7. Missing fields. If the UI needs a field the backend does not return: use
   existing fields; add a clearly-marked fallback only if necessary; LIST the
   missing fields after implementation; never invent a fake data structure.
   Reshape data via a mapper in `src/ui/`, never by changing a contract file.

8. PARALLEL, NOT REPLACE. Build the new layout alongside the old UI (new
   module/route). Keep the old UI reachable until the new one is fully wired
   and verified. Do NOT delete the old UI in the same change that introduces
   the new one.

9. `npm test` MUST pass after every section. The test suite is the contract
   guard. If a UI change makes a pipeline / validator / exporter test fail,
   you touched something you should not have — revert and ask.

10. Small, reviewable changes. Stop after each major section (left panel,
    workspace, gallery, export). Do NOT perform one large uncontrolled refactor.

## Definition of Done

"It renders" is not done. Done requires ALL of:

- [ ] `git diff` reviewed: no fetch / pipeline / exporter / provider line
      removed, stubbed, or replaced with mock data
- [ ] one REAL `fixed_region_motion_v0` generation runs end-to-end through the new UI
- [ ] one REAL upload + process runs end-to-end through the new UI
- [ ] parameter binding table produced; missing-field list produced
- [ ] `npm test` green
- [ ] old UI still reachable (not deleted)
- [ ] summary provided: files changed, whether any contract file was touched,
      which sections use real data, which use fallback, how to verify the
      live API is still connected

## Why this exists

A markdown rule file does not by itself force any AI tool to comply. The
enforceable layers, in order of reliability, are:

1. The complete `npm test` suite — report the actual pass/fail count; it fails
   regardless of what any AI intends.
2. Parallel-not-replace — the old UI keeps working even if the new one is
   half-wired, so there is never a broken-only state.
3. Human `git diff` review before merge.
4. This document — the soft layer that explains intent.

Rely on layers 1-3 for safety. This document only reduces how often layers
1-3 have to catch a mistake.
