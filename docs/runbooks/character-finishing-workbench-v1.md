# Character Finishing Workbench v1 Verification

Verified locally on 2026-07-11. This document records observed behavior from the
`codex/character-finishing-workbench-v1` worktree; it is not an independent CI
result.

## Source Design

- Spec: `docs/superpowers/specs/2026-07-10-character-finishing-workbench-v1-design.md`
- Approved design: `b17080e481dc6c9409612906e9a8d45043d4f360`
- Lineage: `b17080e`, `36eefaf`, `58176ce`, `89cf7b2`
- Implementation is original repository code. No external code, UI, wording, or
  asset was copied, and no dependency was added.

## 1:1 Matches

| Requirement | Evidence | Result |
| --- | --- | --- |
| Desktop focused layout | 1440×900 and 2048×963 screenshots below; `editor shell delegates the focused Repair workbench and restores workspace mode` | Match: Repair hides the global sidebars only while focused and restores them on exit. |
| Centered fill Canvas | 1440 Canvas 1100×280; 2048 Canvas 1708×323 with computed content viewport `{x:710,y:18,w:288,h:288}`; `imageSmoothingEnabled=false` | Match: Canvas consumes the available center region, remains centered, and uses nearest-neighbor rendering. |
| Bottom filmstrip | Desktop screenshots; `Repair filmstrip exposes the real clip label, fps, duration, position, and zero-fps playback truth` | Match: clip selector, transport, status, and horizontal frames remain below Canvas. |
| Full-height Recipe | Desktop screenshots and internal scroll ranges 2166 px at 1440 / 2090 px at 2048 | Match: 340 px bounded Recipe column scrolls through Geometry, Cleanup, Pixel Finishing, Advanced, Output evidence, and collapsed AI Action Repair. |
| Mobile Recipe drawer | 390×844 screenshots; fresh-session DOM/a11y probe; `Repair panel mobile Recipe drawer traps focus and closes on Escape` | Match: modal drawer, full viewport backdrop, inert background, focus trap, Escape/backdrop close, and focus return. |
| State/action truth | Literal 22-state `Repair UI state …` matrix plus action/tone test | Match: loading, empty, dirty, invalid, processing, ready, warning, blocked, failure, conflicts, accepted, and teardown have explicit action gates and announcements. |
| Local-only edits | Browser tolerance/anchor/grid edits and `Repair Recipe full control matrix dispatches only its declared local path with zero Build calls` | Match: edits changed only the ephemeral draft and produced zero POST requests. |
| Exact Build and Accept | Browser request log and specialized route tests | Match: one Build produced one preview job; one Accept imported that exact job as one immutable child revision. |
| Accessibility and motion | Visible focus ring, roving filmstrip focus, modal semantics, disabled reasons, `aria-live`, and reduced-motion CSS tests | Match. |
| Capability truth | UI source assertion and browser inspection | Match: unsupported controls are disabled/labelled; no future-only capability appears active. |

## Recorded Deviations

| Deviation | Reason | Approval/source |
| --- | --- | --- |
| Desktop hides global sidebars only in Repair | The approved Canvas/Recipe/filmstrip layout needs the width; leaving Repair restores the shell. | User-approved design, `b17080e` |
| Recipe is a mobile modal drawer | Responsive adaptation keeps Canvas and actions reviewable at 390 px. | Approved responsive behavior, `b17080e` |
| No splitters or virtualization in v1 | Explicit v1 boundary; current real fixture has four frames per clip and internal filmstrip overflow. | `b17080e` |
| Pixel Grid Refinement is disabled as `Coming later` | This processing entry does not expose the capability. | Capability-driven truth in the approved plan |
| Fixed-region staging is read-only provenance and forced off | Managed `source.png` is already post-staging; reapplying staging would be incorrect. | Pipeline authority contract |
| `dual_matte` is conditional | It requires an original managed source and a validated managed black-matte Buffer. | Security and input-authority contract |
| Output sizes and style-report enablement are not editable | v1 fixes output sizes to `[96,64,48,32,16]` and forces style reporting on. | Approved binding contract |

## Capability Truth

| Category | Items and evidence |
| --- | --- |
| Design and implemented | Provider-free local Preview; exact-job Accept; Before/After/Split/Difference/Onion modes when evidence permits; overlays; zoom/pan/Fit; real clip filmstrip; full Recipe controls; quality evidence; reset/discard; conflict/failure states; desktop focus mode; mobile drawer. Covered by UI/controller/renderer/API tests and browser evidence. |
| Design but unavailable | Bounds/debug/comparison modes remain disabled when their actual sidecar or compatible frame is unavailable; `dual_matte` remains disabled without managed matte authority; Pixel Grid Refinement is explicitly disabled. Browser fixture showed truthful disabled reasons. |
| Implemented but not represented | None. Changed-file and shell-surface audits found no new backend capability without a Repair UI state or documented server-only authority. |
| Future only | Pixel Grid Refinement, splitters, user-resizable filmstrip, sequence virtualization. None is presented as active. |

The existing AI Action Repair provider flow remains separate and collapsed. It
retains its pre-existing provider/quota semantics and is not used by local
Preview.

## API And Capability Impact

| Area | Observed impact |
| --- | --- |
| New routes | `POST /api/editor/projects/:projectId/assets/:assetId/reprocess` (202) and `POST /api/editor/projects/:projectId/assets/:assetId/reprocess/:jobId/accept` (200). |
| Existing routes | Existing `/`, `/editor`, project GET/save, artifact loading, general import, Playtest, Export, providers, validators, and exporters remain reachable and unchanged. Specialized Accept never calls the general import route. |
| Provider/quota | Local Preview makes no provider request and consumes no provider quota. Existing AI Action Repair remains separate. |
| Project format | No project-format migration. Accept adds one normal immutable child asset revision and managed Recipe/context evidence; draft, preview, camera/view, and panel state are not serialized. |
| Renderer/dependencies | Canvas 2D with nearest-neighbor drawing and existing image/artifact clients. No new runtime package, renderer library, or service endpoint family. |
| Processing contracts | Existing Character Pack processing modules are consumed but not modified. Recipe canonicalization and server source authority live under `src/editor-project/`. |

## Authorization And Offline States

This local workspace has no account, role, or permission model, so unauthorized
and no-permission states are not applicable and no synthetic UI was added for
them. Preview is local and provider-free. When the local server was no longer
available, the browser produced a connection refusal and no project mutation;
the UI does not claim an offline processing capability.

Managed artifact failures are represented separately: only
`missing_artifact` offers Retry; `unsafe_artifact_path` is a blocking state and
never retries implicitly.

## Parameter Binding Audit

All Recipe-to-processing mappings are implemented in
`src/editor-project/recipes.js`; server-owned identity/provenance values are
added in `src/editor-project/characterReprocessCoordinator.js`. The primary
binding tests are `test/editor-project/editorProjectCore.test.js`
(`Workbench Recipe maps canonical fields and fixed defaults to live processing
options`), `editorRepairRecipePipelineBinding.test.js`,
`editorCharacterReprocessApi.test.js`, and
`editorRepairWorkbenchPanel.test.js`.

| Recipe/server source | Processing option | Control/default/provenance | Test/file evidence | Result |
| --- | --- | --- | --- | --- |
| Project asset name | `name` | Server-derived, read-only | `managed Preview derives canonical authority, hashes, and provider-free processing input`; coordinator | Pass |
| Managed `metadata.json` description | `description` | Safe allowlist, server-derived | Same managed Preview test; coordinator | Pass |
| Validated asset plus managed metadata/animations | `profile` | Server-resolved registered profile | Managed Preview and `Preview fails closed for identity, revision, profile, metadata, input, and black-matte authority conflicts` | Pass |
| Preview service job clock | `createdAt` | Service timestamp; caller value cannot win | `real queued Preview binds processing metadata and context to the service-created job clock`; service snapshot test | Pass |
| Parent metadata plus selected managed input | `source` | Server-built `derived_revision` provenance | Managed Preview test; coordinator | Pass |
| Parent metadata allowlist | `generation` | Server-sanitized; no prompt/secret/path coercion | `generation provenance uses the recursive allowlist without coercing objects or paths`; managed Preview test | Pass |
| `source.source_layout` | `sourceLayout` | Immutable source identity | `Preview uses explicit normalized-sheet fallback and never treats asset.profile as layout authority`; `recipes.js` | Pass |
| `background.mode` | `backgroundMode` | UI: auto/passthrough/flood/edge palette; conditional dual matte; requested alpha-cleanup blocked | `Character Workbench blocks requested alpha cleanup…`; dual-matte Preview/binding tests; full control matrix | Pass |
| `background.tolerance` | `backgroundTolerance` | Integer 0–80, default 24 | `Character Workbench blocks background tolerance 81…`; `processSheetBuffer records tuning controls…`; full control matrix | Pass |
| Managed matte artifact | `blackSourceBuffer` | Server resolves a Buffer; never derived in browser/Recipe mapper | `dual matte mapping requires a separately resolved managed black matte buffer`; managed Preview test | Pass |
| `cleanup.component_cleanup` | `componentCleanup` | Boolean, default true | Full control matrix; `processSheetBuffer removes tiny detached components…`; `recipes.js` | Pass |
| `cleanup.min_alpha` | `cleanupMinAlpha` | Integer 0–80, default 18 | `Character Workbench blocks minimum alpha 81…`; full control matrix | Pass |
| `cleanup.min_area` | `componentCleanupMinArea` | Integer 1–64, default 4 | `Character Workbench blocks minimum area 65…`; full control matrix | Pass |
| `cleanup.min_area_ratio` | `componentCleanupMinAreaRatio` | Number 0–0.25, default 0 | `Character Workbench blocks minimum area ratio 0.251…`; full control matrix | Pass |
| Canonical disabled object | `fixedRegionSourceStaging` plus tuning fields | Forced `off`; tuning fields null; provenance displayed read-only | `Character Workbench blocks enabled fixed-region staging…`; Recipe view-model provenance test | Pass |
| `grid.manual_overrides` | `manualOverrides` | Manual cuts only for compatible uniform grids | Full control matrix; `processSheetBuffer applies manual frame nudges and locks selected motion groups`; overlay fixed-region truth test | Pass |
| `anchor_offset` | `anchorOffset` | Integer x/y −16…16, default 0/0 | `Character Workbench blocks anchor x outside Workbench range`; `processSheetBuffer records tuning controls…`; full control matrix | Pass |
| `frame_adjustments` | `frameAdjustments` | Valid frame keys; integer dx/dy −16…16 | Full control matrix; `processSheetBuffer applies manual frame nudges and locks selected motion groups` | Pass |
| `locked_animations` | `lockedAnimations` | Unique ids in profile order | Same manual-nudge/locked-motion pipeline test; full control matrix | Pass |
| `correction.auto_correct` | `autoCorrect` | Boolean, default true | Full control matrix; `recipes.js` mapping | Pass |
| `correction.motion_stabilize` | `motionStabilize` | Boolean, default true | Full control matrix; real stabilization binding test | Pass |
| `correction.motion_max_shift` | `motionStabilizationMaxShift` | Integer 0–4, default 2 | `Workbench Recipe motion shift controls real character-sheet stabilization`; range blocker test | Pass |
| `pixel_finishing.enabled` | `pixelFinishing` | Boolean, default false | Full control matrix; `Workbench style budgets remain pipeline-effective…` | Pass |
| `pixel_finishing.max_colors` | `pixelFinishingMaxColors` | Integer 1–256, default 16; active with finishing | Style-budget pipeline test; full control matrix | Pass |
| `pixel_finishing.outline` | `pixelFinishingOutline` | Boolean; active with finishing | Full control matrix; disabled-event guard test | Pass |
| `pixel_finishing.outline_mode` | `pixelFinishingOutlineMode` | outer/inner/both/none; active with finishing and outline | Full control matrix; disabled-event guard test | Pass |
| Fixed default | `pixelFinishingOutlineColor` | `[24,24,32]`, no v1 control | Core binding test; `recipes.js` | Pass |
| `style_report.enabled` | `styleReport` | Forced true, read-only | `Character Workbench blocks style report off…`; Recipe view-model provenance test | Pass |
| `style_report.max_colors` | `styleMaxColors` | Integer 1–256, default 16 | `Workbench style budgets remain pipeline-effective across finishing and report-only modes`; full control matrix | Pass |
| `outputs.frame_sizes` | `outputFrameSizes` | Exact `[96,64,48,32,16]`, read-only | Core binding test; `Character Workbench blocks non-canonical output sizes…` | Pass |
| Fixed default | `matteResidueCleanup`, `matteResidueTolerance`, `matteResiduePasses` | `true`, `40`, `2`; no v1 control | Core binding test; `recipes.js` | Pass |
| Fixed default | `edgeDecontamination`, `edgeDecontaminationMaxDistance`, `edgeDecontaminationStrength` | `true`, `112`, `0.55`; no v1 control | Core binding test; `recipes.js` | Pass |
| Fixed default | `sourcePreprocess` | `true`; no v1 control | Core binding test; `recipes.js` | Pass |
| No Recipe field | `promptText` | Never supplied | Core binding test and managed Preview test assert `undefined` | Pass |
| Unsupported style enforcement | none | No control and no silent option | `Repair workbench source exposes the complete honest surface and no forbidden active capability` | Pass |
| Unsupported Pixel Grid Refinement | none | Disabled and labelled unavailable | Same honest-surface test; browser Recipe inspection | Pass |

## Browser Matrix

Screenshot files are ignored local Playwright evidence and are intentionally not
staged.

| Viewport | Screenshot(s) | Overflow | Console | Notes |
| --- | --- | --- | --- | --- |
| 1440×900 | `.playwright-cli/page-2026-07-11T05-10-11-552Z.png` | Document 1440/1440 × 900/900; no page overflow. Recipe internal scroll only. | No product error before instrumentation. One later `setPointerCapture` error came from a manually synthesized PointerEvent, not a real pointer path. | Workbench y=123, h=777, bottom=900; Canvas CSS/backing 1100×280; Recipe 340 px; focus ring `2px solid rgb(117,240,211)`. |
| 2048×963 | `.playwright-cli/page-2026-07-11T05-11-07-993Z.png` | Document 2048/2048 × 963/963; no page overflow. | Same instrumentation session as 1440; no new product error. | Canvas CSS/backing 1708×323; computed sprite viewport 288×288 centered at x=710/y=18; Recipe stays 340 px. |
| 390×844 | Closed `.playwright-cli/page-2026-07-11T05-11-38-376Z.png`; open `.playwright-cli/page-2026-07-11T05-15-01-776Z.png` | 390/390 horizontal; vertical document scroll to 1065 is expected. Drawer and backdrop have no horizontal overflow. | Fresh post-fix session: 0 errors, 0 warnings. | Canvas 390×280 above filmstrip. Drawer x=31.203, width=358.797, right=390; backdrop rect 390×844 and receives the outside hit. Shift+Tab from Close lands on visible collapsed `SUMMARY` “AI Action Repair”; backdrop/Escape close and return focus to Recipe. |

Reduced-motion rules are present and covered by the CSS structure test. The
mobile layout remains readable but precise Canvas edits are best performed with
a hardware pointer.

## Network And Mutation Evidence

Fixture: `repair_visual_1783744573551`, active asset
`asset_character_pack_job_mrfvgorj_y2oyrj`.

| Action | POST count/routes | Project revision | Asset revision | History | Observed state |
| --- | --- | --- | --- | --- | --- |
| Load/open Repair | 0 POST; project GET plus seven controlled managed-artifact GETs | 3 | `rev_002` | past 0 / future 0 | Project dirty false; `no_preview`. |
| Edit tolerance 24→25, anchor x 0→1, grid Auto→Manual, X1→190 | 0 POST | 3 | `rev_002` | 0 / 0 | Project dirty false; local draft `dirty`; draft hash refreshed. |
| Zoom/pan/modes/overlays/frame selection | 0 POST | 3 | `rev_002` | 0 / 0 | View-only state; no project mutation. |
| Build Preview once | 1 POST `…/reprocess` → 202; four job polls; seven generated-evidence GETs | 3 | `rev_002` | 0 / 0 | Job `job_mrfwntf6_zcyua8`; state `ready`; exact evidence inspectable. |
| Difference and frame 2 review | 0 additional POST or fetch | 3 | `rev_002` | 0 / 0 | Cached decode/draw path. |
| Accept exact job once | 1 POST `…/reprocess/job_mrfwntf6_zcyua8/accept` → 200; no general import | 4 | `rev_003` | 0 / 0 | One immutable child revision; reopened state `no_preview`. |
| Fresh mobile verification | 0 POST; GET-only | 4 | `rev_003` | 0 / 0 | Drawer/a11y inspection only; console clean. |

Renderer instrumentation test
`renderer caches viewport inputs outside RAF and keeps all I/O, decode, and
layout work out of draw` confirms no fetch, image decode, or DOM layout read in
the draw/RAF path. Filmstrip-only renders also keep Recipe and quality DOM
stable.

## Verification Commands

| Command | Result/count |
| --- | --- |
| `npm run test:focused -- test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorRepairWorkbenchController.test.js test/editor-project/editorRepairPreviewLifecycle.test.js test/editor-project/editorShellStructure.test.js test/localSmokeScript.test.js` | 87/87 pass; 3.62 s; peak process-tree RSS 762,320 KiB. |
| `npm run test:focused -- test/editor-project/*.test.js test/character-pack/processSheet.test.js test/character-pack/motionStabilizer.test.js` | 431/431 pass; 25.07 s; peak RSS 669,600 KiB. |
| `npm test` | 925/925 pass; 104.83 s; peak RSS 3,295,968 KiB; protected by 4 GiB process-tree and 2 GiB V8 limits. |
| `npm run smoke:local -- --base-url http://localhost:4173` | Pass: tabs markup, editor shell, Repair module/API markers, AI provider state, 267-byte GIF API, scene/project/2.5D APIs; peak RSS 104,128 KiB. |
| Browser-control matrix | Pass at 1440×900, 2048×963, and 390×844; fresh final session 0 console messages. |
| `git diff --check` | Pass before the Task 11 commit and again in the final baseline audit. |

## Final Static Audit

| Audit | Observed result |
| --- | --- |
| `git status --short` immediately after the verified UI commit | Clean. |
| `git diff --name-only b17080e...HEAD` | Workbench plan files plus the branch plan/worktree-ignore commits and synchronized main resource-guard files. No unrelated user artifact was staged. |
| `git diff --name-only b17080e...HEAD -- src/character-pack` | No output. |
| Unfinished/mock marker search over `src/editor-project`, `src/ui/editor`, and this runbook | 0 matches. |
| Restricted product/naming search over the same paths | 0 matches. |
| `apiKey`, `api_key`, provider-key env name, raw source base64, and `promptText` search in the reprocess service/coordinator and Repair UI | 0 matches. There are no preserved exceptions to enumerate in this boundary. |
| `package.json`/lockfile/attribution audit | `package.json` changed only because main's resource-guard scripts were synchronized; dependency blocks, lockfiles, and `ATTRIBUTIONS.md` are unchanged. |
| Local code review | No actionable correctness, security, accessibility, or contract defect remained after the backdrop and collapsed-details focus regressions were fixed and tested. |

The baseline diff includes main commits `7e6e1e6` and `f141c0a`, merged by
`efd63ec`, which add the approved process resource rules/guard to `AGENTS.md`,
`README.md`, `package.json`, `scripts/run-with-resource-guard.mjs`, and
`test/resourceGuard.test.js`. Those synchronized changes are not Workbench
scope expansion and add no package dependency.

## Protected Boundaries And Residual Risks

- Protected Character Pack processing files changed: No. The final baseline
  audit returned no path under `src/character-pack/`.
- Existing provider, validator, exporter, profile, job status, old `/`, and
  project-pack contracts were not modified by this UI closeout.
- No external code/UI/assets were copied; no runtime or development dependency
  was added.
- Browser warning/fail fixtures were not deliberately generated in this pass,
  because doing so would require extra fixture mutation. Exact warning,
  quality-fail, failed-post-processing, confirmation, and conflict behavior is
  covered by API/controller/state tests; the pass path was verified end to end.
- Previous revision/generated files were not manually byte-hashed before and
  after the browser acceptance. Specialized Accept tests verify sealed evidence,
  exclusive immutable child creation, and preservation on failure; browser
  evidence confirmed the parent remained accessible as `rev_002` while the
  child became `rev_003`.
- The artificial desktop pan probe used a synthetic PointerEvent without a real
  active pointer and produced one `setPointerCapture` console error. A fresh
  normal-interaction session subsequently produced 0 errors and 0 warnings.
- Independent CI was not run. Independent subagent review was not requested;
  governing collaboration rules prohibit spawning one without explicit user
  authorization, so final review is local and evidence-based.
- Screenshot files and the local browser fixture are ignored evidence and must
  not be staged. No `output/` or unrelated generated directory was scanned.
