# Studio UX Optimization Controlled Implementation Plan

Status: approved implementation plan
Date: 2026-08-13
Scope owner: Studio maintained UI
Design authority: Figma Section 995:5125, 00 · UX Optimization · Draft v4 · 2026-08-13 · Authoritative candidate

## 1. Objective

Improve the maintained Studio from an end-user perspective without expanding product capability or changing any server contract.

The implementation must:

1. Preserve all eight maintained Studio pages, routes, and real workflows.
2. Remove only controls that are disabled placeholders, have no maintained binding, or describe a future capability as though it belongs in the current workflow.
3. Make the primary user task, current state, recovery action, verified result, and download eligibility easier to understand.
4. Keep capability truth visible while moving protocol-heavy evidence into progressive disclosure.
5. Complete the existing Action and Sequence user loops using current repository capabilities.
6. Reduce QA and Tiles AI visual priority without deleting their real workflows or deep links.
7. Present Settings as one active service-session Provider route, not multiple simultaneously active configurations.

This plan does not authorize a new feature, API, Job type, storage model, provider call, export format, project capability, or server pipeline.

## 2. Design authority and node ledger

### 2.1 Optimization Section

The following twelve Figma frames are the implementation source of truth for the states changed by this plan:

| Order | Node ID | Frame name | Implementation responsibility |
| --- | --- | --- | --- |
| 01 | 996:5125 | Character Entry | Character entry hierarchy, real modes, removal of search noise, user-facing result terminology |
| 02 | 996:5274 | Character Compatibility | Compatible generation hierarchy, verified result/download language, progressive technical evidence |
| 03 | 996:6266 | Action Recoverable failure | Terminal failure explanation and explicit start-new-operation recovery |
| 04 | 996:6696 | Action Verified result | Applied state, current binding, and primary verified download |
| 05 | 997:5257 | Sequence Input ready | Ordered input list with move-up, move-down, and remove actions |
| 06 | 997:5491 | Tiles Local workspace | Deterministic local Tiles workflow as the primary path |
| 07 | 997:6498 | Tiles Provider material evaluation | Real Tiles AI workflow demoted to advanced Provider material evaluation |
| 08 | 997:6627 | Scene Entry | Scene entry hierarchy and capability-truthful user wording |
| 09 | 998:5286 | Scene Context recovery | Existing Scene recovery behavior and current-result binding |
| 10 | 998:5408 | Project Compose | Composition of existing verified inputs without implying generation |
| 11 | 998:5548 | Settings Session route | One current service-session Provider route and route-switching configuration |
| 12 | 998:5719 | Preflight checklist | Cross-module implementation and acceptance checklist |

Implementation screenshots must be compared against the exact frame for the relevant route and state. Archive material may explain history but is not an implementation source.

### 2.2 Preserved canonical Sections

The optimization Section supplements and does not replace, rename, move, archive, or delete these canonical Figma Sections:

- 700:3836
- 726:4445
- 726:4446
- 726:4447
- 726:4448
- 726:4450
- 749:4445
- 955:4572

Unchanged states continue to use their canonical Current frames. When an optimization frame and an unchanged canonical frame meet, the optimization frame governs only the explicitly changed hierarchy, copy, or interaction described in this plan.

## 3. Scope boundary

### 3.1 In scope

- Studio rail hierarchy and visual priority.
- Removal of approved fake or unbound controls.
- User-facing terminology for verified results and downloads.
- Native progressive disclosure for protocol-heavy details.
- Action terminal recovery and Applied-state primary download.
- Sequence input reordering and removal using the existing selected-file workflow.
- QA, Tiles AI, and Settings information architecture.
- Focused UI state, accessibility, localization, and regression tests needed for these changes.
- Documentation and design-to-implementation evidence for the approved frames.

### 3.2 Out of scope

- Any server route, endpoint, request, response, or artifact protocol change.
- Any new Provider, Provider retry, fallback, call, connection-test action, or call-budget behavior.
- Any new Job type, status, phase, persistence, cancellation, or recent-Job list.
- Any new export, engine integration, Project input, auto-accept action, or automatic QA decision.
- Any replacement of the maintained local, Strict, compatible, Tiles, Scene, or Project pipelines.
- Any global navigation redesign beyond the approved eight-route hierarchy.
- Project feature expansion.
- Editor Workspace changes.

## 4. Preserved pages, routes, and real capabilities

All eight routes remain legal, directly reachable Studio destinations. Unknown Studio hashes continue to use the existing safe Character fallback.

| Route | Page | Real capability that must remain reachable |
| --- | --- | --- |
| #character | Character | Standard and advanced local sheet processing; fixed-region Strict Review, Confirm, one-call Job observation, evidence review, and human Accept; compatible generation with bounded Provider calls and diagnostics; prompt helper; current-input, quality, artifact, download, and Project-candidate gates |
| #action | Action | Import and process maintained local motion sources and existing strips; inspect analysis; apply an accepted result; preserve current operation authority and recovery; download the verified Applied result |
| #sequence | Sequence | Import multiple local images; establish an explicit frame order; generate Sheet, JSON, GIF, and ZIP from that order; retain partial, failed, stale, and current-binding behavior |
| #tiles | Tiles | Deterministic local corner-grid editing and verified Tiles outputs; advanced native-Gemini Provider material evaluation with zero-call Plan, explicit budget confirmation, same-Job observation, report, diagnostics, and evidence |
| #scene | Scene | Maintained local image flow, maintained online generation flow, prompt helper, quality and artifact gates, current-context recovery, verified downloads, and current Project eligibility |
| #project | Project | Compose only the existing verified inputs accepted by the maintained Project contract; validate and download the current Project result; never imply that Project generates Character, Scene, or Provider work |
| #qa | QA | Five native, operator-controlled, page-session-only manual checks; no Job read, API call, persistence, automatic verdict, download unlock, or Project mutation |
| #settings | Settings | Global language preference, one active service-session Provider route, Gemini and advanced route configuration for their real consumers, secret-handling boundaries, and read-only local tool status |

Moving a route in the rail, lowering its visual weight, or changing its label must not remove its hash route, view, initialization, language rendering, title, file-preview routing, or legacy redirect destination.

## 5. Approved implementation requirements

### 5.1 Unified eight-route information architecture

- Keep Character, Action, Sequence, Tiles, Scene, Project, QA, and Settings.
- Keep the current primary production sequence: Character → Action → Sequence → Tiles → Scene → Project.
- Move QA after the rail spacer into the utility area and give it secondary visual weight.
- Keep Settings in the utility area.
- Preserve #qa as a direct route and preserve the fixed legacy QA redirect.
- Do not turn QA into a modal, remove it from the router, or merge its state into another page.
- Do not add a ninth route or a new global dashboard.

### 5.2 Remove only fake entry points and unbound noise

Remove the following approved items from Current UI and the corresponding unused copy, style, and obsolete existence assertions:

- Disabled search controls that do not search maintained data.
- Action future-AI entry.
- Sequence future-AI entry.
- Action controls with no maintained behavior: the disabled Details action, disabled WASD playtest, and disabled Character-page export shortcut.
- Future export cards that have no current artifact or download binding.

Removal means removal from the current product surface, not replacement with another inactive control.

The following are not placeholders and must not be removed:

- Empty, loading, processing, review, failure, partial, stale, complete, and recovery states backed by real state machines.
- Locked download controls that explain a real gate.
- Current-input, Job, evidence, quality, call-budget, and artifact-binding status.
- Strict Topdown capability-truth messaging unless a separate approved change explicitly changes it.
- File-mode service warning.
- Real input placeholders and validation messages.
- Prompt helpers and their generate, copy, reset, open, and close paths.

No additional control may be removed merely because it appears technical or is used infrequently. It must first be proven unbound or future-only and added to the deviation record with approval.

### 5.3 User terminology and technical detail boundary

User-facing primary copy must use task language:

- Processing or generating
- Review
- Strict-only human Accept
- Verified
- Available to download
- Available for Project

Primary user copy must not describe a local or server artifact as publicly published. In Chinese, 发布 in user-facing status, headings, help, and buttons becomes the appropriate form of 已验证、可下载、下载已锁定、可用于 Project, or 接受并生成已验证下载 according to the actual state. English uses verified, download available, download locked, or eligible for Project.

Protocol names remain unchanged and may be shown inside technical disclosure when useful. This includes release, publication, acceptance, Job, artifact, Profile, Hash, route kind, and machine status values.

The following information must remain immediately visible and must not be hidden inside a closed disclosure:

- Current workflow and stage.
- Whether work is running, complete, failed, partial, stale, or interrupted.
- Human action required next.
- Original failure reason in understandable language.
- Whether the visible result still matches current input.
- Quality pass/fail and download eligibility.
- Planned, maximum, and used Provider calls when a Provider workflow is involved.
- Download lock reason.
- Same-Job resume/continue-observing action.
- Warning that pausing observation does not cancel a server Job where applicable.

The following may move into native progressive disclosure, provided verification and state updates continue while it is closed:

- Job and publication identifiers.
- Profile, route kind, model binding, and sealed configuration.
- Plan, input, source, and artifact hashes.
- Raw machine phase and status values already represented in user language.
- Full artifact/evidence ledgers and exact artifact URLs.
- Candidate IDs, failure taxonomy, diagnostic matrices, and validation subreports.
- Detailed capability-boundary and implementation notes that repeat a visible summary.

Prefer native details and summary elements. Do not add a new disclosure controller when native semantics are sufficient.

### 5.4 Settings: one current service-session Provider route

Settings must show one prominent current-session route summary containing only information the existing provider state can truthfully disclose:

- Current Provider and model when disclosed.
- Configuration source: current service session, local environment, or not configured.
- Which maintained workflows can use the active route.
- The fact that configured does not mean a live connection has been tested.

Gemini and Advanced Provider forms configure the same single active service-session slot:

- Saving Gemini switches the slot to native Gemini for Character Strict and Tiles AI.
- Saving OpenRouter or compatible Base URL switches the slot to the shared advanced route for compatible Character and Scene online generation.
- The UI must not present both as concurrently active.
- Switching routes must explain the affected workflows before save.
- Clearing applies only to the currently applicable runtime configuration and retains existing safe control-state rules.
- API Key inputs remain write-only, clear after the existing save boundary, never echo, and never enter browser preference or project JSON storage.
- When the server does not disclose whether a current advanced route is OpenRouter or compatible Base URL, show a neutral undisclosed-route message and require the operator to choose again before saving. Do not guess the route or Base URL.

Do not add a Test connection button. There is no approved no-call verification contract for it.

### 5.5 Tiles: local primary, Provider evaluation advanced

The deterministic local Tiles workflow remains the default and primary path.

The existing Tiles AI workflow remains real and reachable, but its entry and copy must identify it as:

Advanced · Provider material evaluation

It evaluates Provider-generated raw material candidates. It does not generate the final strict atlas, automatically replace the local material source, or automatically write back to the local map.

The following Tiles AI behavior is protected:

- Native Gemini eligibility and selected preset/model truth.
- Material description and bounded candidate count.
- Candidate count equals maximum Provider calls.
- Zero-call Plan before live execution.
- Explicit human confirmation of the exact maximum-call budget.
- One live Run for the sealed Plan.
- Same-Job polling and resume after observation interruption.
- Fail-closed handling when submission outcome is unknown.
- No automatic retry, fallback, added call, duplicate submission, or Cancel claim.
- Terminal failure reason, retry hint, and authoritative used-call count.
- Plan, report, and notes evidence.
- Review conclusion and the statement that the result is not automatically applied to local Tiles.

Demotion is an information-architecture change only. It must not delete the AI state machine, endpoints, evidence validation, or test coverage.

### 5.6 QA: utility-level manual memo

QA remains a five-item manual checklist at #qa.

Its Current UI must state concisely that:

- It is a page-session manual memo.
- It does not bind a Job or asset.
- It reads no quality report or result.
- It makes no API or Provider call.
- Reloading clears its checks.
- Completing all five items does not verify a result, unlock a download, or change Project state.

Remove the Unity-specific implication from the target-runtime check. Use neutral target-runtime wording while preserving the fifth manual check and the total count of five.

Collapse repeated technical boundary and interaction explanations into one progressive disclosure. Keep the manual/non-automatic truth and page-session count visible.

QA state must remain in memory only. Do not add localStorage, sessionStorage, IndexedDB, server storage, export, pass-project, or accept behavior.

### 5.7 Action and Sequence completion loops

#### Action

Terminal failures must provide an explicit start-new-operation action after presenting the current failure authority and reason.

- Starting a new operation is a deliberate reset to the existing input workflow.
- It must not silently retry, resume, duplicate, or overwrite the failed operation.
- Same-operation recovery remains available only where the current maintained contract already supports it.
- Any existing authoritative failure receipt remains visible until the operator chooses the new-operation action.

The Applied terminal state must expose the verified current result as its primary download action.

- The download must use the artifact already bound to the current Applied result.
- It must remain locked when the result is not current or verified.
- It must not route the user to a retired workspace or future Character export.

#### Sequence

The Input-ready state must give every selected frame explicit move-up, move-down, and remove controls.

- Initial ordering may continue to use the maintained natural filename order.
- The displayed order becomes the authoritative selected order for the next generation.
- The same order must feed Sheet placement, index JSON, GIF frame order, and ZIP contents/metadata wherever the current contract includes them.
- Removing a frame removes it from every generated representation.
- Reordering or removing after a result exists immediately makes that result stale and locks old downloads.
- A new generation must bind the exact current ordered frame list and current options.
- Inputs remain locked while the current generation lifecycle requires them to be locked.
- Existing partial success remains truthful: locally valid outputs may remain available only when the maintained contract already permits them.

Do not add drag-and-drop ordering if the approved frame specifies explicit buttons. Do not change the GIF endpoint or introduce a new sequence persistence model.

## 6. Protected implementation contracts

### 6.1 APIs and machine fields

No existing endpoint, HTTP method, request body, response body, redirect, Job receipt, artifact URL, or polling protocol may change for this UX plan.

In particular, preserve all current contracts around:

- Process-sheet, Character generation, Strict Review/Accept, Provider config, Gemini state, Tiles local build and material-source benchmark, Scene, Project, GIF, and Job polling endpoints.
- Fixed legacy-to-Studio redirect whitelist, including QA.
- Same-Job observation and resume semantics.
- Current-input and exact artifact URL binding.
- Quality and evidence gates.
- Provider-call ceilings and no-retry/no-fallback rules.
- Character accepted-publication query and restoration behavior.

The following machine names are examples of protected values and are not user-copy cleanup targets:

- release_ready
- artifact_disposition=release
- publication and publication_id
- acceptance_id
- generation_release_gate_url
- provider_call_budget
- planned_provider_calls
- max_provider_calls
- used_provider_calls
- Current Job status and phase enum values
- Existing generated artifact filenames

Internal function, state, and phase names may continue to use release or publication. Do not perform a mechanical code rename merely to change visible language.

### 6.2 Capability and safety

- Do not make a designed control active unless a maintained capability exists.
- Do not present a future or mock state as real.
- Do not create a fake recent list, search result, Provider check, progress estimate, download, candidate, or Project input.
- Do not grant compatible diagnostics Strict Accept behavior.
- Do not enable Strict Topdown without the authoritative Structure contract.
- Do not add cancellation where the server exposes none.
- Do not run real Provider calls during implementation or verification.
- Do not read, modify, or stage generated/job_mso2thdv_qsfx95 or generated/accepted_v1_job_mso2thdv_qsfx95.
- Do not stage untracked node_modules.

### 6.3 Language

This plan does not authorize a fabricated global language entry.

- Language remains reachable from the maintained module surfaces and Settings as currently supported.
- Chinese and English must remain synchronized through the maintained language state.
- Every new or changed user-facing string must exist in both languages.
- Protocol tokens may remain in English when they are exact technical values inside disclosure.

## 7. Implementation sequence and gates

### Phase 0: Design gate and baseline inventory

1. Reconfirm the twelve optimization frames, their order, names, prototype destinations, and screenshots.
2. Reconfirm that all eight canonical Sections remain present.
3. Map each changed DOM region to one optimization frame.
4. Record any unavoidable design deviation before changing HTML.
5. Confirm the current branch/worktree and protect unrelated changes and generated directories.

Gate: every intended Current UI change maps to an approved frame or an explicit approved deviation; no server or API change is required.

### Phase 1: Navigation, fake-entry removal, and shared copy hierarchy

1. Move QA to the rail utility group without changing #qa.
2. Remove only the approved fake/unbound controls.
3. Apply the verified/download/Project-eligibility user terminology.
4. Add native progressive disclosure while keeping the protected always-visible truth.
5. Remove only copy keys, selectors, and tests made obsolete by those exact removals.

Gate: all eight routes remain directly reachable; no remaining control appears actionable without a real binding; no real state or capability has disappeared.

### Phase 2: Action and Sequence completion

1. Implement Action explicit new-operation recovery for terminal failures.
2. Make the current verified Applied artifact the Action primary download.
3. Add Sequence move-up, move-down, and remove controls.
4. Bind the current explicit order through every maintained Sequence output.
5. Revoke old Sequence results and lock downloads after any order change.

Gate: focused state and integration tests prove Action does not duplicate failed work and Sequence output order exactly matches the displayed current input order.

### Phase 3: Settings, Tiles, and QA information architecture

1. Add the single current-session Provider route summary.
2. Reframe Gemini and Advanced Provider forms as switching the same route.
3. Make undisclosed advanced route state neutral and truthful.
4. Keep local Tiles primary and move Provider material evaluation to the approved advanced hierarchy.
5. Simplify QA to a utility-level manual memo, retain five checks, and remove the Unity implication.

Gate: Settings never shows two active routes; Tiles AI retains its complete real lifecycle; QA remains session-only with no service or release side effect.

### Phase 4: Cross-module verification and review

1. Run only the smallest focused guarded tests first.
2. Run broader guarded Studio regression only after focused tests pass.
3. Perform real-browser visual verification against all twelve Figma frames.
4. Verify all eight routes at 1920×1080 and 390px width.
5. Verify Chinese and English, keyboard navigation, visible focus, ARIA names/states, dialog/disclosure focus, overflow, and console cleanliness.
6. Verify capability truth and user terminology in every initial, running, recovery, failure, stale, review, verified, and locked state in scope.
7. Obtain an independent read-only review of UI, state, API-contract, and capability-truth changes.
8. Review the path-limited diff, git diff --check, and staged file list before one semantic UX commit.

Gate: every completion condition in Section 9 has current evidence, with all deviations recorded.

## 8. Verification plan

All tests, builds, servers, and browser runs must use the repository resource guard with one designated runner and serial execution. Do not run raw Node tests or overlapping browser/build processes.

### 8.1 Focused automated coverage

- Router and rail: eight legal routes, QA utility placement, safe fallback, and legacy QA redirect.
- Fake-entry removal: removed controls and obsolete strings are absent; protected controls and states remain.
- Character/Scene/Project copy: user terminology changes do not alter release/publication machine bindings.
- Progressive disclosure: summary semantics, keyboard operation, and continued state updates while closed.
- Action: terminal receipt remains authoritative, new-operation reset is explicit, no duplicate/retry side effect, Applied download uses only the current verified artifact.
- Sequence: initial order, move-up/down boundaries, removal, exact ordered request/input binding, output order across Sheet/JSON/GIF/ZIP, stale invalidation, and locked prior downloads.
- Settings: one current route, Gemini/advanced replacement behavior, undisclosed-route neutrality, affected-workflow copy, Key clearing, no echo, and no browser secret storage.
- Tiles: local default, advanced entry, zero-call Plan, candidate/max-call equality, budget confirmation, one live Run contract, same-Job resume, submission-unknown fail-close, failure diagnostics, and retained evidence links.
- QA: exactly five checks, session-only state, no API/storage, no automated pass, no download or Project mutation, and neutral target-runtime wording.
- Localization: every changed marker resolves in Chinese and English.

No automated verification may make a real Provider call.

### 8.2 Browser and visual coverage

For every applicable optimization frame:

- Capture 1920×1080 and 390px screenshots from the real maintained Studio.
- Compare layout, ordering, spacing, copy, visibility, control type, state, and recovery path with the exact Figma frame.
- Exercise the prototype path, not only the static frame.
- Check horizontal and vertical overflow.
- Check that the primary action remains visible and unambiguous.
- Check that technical disclosures do not hide required task truth.
- Check keyboard-only operation and focus return.
- Check the browser console after each changed route.

### 8.3 Final guarded regression

After focused verification passes, run the guarded repository-prescribed Studio regression and the smallest required full acceptance commands. The final evidence must include:

- Guarded focused tests.
- Guarded full test suite if required by the repository completion gate.
- Guarded local smoke if required by the repository completion gate.
- git diff --check.
- Independent read-only review outcome.
- Exact skipped checks and residual risk, if any.

## 9. Completion conditions

The plan is complete only when all of the following are true:

1. All eight pages and hash routes remain reachable and correctly titled.
2. QA appears in the utility area and #qa plus its legacy redirect remain valid.
3. Only the approved fake/unbound controls have been removed.
4. No real page, state, recovery, quality gate, evidence gate, download gate, or Project eligibility rule has been removed or weakened.
5. User-facing primary copy no longer describes verified local/server downloads as public publication.
6. Protected release/publication machine fields, query parameters, API shapes, and Job enums are unchanged.
7. Technical detail is progressively disclosed while stage, failure, binding, quality, budget, download lock, and same-Job recovery remain visible.
8. Settings shows exactly one current service-session Provider route and truthfully explains route switching.
9. Tiles local remains primary and the complete real Provider material-evaluation workflow remains available as advanced functionality.
10. QA remains exactly five manual, memory-only checks and does not imply Unity-specific support or any automatic acceptance effect.
11. Action terminal failure offers an explicit new-operation path without duplicate submission; Applied exposes only the current verified download.
12. Sequence ordering controls are usable and the exact displayed order governs every maintained output; order changes make old results stale and lock old downloads.
13. Chinese and English are complete and consistent.
14. The real browser matches the twelve approved Figma frames at desktop and narrow widths, with recorded reasons for every deviation.
15. Focused and required regression verification passes under the resource guard.
16. An independent read-only review finds no unresolved high-risk issue.
17. Only task-owned files are staged; protected generated directories and untracked node_modules are absent from the commit.

Human acceptance remains a human gate and cannot be satisfied by an automated test or agent statement.

## 10. Approved deviation record

| ID | Approved deviation or clarification | Rationale | Status |
| --- | --- | --- | --- |
| D-01 | No server, API, Job enum, artifact protocol, or pipeline change is permitted for this optimization | The approved work is UI hierarchy, truthful copy, and completion of existing client workflows | Approved |
| D-02 | No new global language control is introduced | Language remains available through maintained module controls and Settings and must remain synchronized in Chinese and English | Approved |
| D-03 | QA moves to the utility area but retains #qa, its page, five checks, initialization, and legacy deep link | Lower visual priority must not be confused with capability retirement | Approved |
| D-04 | Tiles AI is relabeled and visually demoted to Advanced · Provider material evaluation but its complete real state machine remains | It evaluates raw material candidates and is not the primary deterministic Tiles construction path | Approved |
| D-05 | User copy replaces publication language with verified/download/Project-eligibility language; internal release/publication names remain | Prevents users from interpreting a local/server artifact as a public cloud publication without changing compatibility contracts | Approved |
| D-06 | The optimization draft Section governs only the twelve changed states; all eight canonical Sections remain | Prevents the UX pass from replacing accepted unchanged design history and Current frames | Approved |
| D-07 | Removal is limited to the enumerated disabled or unbound controls | Avoids accidental retirement of low-frequency but real capability | Approved |
| D-08 | Human acceptance for Character Entry replaces the obsolete search frame with the real prompt-helper entry, aligns the framed right-side controls at 28 px, and removes the internal profile ID plus decorative empty-stage artwork while preserving the real layout binding and actionable empty-state copy | The old search frame and the two removed elements were confusing visual or implementation detail, not a user action, capability, artifact, or protocol | Approved by human feedback on 2026-08-13; synchronized to Figma `996:5125` |

No unrecorded deviation is permitted. If implementation evidence requires a visual, content, interaction, state, capability, or workflow change beyond this table and Sections 3–5, stop that change, add a proposed deviation with its reason and impact, and obtain approval before implementation.

## 11. Delivery record template

Current evidence for this implementation:

- Implemented commits: the semantic Studio UX implementation and its final truth/layout closure; both hashes are recorded in the final handoff
- Figma nodes verified: all twelve nodes in Section 2.1; canonical Sections in Section 2.2 remain preserved; an exact 1920 × 1080 comparison against Character Compatibility node `996:5274` corrected the final desktop layout to a full-width topbar and compatibility-only workspace; human acceptance then synchronized Character Entry node `996:5125` so the obsolete search frame is the real 118 × 28 prompt-helper entry, the framed right-side controls share a 28 px height, and the internal profile-ID line plus decorative empty-stage artwork are absent
- Desktop screenshots: 12 real-browser 1920×1080 captures in `output/playwright/studio-ux-20260813`; Action recovery/Applied, Sequence ordered-input, Tiles Provider evaluation, and Scene recovery captures are explicitly named `visual-fixture` because they render controlled in-page state rather than a live Provider or Job result
- Narrow screenshots: 8 real-browser 390×1080 captures in the same directory, one for each maintained route
- Browser verification: passed under `guard:full`; 8 routes, 16 desktop/narrow overflow checks, 16 desktop/narrow Chinese/English switches, visible-control accessible-name checks, keyboard disclosure, zero console warnings/errors, and zero page errors; the affected-page rerun in `output/playwright/studio-ux-final-20260813` also proved Character Compatibility at 1920 × 1080 and 390 × 1080, Strict hidden/inert outside AI mode, no horizontal overflow, bilingual switching, default-closed native disclosure with Enter toggling and retained focus, and zero console warnings/errors; the final human-feedback rerun used real Chrome at 1920 × 1080 and 390 × 1080 and proved five 28 px desktop Character header controls with identical top coordinates, no internal profile ID, no decorative empty-stage node, preserved actionable empty-state copy, bilingual switching, no overflow, and zero console warnings/errors
- Focused tests: all affected guarded suites passed after the smallest stale-assertion updates; the final human-feedback run passed 29/29 Character, Advanced Local, and promotion tests, in addition to the earlier affected-module runs
- Full guarded regression: the final post-human-feedback `npm test` passed 1231/1231 (TAP duration 118.178 seconds; guard elapsed 118.229 seconds); peak process-tree RSS 814432 KiB across 5 processes
- Local smoke: the final post-human-feedback `npm run smoke:local` passed in 3.751 seconds; peak process-tree RSS 687440 KiB across 3 processes
- Independent read-only review: PASS; the initial implementation findings and both final human-feedback Figma mismatches were closed, and the last incremental review found no remaining P0/P1/P2, no deleted page or file, and no protected-path change
- Deviations beyond D-01–D-08: none approved
- Checks intentionally not run: real Provider calls, as prohibited by this plan
- Residual risks: human acceptance remains pending; controlled visual fixtures prove UI state projection and layout but are not represented as current Job or Provider artifacts
