# Studio UX Optimization Controlled Implementation Plan

Status: approved implementation plan
Date: 2026-08-13
Scope owner: Studio maintained UI
Design authority: Figma Section 995:5125, 00 · UX Optimization · Draft v4 · 2026-08-13 · Authoritative candidate

## 1. Objective

Improve the maintained Studio from an end-user perspective without expanding product capability or changing any server contract.

The implementation must:

1. Preserve all eight maintained Studio pages, routes, and real workflows. **D-45 restores** Current-UI reachability for Project after the brief D-44 hide.
2. Remove only controls that are disabled placeholders, have no maintained binding, or describe a future capability as though it belongs in the current workflow.
3. Make the primary user task, current state, recovery action, verified result, and download eligibility easier to understand.
4. Keep capability truth visible while moving protocol-heavy evidence into progressive disclosure.
5. Complete the existing Action and Sequence user loops using current repository capabilities.
6. Reduce QA visual priority without deleting its real workflow. **D-41 supersedes** the earlier Tiles AI “keep reachable in Current UI” line: Provider material evaluation is inventory only.
7. Present Settings as one active service-session Provider route, not multiple simultaneously active configurations.

This plan does not authorize a new feature, API, Job type, storage model, provider call, export format, project capability, or server pipeline.

## 2. Design authority and node ledger

### 2.1 Optimization Section

The following ledger is **10 Current/override frames plus 2 Archive evidence frames**. Do not treat all twelve rows as live Current implementation sources. Current/override comparison uses the 10 remaining frames; `996:5274` is pre-D-15 / superseded Character Compatibility evidence and `997:6498` is D-41 / superseded Tiles Provider-evaluation evidence. **D-45** restored `998:5408` as a Current Project frame after the brief D-44 hide.

| Order | Node ID | Frame name | Implementation responsibility |
| --- | --- | --- | --- |
| 01 | 996:5125 | Character Entry | Character entry hierarchy, real modes, removal of search noise, user-facing result terminology |
| 02 | 996:5274 | Archive / NOT Current · Character Compatibility | **Pre-D-15 / superseded evidence only.** Retired 2026-08-14 from Figma Current. D-15 retired it from Studio Current product UI. Do not implement and do not use it as a Current visual gate. Former Compat Config/Running/Diagnostic/Release frames `971:5301`, `971:6230`, `971:7159`, `971:8101` remain Archive only. |
| 03 | 996:6266 | Action Recoverable failure | Terminal failure explanation and explicit start-new-operation recovery |
| 04 | 996:6696 | Action Verified result | Applied state, current binding, and primary verified download |
| 05 | 997:5257 | Sequence Input ready | Ordered input list with move-up, move-down, and remove actions |
| 06 | 997:5491 | Tiles Local workspace | Deterministic local Tiles workflow as the primary path |
| 07 | 997:6498 | Archive / NOT Current · Tiles Provider material evaluation | **D-41 / superseded.** Hidden inventory. Do not implement as a Current Studio surface. |
| 08 | 997:6627 | Scene Entry | Scene entry hierarchy and capability-truthful user wording |
| 09 | 998:5286 | Scene Context recovery | Existing Scene recovery behavior and current-result binding |
| 10 | 998:5408 | Project Compose | Composition of existing verified inputs without implying generation. **D-45** restored this Current frame after the brief D-44 hide. |
| 11 | 998:5548 | Settings Session route | One current service-session Provider route and route-switching configuration |
| 12 | 998:5719 | Preflight checklist | Cross-module implementation and acceptance checklist |

**2026-08-14 Figma Current update:** Order 02 / `996:5274` is Archive / NOT
Current. Do not implement Character Compatibility from this plan.

**D-15 (2026-08-14) supersedes earlier Compatibility reachability:** Character
Compatibility is retired from Studio Current product UI, first-level mode,
runtime projection, and Project candidate aggregation. Historical execution
evidence that treated Compatibility as a Current surface is pre-D-15 /
superseded. API, CLI, and backend compatible generation remain; they are not
a Current Studio product path.

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

### 2.3 Human-accepted Strict Character refinement

Human feedback on 2026-08-13 adds a bounded refinement to the existing canonical Strict Character states. These six Current frames remain the state authority; no Archive frame is promoted:

| State | Canonical frame | Refined inner-node groups |
| --- | --- | --- |
| Review setup | 701:4864 | Prompt helper `1035:5248`–`1035:5249`; mode tabs `1036:5247`–`1036:5251`; text-only wait and process cards `1037:5230`–`1037:5251`; single-sentence status banner `701:5767`–`701:5769` |
| Confirm | 702:3936 | Shared-state prompt helpers `1040:5201`–`1040:5210`; text-only wait and process cards within `1041:5196`–`1041:5302`; single-sentence status banner `702:4839`–`702:4841` |
| Running | 709:4274 | Shared-state prompt helpers `1040:5201`–`1040:5210`; text-only wait and process cards within `1041:5196`–`1041:5302`; single-sentence status banner `709:5177`–`709:5179` |
| Review required | 704:4036 | Shared-state prompt helpers `1040:5201`–`1040:5210`; text-only process cards within `1041:5196`–`1041:5302`; single-sentence status banner `704:4939`–`704:4941` |
| Accepted | 706:4136 | Shared-state prompt helpers `1040:5201`–`1040:5210`; text-only process cards within `1041:5196`–`1041:5302`; single-sentence success banner `706:5038`–`706:5039` |
| Topdown blocked | 711:4369 | Shared-state prompt helpers `1040:5201`–`1040:5210`; text-only process cards within `1041:5196`–`1041:5302`; single-sentence status banner `711:5272`–`711:5274` |

The refinement removes setup-only internal Profile display, decorative or checkbox-like placeholders, and duplicated footer status. It preserves the real Strict contract, one-call budget, same-Job observation, evidence, human Accept, artifact binding, and Topdown capability block. Figma synchronization and maintained-UI implementation are complete. Focused guarded tests, bilingual responsive browser verification, and independent read-only review passed for this increment; final human acceptance remains the delivery gate.

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

All eight routes remain legal, directly reachable Studio destinations. **D-45** restored Project after the brief D-44 hide. Unknown Studio hashes continue to use the existing safe Character fallback.

| Route | Page | Real capability that must remain reachable |
| --- | --- | --- |
| #character | Character | Standard and advanced local sheet processing; fixed-region Strict Review, Confirm, one-call Job observation, evidence review, and human Accept; prompt helper; current-input, quality, artifact, download, and Project-candidate gates. **D-15:** Compatibility generation is no longer a Current Studio product path (pre-D-15 plan text that required it to remain reachable is superseded). **D-16:** Local failed/quality-blocked stage no longer hosts a second issue list; the right Quality Report disclosure is the only detailed report. **D-18:** Local import is one left column: source, current values, processing parameters, and a single start CTA. There is no Advanced-entry click and no second run button. **D-19:** That column is 300 px and compacted to fit a single desktop viewport. |
| #action | 动作取帧 / Frame Extraction | Import and process maintained local source media; inspect analysis; apply an accepted result; preserve current operation authority and recovery; download the verified Applied result. Source Set is inventory only after D-33. The left “当前流程 / 新建动作处理” explainer is inventory after D-39. |
| #sequence | Sequence | Import multiple local images; establish an explicit frame order; generate Sheet, JSON, GIF, and ZIP from that order; retain partial, failed, stale, and current-binding behavior. The left “当前流程 / 序列打包” explainer is inventory after D-34. |
| #tiles | Tiles | Deterministic local corner-grid editing and verified Tiles outputs. Provider material evaluation is inventory only after D-41. The left “当前流程 / 确定性图块构建” explainer is inventory after D-35. The local “构建绑定” status card is inventory after D-40. |
| #scene | Scene | Maintained local image flow; online generation only through a native Gemini gate; operator-chosen 1–8 generations after D-42; prompt helper, quality and artifact gates, current-context recovery, verified downloads, and current Project eligibility. The left “当前任务 / 主路径” explainer, step pills, and “能力边界” callout are inventory after D-36 / D-37. |
| #project | Project | Compose only the existing verified inputs accepted by the maintained Project contract; validate and download the current Project result; never imply that Project generates Character, Scene, or Provider work. The left “当前任务 / 合成” explainer and “能力边界” callout are inventory after D-38. **D-45** restored Current reachability after the brief D-44 hide. |
| #qa | QA | Five native, operator-controlled, page-session-only manual checks; no Job read, API call, persistence, automatic verdict, download unlock, or Project mutation |
| #settings | Settings | Global language preference; Gemini as the only generation-ready Provider; other Provider configuration may be saved as a service-session replacement but is not connected to current Studio generation. **D-15 supersedes** pre-D-15 text that saving an advanced Provider would become the Compat/Scene active generation route. |

Moving a route in the rail, lowering its visual weight, or changing its label must not remove its hash route, view, initialization, language rendering, title, file-preview routing, or legacy redirect destination.

## 5. Approved implementation requirements

### 5.1 Unified eight-route information architecture

- Keep Character, Action, Sequence, Tiles, Scene, Project, QA, and Settings.
- Keep the current primary production sequence: Character → Action → Sequence → Tiles → Scene → Project.
- **D-45** restored Project as a Current rail destination after the brief D-44 hide.
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
- Whether current Studio generation can use an eligible native Gemini preset from the full preset list, not only the top-level active Provider.
- The fact that configured does not mean a live connection has been tested.

**D-15 current rule:** Gemini and other-Provider forms still write the same unchanged `/api/provider-config` service-session slot. Other Providers are not connected to current Studio generation. Character Strict, Scene online generation, and Tiles Provider paths accept only a selected native Gemini preset.

Pre-D-15 / superseded wording that treated OpenRouter or compatible Base URL as the Compat Character or Scene generation route, or as switching the active Studio generation route, must not be read as current:

- ~~Saving Gemini switches the slot to native Gemini for Character Strict and Tiles AI.~~ Saving Gemini still replaces the service-session configuration; current Studio generation uses an eligible native Gemini preset.
- ~~Saving OpenRouter or compatible Base URL switches the slot to the shared advanced route for compatible Character and Scene online generation.~~ Saving them replaces the service-session configuration only. They do not become the current Studio generation route.
- The UI must not present two service-session routes as concurrently active. An active OpenRouter route plus a separate eligible native Gemini preset is not two active generation routes: the service route stays OpenRouter, and Studio generation uses the eligible Gemini preset.
- Environment-sourced OpenRouter (`runtime_configured=false`) must say that environment configuration was detected but is not connected to Studio generation. It must not say the configuration was saved or that the service session was replaced.
- Session-saved OpenRouter still says “配置已保存（未启用生成）” / “Configuration saved (generation not enabled).”
- Switching or saving must explain the affected workflows before save.
- Clearing applies only to the currently applicable runtime configuration and retains existing safe control-state rules.
- API Key inputs remain write-only, clear after the existing save boundary, never echo, and never enter browser preference or project JSON storage.
- When the server does not disclose whether a current advanced route is OpenRouter or compatible Base URL, show a neutral undisclosed-route message and require the operator to choose again before saving. Do not guess the route or Base URL.

Do not add a Test connection button. There is no approved no-call verification contract for it.

### 5.5 Tiles: local primary, Provider evaluation advanced

The deterministic local Tiles workflow remains the default and primary path.

**D-41 supersedes Current-UI reachability.** The Tiles AI / Provider material evaluation workflow remains as API, CLI, and hidden Studio inventory only. Current Studio no longer shows the Advanced mode entry, AI left column, or AI stage. It is not merged into local construction because it does not produce the final atlas or write back to the map.

The earlier demoted entry copy, kept here as inventory wording only, was:

Advanced · Provider material evaluation

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

1. Reconfirm the 10 Current/override optimization frames plus the 2 Archive evidence rows, their order, names, prototype destinations, and screenshots. Do not require a Current match against `996:5274` or `997:6498`.
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
2. Reframe Gemini and other-Provider forms as writing the same service-session slot. **D-15 supersedes** the pre-D-15 reading that this also switches the active Studio generation route for Compat Character or Scene online generation.
3. Make undisclosed advanced route state neutral and truthful.
4. Keep local Tiles as the only Current UI path; retire Provider evaluation from Current while preserving its hidden inventory and maintained API/CLI contracts.
5. Simplify QA to a utility-level manual memo, retain five checks, and remove the Unity implication.

Gate: Settings shows one current service-session route; Studio generation-ready is decided from eligible native Gemini presets; Tiles Provider evaluation has no Current entry while its hidden inventory and maintained API/CLI lifecycle remain intact; QA remains session-only with no service or release side effect.

### Phase 4: Cross-module verification and review

1. Run only the smallest focused guarded tests first.
2. Run broader guarded Studio regression only after focused tests pass.
3. Perform real-browser visual verification against the 10 Current/override Figma frames. `996:5274` and `997:6498` are superseded Archive evidence and are not Current visual gates.
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
- Settings: one current service-session route, Gemini-only Studio generation, other-Provider session-or-environment truth, undisclosed-route neutrality, affected-workflow copy, Key clearing, no echo, and no browser secret storage. **Pre-D-15** wording that an advanced save becomes the Compat/Scene generation route is superseded.
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
8. Settings shows exactly one current service-session Provider route and truthfully explains that other-Provider saves replace the session slot without becoming the current Studio generation route. Studio generation-ready follows eligible native Gemini presets.
9. Tiles local remains the only Current UI path. Provider material evaluation remains hidden inventory with its maintained API, CLI, and backend tests; it is not presented as advanced Current functionality.
10. QA remains exactly five manual, memory-only checks and does not imply Unity-specific support or any automatic acceptance effect.
11. Action terminal failure offers an explicit new-operation path without duplicate submission; Applied exposes only the current verified download.
12. Sequence ordering controls are usable and the exact displayed order governs every maintained output; order changes make old results stale and lock old downloads.
13. Chinese and English are complete and consistent.
14. The real browser matches the 10 Current/override Figma frames at desktop and narrow widths, with recorded reasons for every deviation. Do not require a Current match against Archive frames `996:5274` or `997:6498`.
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
| D-04 | Tiles AI is relabeled and visually demoted to Advanced · Provider material evaluation but its complete real state machine remains. **D-41 supersedes Current-UI reachability:** the demoted entry is now hidden inventory. | It evaluates raw material candidates and is not the primary deterministic Tiles construction path | Approved; Current UI retired by D-41 on 2026-08-15 |
| D-05 | User copy replaces publication language with verified/download/Project-eligibility language; internal release/publication names remain | Prevents users from interpreting a local/server artifact as a public cloud publication without changing compatibility contracts | Approved |
| D-06 | The optimization draft Section governs only the 10 Current/override states plus 2 Archive evidence frames; all eight canonical Sections remain | Prevents the UX pass from replacing accepted unchanged design history and Current frames | Approved |
| D-07 | Removal is limited to the enumerated disabled or unbound controls | Avoids accidental retirement of low-frequency but real capability | Approved |
| D-08 | Human acceptance for Character Entry replaces the obsolete search frame with the real prompt-helper entry, aligns the framed right-side controls at 28 px, and removes the internal profile ID plus decorative empty-stage artwork while preserving the real layout binding and actionable empty-state copy | The old search frame and the two removed elements were confusing visual or implementation detail, not a user action, capability, artifact, or protocol | Approved by human feedback on 2026-08-13; synchronized to Figma `996:5125` |
| D-09 | Human feedback for all six Strict Character states removes the setup Profile card, removes the decorative center character and checkbox-like process squares, keeps a text-only real-evidence wait state, consolidates visual status into the stage Job strip instead of the duplicate footer status, and uses Chinese user-language labels instead of English or machine tokens in the Chinese primary mode/status surfaces. The topbar remains the single polite live region so polling updates are not announced twice. Normal running/review-required export copy follows the Current frames; failure and blocked states retain an explicit unavailable label as a capability-truth exception. | These elements exposed implementation detail or looked interactive without being controls; the compact text-only flow retains phase truth while the unchanged Strict API, contract, evidence, Accept, and artifact gates remain authoritative | Approved by human feedback on 2026-08-13; synchronized to canonical frames `701:4864`, `702:3936`, `709:4274`, `704:4036`, `706:4136`, and `711:4369`; implemented and guarded verification passed; final human acceptance pending |
| D-10 | The six Strict Current banners keep only their leading human-readable status sentence; the separate Job strip remains because it carries live task truth. Raw status codes such as `review_pending` remain internal and must not appear in either user language. | The removed banner title and help repeated information already available in the task panel, stage phase, and Job strip. A single accessible heading preserves orientation without exposing protocol vocabulary or changing any Job state. | Approved by human feedback on 2026-08-13; Figma synchronized at `701:5767`–`701:5769`, `702:4839`–`702:4841`, `709:5177`–`709:5179`, `704:4939`–`704:4941`, `706:5038`–`706:5039`, and `711:5272`–`711:5274`; Studio implementation and guarded verification passed; final human acceptance pending |
| D-11 | Advanced Local background, outline, animation-lock, and frame option labels use natural Chinese or English in the active language, while the maintained enum values such as `auto`, `outer`, and `idle_down` remain unchanged and are never replaced by translated request values. | These controls are primary configuration UI, not technical disclosure. Localizing only their visible labels removes internal enum leakage without changing the current-input fingerprint, invalidation behavior, `/api/process-sheet` request, quality gate, export, or Project-candidate binding. | Approved by human feedback on 2026-08-13; canonical Current frame `971:4596` synchronized through text nodes `972:5093`, `972:5099`, `972:5102`, and `972:5112`; Studio implementation and guarded verification passed; final human acceptance pending |
| D-12 | Advanced Local boolean controls reuse the file's maintained `Checkbox` component appearance while retaining native checkbox semantics, exact IDs, defaults, and parameter values. The duplicate sidebar “Advanced defaults” disclosure is retired; the real Advanced processing entry, its concise help, every control, invalidation rule, API binding, quality gate, export, and Project-candidate gate remain. | The browser-default checkbox geometry was visually inconsistent with the component library, while the sidebar disclosure repeated values already editable inside the Advanced panel and added no capability or status truth. | Approved by human feedback on 2026-08-13; canonical overlay `972:5069` synchronized at field `972:5098` with checked instances `1056:5051` and `1056:5058`, unchecked instance `1056:5055`, sourced from Checkbox variants `402:3177`/`402:3174`; Studio implementation and guarded verification passed; final human acceptance pending |
| D-13 | Action keeps its real phase-specific primary operation in a fixed left-panel footer; Advanced parameters move from the viewport toolbar into the left configuration flow with disabled, enabled, current, and return semantics that follow the existing operation locks. The empty stage is text-only, and the import card shows only the selected filename instead of exposing size, media kind, source identity, or upload ID. | The former placement mixed configuration with stage tools, allowed false prototype paths from no-source or running states, and exposed internal binding detail. These changes preserve the same upload/analyze/preview/build/apply and Source Set operations, all eighteen maintained options, same-Job recovery, source/operation binding, artifact gates, and output authority. | Approved by human feedback on 2026-08-13; canonical Action Current frames synchronized through guided-entry nodes `841:4627`, `841:4631`, `841:4635`, `841:4615`, `841:4619`, `841:4639`, `841:4650`, `841:4643`, `841:4647`, and `841:4623`; Source Set toolbar entries `841:4654`, `848:4713`, `848:5178`, `848:5643`, and `848:6108` are absent from the active design; Default source summary `835:4902` is user-facing; Studio implementation, focused verification, real-browser layout verification, full regression, smoke, and final independent review passed |
| D-14 | Figma now contains a locked non-product authority index `1073:5047`, and only eight dependency-free Tiles nodes were permanently removed: hidden drafts `909:4765`, `909:6385`, `915:6097`, `915:7078` and their orphan captions `909:6024`, `909:7643`, `915:7077`, `915:8058`. Prototype-linked history, all canonical Sections, the 10 Current/override UX frames, and the 2 Archive evidence frames remain. | Historical names alone do not prove deletion safety. The removed nodes had no repository reference, prototype inbound or starting-point role, component definition, or unique state, and had complete Current replacements `910:4970`, `911:4977`, `914:5109`, `918:5310`. Linked v2 material such as `221:167` remains history-only so old demonstrations are not broken. | Approved by human feedback on 2026-08-13; Figma dependency audit and post-write verification passed; no maintained UI, API, Job, artifact, Provider, export, or Project contract changed |
| D-15 | Character Compatibility is retired from Studio Current product UI, first-level mode, runtime projection, and Project candidate aggregation. Gemini is the only generation-ready Provider in current Studio. Other Providers may be saved as service-session configuration through the unchanged `/api/provider-config`, but they are not connected to current Studio generation. Character Strict, Scene online generation, and Tiles Provider paths accept only a selected native Gemini preset. Archive Figma Compatibility nodes remain; they are not implementation sources. | Figma Current already removed Compatibility and marked Gemini as the only generation-ready Provider. Leaving the retired UI or an OpenRouter-backed Scene path would be fake UI because `POST /api/provider-config` replaces `runtimeProviderEnv` while current Studio generation must fail closed without native Gemini. | Approved by the D-15 execution request on 2026-08-14; Figma Current nodes `996:5125`, `683:4017`, `978:5077`, `978:5218`, `978:5359`, `1111:5317`, and Scene lock `1119:5324`; product code, tests, and current-state docs synchronized |
| D-16 | Character Local failed/quality-blocked no longer paints a second Quality Report issue list in `.character-local-stage-body`. The stage keeps the block reason and verified-download lock; taxonomy, impact, suggestion, and diagnostic codes live only in the default-closed right Quality Report disclosure. | The center overlay duplicated the right report and hid the result-first stage. Human feedback asked why the middle still hosted a quality report after the right panel was collapsed. This does not change `/api/process-sheet`, the quality gate, download lock, or report data. | Approved by human feedback on 2026-08-14; Figma Local may still show a large overlay as historical visual intent, not as a second live report |
| D-17 | Character Local Advanced configuration is no longer a second 520 px overlay beside the left binding panel. The same IDs, defaults, invalidation, `/api/process-sheet` binding, quality gate, and download lock remain; the form scrolls inside the left column under the Advanced entry, and that column widens to 520 px while the form is open. Calibration and cut-line stay full workspace overlays because they need the source image. | Human feedback asked why a separate Advanced Local Configuration sheet sat beside the already-bound left source. The second column duplicated current-input truth and covered the stage. Action D-13 already keeps Advanced parameters in the left flow. | Approved by human feedback on 2026-08-14; Figma overlay `972:5069` remains the control inventory, not a requirement to keep a second floating column |
| D-18 | Character Local import is the processing form. The left column always shows source, current values, and processing parameters. The Advanced-entry click, Advanced-config chrome, “return to standard import,” and second run button are removed. `character-local-primary` is the only start CTA and always submits the maintained advanced `/api/process-sheet` binding. Calibration and cut-line remain full workspace overlays; closing them returns to the same column, not a second sheet. JPEG remains a valid local source. Standard-mode helpers stay in JS for existing tests but the Current UI never switches back. | Human feedback said the Advanced-entry click added a required extra step for every run. Docking the form (D-17) still hid it behind that click. Merging the form into the default column removes the second workflow without changing IDs, defaults, invalidation, quality, download, or Project gates. | Approved by human feedback on 2026-08-14; Figma overlay `972:5069` remains the control inventory, not a requirement to keep an entry click or a second run CTA |
| D-19 | Character Local left binding column returns to the pre-merge 300 px width. The same IDs, defaults, and one-column form remain, but spacing, cards, drop zone, lock list, and chip used-width are compacted so the common path can fit a single desktop viewport. The start CTA stays sticky at the bottom of the column. Calibration and cut-line overlays still open from `left: 300px`. Global export-scale chip geometry stays 64×28; only the 300 px column overrides used width so four chips fit. | After D-18 merged the form into the left column, the 520 px width and stacked field cards forced inner scrolling. Human feedback asked to keep the previous list width and show the form on one screen. | Approved by human feedback on 2026-08-14; this is a density adaptation of the D-18 column, not a return to a second Advanced sheet |
| D-20 | Figma Current Local config `971:4596` is retitled `角色工作室 / 本地导入 · 配置 · Current` and shows the accepted 300 px unified column: source, current values, inline processing parameters, and one Start CTA. Overlay `972:5069` is hidden and renamed `Inventory / Advanced Local controls · not live column`; it remains the control inventory, not a second live sheet. Calibration `971:4831` and cut-line `971:5066` stay full stage overlays. Studio is synchronized to this Current structure; final human visual acceptance remains pending. | Human feedback asked to update Figma first, then sync the project from the new Current. D-16–D-19 were product-only deviations until this write. | Design and Studio synchronized; guarded verification recorded below; final human visual acceptance pending |
| D-21 | Local left-column controls use a 28 × full-width geometry with 8 px stack gap: source layout select, black-matte choose/clear, numeric fields, action buttons, and export chips. The matte choose control is a 28 px button, not a 19 px text label. Figma Current processing block `971:4730` and Studio CSS are synchronized to this token. Column width stays 300 px. IDs, defaults, and `/api/process-sheet` binding are unchanged. | Human feedback said the compacted D-19 column, especially “选择同尺寸黑底图”, was too short and the whole menu felt cramped. | Approved by human feedback on 2026-08-14; Figma first at `971:4596` / `971:4730`, then Studio CSS |
| D-22 | Character Local no longer shows the left-column “当前流程 / 本地精灵表导入” explainer. The heading stays in the accessibility tree for `aria-labelledby` and mode-focus, but takes no layout. A later operation-guide surface may replace it; this change does not add that guide. | Human feedback said the block was unnecessary once the column itself is the workflow, and asked to defer guidance to a future操作引导. | Approved by human feedback on 2026-08-14 |
| D-23 | Every Studio topbar hides the `· …` crumb. Crumb IDs, copy keys, and writers remain; the visible status badge is the phase live region. The rule is recorded in `docs/guardrails/studio-topbar-convention.md` and Figma Current crumb slots are hidden. | Human feedback said the Character `· 本地导入` crumb was unnecessary on every page and asked for a written convention plus Figma sync. Mode tabs and status badges already carry that truth. | Approved by human feedback on 2026-08-14 |
| D-24 | Every Studio topbar uses one spacing rhythm: 16px header padding, 24px from the hugged page title to the first left control, then 8px between sibling controls before the flex spacer and right cluster. Sequence and Tiles leave the old absolute `356px` mode slot. | After D-23 hid crumbs, Character “本地导入” sat 10px from the title while Sequence/Tiles still reserved the crumb hole. Human feedback asked for one safe title distance and the same rightward button packing on every page. | Approved by human feedback on 2026-08-14 |
| D-25 | Topbar titles share Inter Semi Bold 14 / 18 in a fixed 92px column. The first left control stays at `16 + 92 + 24 = 132px` on every route. Shorter names do not pull mode buttons left; longer English titles ellipsize in the slot. | Switching Character → Action / Sequence changed title size (13 vs 14) and hugged width, so “本地导入” and other header controls jumped left. Human feedback said the name size may stay consistent and the adjacent buttons must not move. | Approved by human feedback on 2026-08-14 |
| D-26 | Character Local advanced source-layout default is `fixed_region_motion_v0`（固定区域动作源图）. The 8 × 8 option remains selectable. Standard-mode `LOCAL_CHARACTER_DEFAULTS.sourceLayout` stays `topdown_rpg_v0` for existing tests. `/api/process-sheet` options are unchanged. | Human feedback asked the empty Local form to start on 固定区域动作 instead of 标准 RPG · 8 × 8. | Approved by human feedback on 2026-08-15 |
| D-27 | Local clip tiles still crop the first real sheet frame, but the thumbnail now fits the opaque sprite bounds to about 80% of the 48px box. Sheet pixels, frame indices, and export artifacts are unchanged. | Human feedback said the dock characters were too small inside the square. The cell padding made a 1:1 frame draw look like 15–20% of the tile. | Approved by human feedback on 2026-08-15 |
| D-28 | Local clip cards reserve a 12px name row and a 10px meta row under an overflow-clipped 48px thumb. The Local stage dock is 120px so those labels are not covered or cropped. Figma Current complete Clip docks `665:4045`, `667:4045`, and `668:4056` use a 48×48 thumb then the label inside a 120px dock; quiet docks `971:4816` and `996:5260` match that height. Archive clip nodes are unchanged. | After D-27 the larger sprite sat on the name, and the previous 104px dock already clipped `idle_down`. Human feedback asked to keep the name readable and sync Figma. | Approved by human feedback on 2026-08-15 |
| D-29 | Current Local UI hides calibration, manual cut lines, and automatic-grid reset. IDs, i18n, JS helpers, and overlay markup remain as inventory. `/api/process-sheet` still receives `manualOverrides: null` unless tests call the helpers. Figma Current hides Geometry actions `1124:5344` and moves overlay frames `971:4831` / `971:5066` to hidden inventory. Archive and control-inventory `972:5069` are unchanged. | Human feedback said ordinary operators should not see or use these tools. They are specialist source-prep, not the common process path. | Approved by human feedback on 2026-08-15 |
| D-30 | Local playable preview canvas keeps the HTML 960×500 fallback, but the bitmap follows the stage host box so CSS `width/height: 100%` cannot stretch the actor. Clip thumbs already used uniform scale and stay unchanged. | Human feedback said the center-stage character looked stretched after a real Local process. Measured display was 922×779 against a 960×500 bitmap (Y scale 1.56). | Approved by human feedback on 2026-08-15 |
| D-31 | Action Current hides the context toolbar of 16 preset clip names and the duplicate quality chip. Operators name the action in a left-column text field that still binds `data-action-option="action"` / `runtime_action`. Empty names are rejected; the default remains `walk_down`. Known RPG names still sync `targetFrameCount`. Figma Current Viewport Toolbars on the 15 Current Action frames are hidden; Archive `53:96` is unchanged. Motion API, Job, and artifact contracts are unchanged. | Human feedback said the top Action bar was unnecessary and that operators should name actions themselves. The pipeline already accepts any non-empty `runtime_action`. | Approved by human feedback on 2026-08-15 |
| D-32 | Action Current hides the selection-recipe control. The select, both recipe values, and `data-action-option="selectionRecipe"` remain; the submitted default stays `motion_selection_recipe_v2`. v1 compat stays reachable only through the hidden inventory control. | Human feedback said ordinary operators do not need to know recipe versions. Automatic selection already defaults to v2. | Approved by human feedback on 2026-08-15 |
| D-33 | Action Current hides Source Set: the “使用现有条带” entry, `#studio-action-source-set-panel`, and the Source Set stage. IDs, i18n, JS, analyze/apply helpers, and Motion Source Set APIs remain inventory. Guided apply-target inputs on review stay visible. Figma Current Source Set frames `830:5162`, `848:4571`, `848:5036`, `848:5501`, and `848:5966` are hidden inventory; Archive is unchanged. | Human feedback said the entry and secondary page were unused and unclear, and asked to cancel them from Current product and design. | Approved by human feedback on 2026-08-15 |
| D-34 | Sequence Current no longer shows the left-column “当前流程 / 导入 / 序列打包” explainer. `#studio-sequence-phase-title` stays in the accessibility tree for `aria-labelledby`; phase pills, summaries, IDs, i18n, and JS writers remain inventory. The source card starts at 16px so the 127px header slot is not left empty. Topbar `#studio-sequence-status` remains the polite live region. Figma Current Sequence frames `603:3340`, `870:4748`, `894:4567`, `870:4995`, `870:5433`, `870:5870`, `870:6309`, `870:6745`, and `889:4560` hide the matching Tool Panel flow-header chrome and lift the remaining left-column blocks; Archive is unchanged. | Human feedback said the Sequence flow header was unnecessary once the left column itself is the workflow. | Approved by human feedback on 2026-08-15 |
| D-35 | Tiles Current no longer shows the left-column “当前流程 / 设置 / 确定性图块构建” explainer. `#studio-tiles-phase-title` stays in the accessibility tree for `aria-labelledby`; phase pills, summaries, IDs, i18n, and JS writers remain inventory. Local source starts at 16px and AI brief at 24px so the 127px header slot is not left empty. Topbar `#studio-tiles-status` remains the polite live region. Figma Current Tiles frames `603:4360`, `909:6025`, `909:7644`, `910:4970`, `911:4977`, `911:6385`, `912:5088`, `913:5095`, `913:5234`, `914:5109`, and `918:5310` hide the matching Tool Panel flow-header chrome and lift the remaining left-column blocks; Archive is unchanged. | Human feedback said the Tiles flow header was unnecessary once the left column itself is the workflow. | Approved by human feedback on 2026-08-15 |
| D-36 | Scene Current no longer shows the left-column “当前任务 / 主路径 / 从源图块到可导出场景” explainer or the 1–4 step pills. `#studio-scene-phase-title` stays in the accessibility tree for `aria-labelledby`; phase copy, step writers, IDs, and i18n remain inventory. The capability-boundary callout and source cards stay visible. Figma Current Scene frames `650:3694`, `946:4572`, `946:4702`, `946:4832`, `977:5069`, and `1119:5324` hide the matching Tool Panel flow-header chrome. `603:5380` is Archive / Historical v2 · NOT CURRENT inventory, the GameTool main-path v2 historical prototype start; keep it, do not implement from it, and do not continue Current-style edits. Other Archive is unchanged. | Human feedback said the Scene flow header was unnecessary once the left column itself is the workflow. | Approved by human feedback on 2026-08-15; `603:5380` reclassified Archive on 2026-08-17 |
| D-37 | Scene Current no longer shows the left-column “能力边界” truth callout. `#studio-scene-truth-title` / `#studio-scene-truth-copy` and their phase writers remain inventory. The stage `scene-capability-disclosure` stays as the optional technical boundary. Figma Current hides callouts `650:3758`, `946:4644`, `946:4774`, `946:4904`, `977:5141`, and `1119:5396`; Archive is unchanged. | Human feedback said the left callout was also unnecessary once source, quality, and status already carry that truth. | Approved by human feedback on 2026-08-15 |
| D-38 | Project Current no longer shows the left-column “当前任务 / 合成 / 组合已完成产物包” explainer or the “能力边界” callout. `#studio-project-title` stays in the accessibility tree for `aria-labelledby`; copy keys and writers remain inventory. The Project ID field is the first visible left-column control. Figma Current `646:3692` and `998:5408` hide the matching Tool Panel chrome; Archive is unchanged. | Human feedback said everything above Project ID was unnecessary once the compose form itself is the workflow, and asked to sync these hides to Figma. | Approved by human feedback on 2026-08-15 |
| D-39 | Action Current no longer shows the left-column “当前流程 / 新建动作处理” explainer. `#studio-action-phase-title` stays in the accessibility tree for `aria-labelledby` and mode-focus; phase title/summary writers remain inventory. The source card is the first visible left-column block. Figma Current Action State Panels hide State Head plus the title/summary lines; Preview/Build/Abandon frames hide Task Banner. Archive `53:96` is unchanged. | Human feedback said the Action flow header was unnecessary and asked to delete it together with the Figma Current chrome. | Approved by human feedback on 2026-08-15 |
| D-40 | Tiles Current no longer shows the left-column local “构建绑定” status card. `#studio-tiles-binding-title` stays in the accessibility tree for `aria-labelledby`; phase copy, IDs, i18n, and JS writers remain inventory. The AI “评测绑定” card stays visible. Map size, edits, and Job status remain on the contract fields, stage, and topbar. Figma Current local Binding Summary nodes `915:8210`, `909:6103`, `909:7722`, `910:5048`, `911:5055`, and `911:6463` are hidden; Archive is unchanged. | Human feedback said the binding summary was also unnecessary once the left column itself is the workflow. | Approved by human feedback on 2026-08-15 |
| D-41 | Tiles Current no longer exposes Provider material evaluation. `#studio-tiles-mode-ai`, `.tiles-ai-controls`, and the AI plan/review/failed stage stay in DOM as inventory; Current CSS hides them and `switchMode` / `renderStudioTiles` stay on `local`. Benchmark APIs, CLI, i18n, and JS writers remain. Nothing from the benchmark is merged into local construction because it does not produce the atlas or write back to the map. Figma Current AI frames `912:5088`, `913:5095`, `913:5234`, `914:5109`, `918:5310`, and UX v4 `997:6498` are hidden Archive; local Current `Mode/AI` chips are hidden. Local construction remains the only Current Tiles path. | Human feedback said the whole Advanced Provider evaluation surface is unused, must leave Current product and design, and must not be presented as a Character-like generate-then-process start. | Approved by human feedback on 2026-08-15 |
| D-42 | Scene live generation keeps the existing 1–8 `candidateCount` contract, but Current UI now presents it as an operator-owned “生成次数” select. The old “每个候选恰好一次调用” note is replaced by “可选择 1 到 8 次”. The confirm checkbox still restates the chosen count. `/api/generate-scene-tiles` is unchanged. Figma Current running copy `946:4626`, `946:4674`, and `946:4649` uses generation-count wording. | Human feedback said choosing once and generating once felt locked; the count choice must be visible. | Approved by human feedback on 2026-08-15 |
| D-43 | Scene Current advanced / experimental labels are bilingual. Chinese shows 调色板对齐, 边缘条件, 边缘感知 v1, 全局 v0, 警告, and 严格. Option `value` attributes stay `edge-aware-v1`, `global-v0`, `warn`, and `strict`. `/api/process-scene-tiles` and `/api/generate-scene-tiles` options are unchanged. Figma Current collapsed hints `650:3780`, `946:4666`, `946:4796`, `977:5163`, and `1119:5418` use “种子 · 密度 · 调色板对齐 ▸”. | Human feedback said the advanced grid was only partly translated. | Approved by human feedback on 2026-08-15 |
| D-44 | Project was briefly retired from Current Studio UI and Figma Current. **D-45 supersedes this for Current reachability.** | Human feedback said the Project page looked unused and asked to cancel it from Current product and design. | Approved by human feedback on 2026-08-15; Current UI restored by D-45 the same day |
| D-45 | Project is again a Current Studio page and Figma Current surface. The rail item, `#studio-project-view`, `#project` hash, and file-preview routing are live. D-38 still hides the left explainer and capability callout. Figma Current `646:3692`, UX v4 `998:5408`, caption `646:3821`, and Current-page plus Scene Current `Nav/项目` items are visible again. The brief D-44 `Nav/产出` label is gone; no `Nav/产出` node remains. **D-51** retargets Scene Current project entries to `646:3692` and replaces leftover Current 产出 navigation copy. `603:5380` is Archive inventory, not a Scene Current source. `/api/project-pack` and Character/Scene eligibility gates were never removed. Human visual acceptance is still pending. | Human feedback asked to open Project again after the D-44 hide. | Approved by human feedback on 2026-08-15; D-51 archive classification of `603:5380` recorded 2026-08-17; human visual acceptance still pending |
| D-46 | Project workspace no longer forces `min-width: 1020px`. The 320px + `1fr` stage stays in view when the window is narrower than the 1920 Current frame. Narrow stacking no longer uses a 900px/980px min-height that pushed the stage below the fold. D-38 clip headers stay contained in the left column. | Human feedback said the Project right stage was not visible after D-45. | Approved by human feedback on 2026-08-15 |
| D-47 | Figma Current is cleaned as a single implementation authority for the affected states. Action Source Set has no visible Current entry or reaction; retired captions and Section names do not advertise it. The audited Character, Action, Sequence, Tiles, Scene, and Project Current topbars use the 92 px title slot, hidden crumb/search, 132 px first-control origin, 8 px sibling rhythm, eight-item Rail with QA in the utility group, and Secondary topbar exports where an in-page task action exists. Scene Current authority is `650:3694`, `946:4572`, `946:4702`, `946:4832`, `977:5069`, `1119:5324`, and UX v4 `997:6627` / `998:5286`. `603:5380` is Archive / Historical v2 · NOT CURRENT inventory and is not an implementation source. Other Archive and hidden inventory remain unchanged. | The live Figma audit found prototype links, stale flow chrome, inconsistent Rails, and topbar copies that could direct a future implementation agent back to retired or conflicting UI. | Approved by the human request to optimize the remaining design and application gaps on 2026-08-16; `603:5380` removed from Scene Current on 2026-08-17 |
| D-48 | Character Local uses truthful discrete activity and failure presentation. Running phases expose an indeterminate activity indicator and natural phase label; `poll_paused` and terminal states do not show active progress. A verification failure preserves the same terminal Job/input binding and any valid quality report, always shows a localized blocking category plus any concrete current-task response, suppresses bare machine codes, and only invites the operator to open Quality Report when a real report exists. | The service exposes discrete Job states, not authoritative percentages, and the previous failure path could discard a real report while telling the operator to open one that was absent or hide the concrete failure reason behind a generic category. | Approved by the human request on 2026-08-16; Figma `JobStage` set `1084:5190` / instance `1084:5191` and Local running Current `683:3795`; Studio and tests synchronized |
| D-49 | Sequence and Tiles primary status surfaces use natural bilingual task language. Raw phase/status enums remain internal or in explicit technical evidence. Tiles local Current removes Provider-count noise, localizes visible border choices without changing `empty` / `none` values, and separates its six local Current states from hidden Provider/AI inventory in implementation provenance. | Machine-like phase codes and `0 Provider` obscured what the operator needed to do and made Archive inventory look like Current capability. | Approved by the human request on 2026-08-16; Studio copy, provenance, and focused contracts synchronized; Tiles Current/Archive ledger remains 10 + 2 at the optimization-file level |
| D-50 | The affected Current layouts preserve the accepted responsive and action hierarchy: Character Local remains a 300 px desktop column until the real narrow breakpoint; Sequence empty content fits at 390 px; Scene keeps its first mode control at x=132 on narrow screens; Project and QA preserve the 16 px narrow topbar pad; Character, Scene, and Project topbar export controls are Secondary while the page owns the task-primary action. | Browser verification exposed intermediate-width and narrow-screen drift plus competing topbar/page primary actions. These are visual hierarchy repairs only; export gates and handlers are unchanged. | Approved by the human request on 2026-08-16; Figma Current and Studio CSS/HTML synchronized; guarded browser verification recorded below |
| D-51 | Scene Current project entries prototype to Current Project `646:3692`. Visible Scene Current buttons `650:3784`, `946:4669`, `946:4799`, `946:4929`, `977:5166`, `1119:5421`, and UX v4 `997:6724` read “前往项目合成…” and keep destination `646:3692`. Visible body copy `650:3806`, `946:4690`, `946:4820`, `977:5187`, `1119:5442` and hidden Current copy `650:3776`, `946:4662`, `977:5159`, `1119:5414`, plus UX v4 `997:6745`, use Rail「项目」/「项目」. `603:5380` is Archive / Historical v2 · NOT CURRENT, the GameTool main-path v2 historical prototype start; keep the node, do not delete it, and do not continue Current-style edits. It is Archive inventory only and is not an implementation source. Focused rail contract locks `nav.project` to 项目 / Project and forbids 产出 in Studio Rail user copy. `#project`, `/api/project-pack`, legacy `project-pack` redirect, and server protocol are unchanged. | Live Figma audit found leftover 产出 navigation copy in Current, and later classified the v2 preview board as historical prototype inventory rather than Scene Current. | Approved by human request on 2026-08-17; Archive classification recorded; human visual acceptance still pending |
| D-52 | The `#action` user path uses object-level names instead of the broad module label “动作” / “Action”: Rail「取帧」/“Extract”, page「动作取帧」/“Frame Extraction”, input object「动作素材」/“Source media”, and primary CTA「分析素材」/“Analyze source media”. HTML fallback, runtime i18n, document titles, and focused naming contracts stay bilingual. The internal `#action` route, `nav.motion`/`action.*` translation keys, Motion source API/module identifiers, `runtime_action`, selection recipe, all eighteen maintained parameters, Job states, artifacts, and release gates are unchanged. | Human feedback said “动作” was too broad for a workflow whose real task is extracting candidate frames from video, GIF, ZIP, and still-image media. “取帧” is short enough for the Rail, while the page and input labels explain the task without narrowing the supported formats to video only. | Approved by human feedback on 2026-08-17; product commit `2832a1ac666bfb4917054883e87048661049e0bc`; Figma Current, repository copy, guarded focused verification, and bilingual desktop/narrow browser verification synchronized; final human visual acceptance remains pending |
| D-53 | Sequence empty Current is text-only. Figma Current deleted the four decorative rectangles `870:4740`–`870:4743` from empty card `870:4739`; Title `870:4744` and Body `870:4745` use x=40 / width=524; truth pill `870:4746` stays horizontally centered. Studio deletes only `.sequence-pixel-person` and its child/pseudo/narrow rules, and the empty copy uses the freed width. Binding card `#studio-sequence-binding-title` stays in the accessibility tree and now projects the nine Current state titles in Chinese and English instead of the leftover “Binding Summary” string. Binding body still shows real frame count, parameters, request count, source epoch, GIF availability, and stale/lock state. This is display and localization only: `#sequence` routing, PNG/JPEG/WebP multi-select, sort/move/remove, Sheet/JSON/GIF/ZIP, GIF request count, options/input binding, the nine phase semantics, `package_after_gif`, download gates, APIs, Jobs, artifacts, Archive `54:107`, and hidden inventory are unchanged. | Human feedback said the empty-state person was unused decoration, and the browser Chinese “Binding Summary” lagged the already-designed per-state Current titles. | Approved by human feedback on 2026-08-17; Figma Current, Studio HTML/CSS/JS, focused Sequence tests, and bilingual desktop/intermediate/narrow browser verification synchronized; final human visual acceptance remains pending |
| D-54 | Figma Current is labeled so Current provenance no longer treats Archive as implementation source. Permanently deleted nodes are an operator-recorded deletion gate (`1094:5075` and 22 hidden page-root captions); live absence was reverified and the pre-deletion seven-item proof cannot be independently rebuilt. Archived, not deleted: IA `209:167`, Interaction Map `237:327`, IA Redesign `639:3649`, note `643:3741`, Compat kit `1094:5074` / set `1094:5421` / variants `1094:5417` `1094:5418` `1094:5419` `1094:5420`, Settings stub `726:4451`, Tiles hidden drafts `907:4568`/`908:4661`/`911:5335`/`915:5116`/`908:5920`, Scene v1 `56:135`, Scene v2 `603:5380`, plus existing Compatibility / Tiles Provider / Source Set / Sequence Archive / Character v2 boards. Design Spec page `215:167` / board `215:168` is Archive / Historical · NOT CURRENT (banner `1245:5085` / `1245:5086`); it is not empty and is not a Current/Authority page. New Archive section `1239:5085`. Authority card `1239:5086` and orientation marker `1247:5085` record the 2026-08-20 write window, not a numeric Figma version. File has three pages: `0:1`, `1:2`, Archive `215:167`. Historical boards remain labeled inside Canonical Sections. Studio Scene `data-design-source` drops `603:5380` into `data-design-archive-inventory`; CSS keeps Current and Archive IDs on separate lines. Eight routes, runtime controllers, APIs, Jobs, Providers, artifacts, exports, and Project gates are unchanged. | Current scans still mixed old IA, a stray text, a retired Compat kit, Archive Scene v2 inside Current provenance, and an outdated Design Spec page presented as live spec. | Approved by the human request to execute D-54; first Figma writes 2026-08-19 23:57–2026-08-20 00:02 Asia/Shanghai; first repo commit `cd4b7d5` 2026-08-20 00:05:51 +0800; latest recorded closeout product/docs commit `91364cdbf8893550d384986ad825242940c53b18`; residual closeout 2026-08-20; no browser rerun; final human visual acceptance remains pending |
| D-55 | Tiles empty is text-only in the browser: `.tiles-pixel-person` and its exclusive CSS are deleted; copy uses `.tiles-empty-copy`. This is an approved implementation-only deviation — Figma Current person parts `915:8224`–`915:8227` and UX `997:6467`–`997:6470` stay visible. The local build-outputs dock leads with 构建产物 / Build outputs, human names/purposes, secondary filenames, and phase states 尚未构建 / 等待构建 / 正在生成 / 可下载 / 未生成 / 需重新构建. Download unlock remains `phase === complete && localTilesResultIsCurrent(state)`; Tiled still downloads `tileset.tiled.json` + `tileset.tsx`. Current Figma docks on `603:4360`, `909:6025`, `909:7644`, `910:4970`, `911:4977`, `911:6385`, and UX `997:5491` follow the same IA. Frame IDs, Archive/Superseded boards, prototypes, reactions, APIs, Jobs, Providers, exporters, artifacts, and routes are unchanged. | Human feedback said the empty-state person added no information, and ATLAS/MAP/TILED/PACK plus filenames were unreadable as the first layer. | Approved by the human request on 2026-08-23; implementation, Current Figma output docks, focused Tiles/nav tests, and browser empty/ready plus labeled visual fixtures recorded; independent review pending; final human visual acceptance remains pending |
| D-56 | Module main-process CTAs share `.studio-module-cta`: min-height 48px, desktop max-width 248px, `var(--brand)`, 12px/600, radius 4px, unified hover/active/focus-visible/disabled/busy. Inventory: `character-local-primary`, `character-primary-action`, Action phase primaries `studio-action-analyze`/`preview`/`build`/`apply`/`recover`, `studio-sequence-primary`, `studio-tiles-primary`, `studio-scene-primary`, `studio-project-primary`. QA has no submit. Settings save, export, back, cancel, restore-auto, calibration/cut, and prompt Generate stay outside the class. Events, disabled conditions, Jobs, APIs, and state machines are unchanged. Tiles onboarding copy leads with purpose; `tiles.contractTitle` is 地图设置 / Map settings; `tiles.primary.empty` is 开始编辑地图 / Start editing the map; width/height are 格 / cells; density has help; solver option values stay `constraint`/`seeded` with translated labels. Figma person mutation remains 0. | Human feedback said module primary buttons were inconsistent in size/color, and Tiles still led with corner-grid / map-contract / constraint jargon. | Approved by the human request on 2026-08-23; independent commit after D-55 `20af2e0`; implementation, Current Figma CTA restyle, focused tests, and browser checks recorded; independent review pending; final human visual acceptance remains pending |
| D-57 | Figma Present and Current Rail prototype metadata only. File-wide Present is 54 after removing 11 Archive/SUPERSEDED starts without deleting, moving, or renaming the nodes: `688:3826`, `1289:5086`, `1289:5436`, `1289:5786`, `1289:6136`, `1289:6486`, `1289:6836`, `1289:7186`, `1289:7536`, `1313:5247`, `1313:5597`. Eight Current Rail `NAVIGATE.destinationId` values now point at Canonical Current Defaults: `797:4760`/`706:4148` → `603:3340`; `797:4764`/`706:4152` → `603:4360`; `797:4768`/`706:4156` → `650:3694`; `797:4772`/`706:4160` → `646:3692`. `706:4226` still destinations `221:2189`. `706:4136` and `683:4154` remain Present starts and stay in Section `700:3836`. D-54's recorded Present count of 55 is historical and is not rewritten. No Studio route, API, Job, Provider, pipeline, artifact, exporter, or parameter-binding change. | Live Present had drifted to 65 (64 on `0:1` plus 1 on Archive `215:167`), including Archive/SUPERSEDED starts, and Character Current Rails `683:4154` / `706:4136` still prototyped to Archive `54:107`, `54:1883`, `56:135`, and `56:1916`. | Approved by the human request to execute Present cleanup then the eight Rail retargets, then sync docs as D-57; Figma writes recorded below; this docs-only residual does not rerun tests or browser; no Figma rewrite in the docs step; final human visual acceptance remains pending |

No unrecorded deviation is permitted. If implementation evidence requires a visual, content, interaction, state, capability, or workflow change beyond this table and Sections 3–5, stop that change, add a proposed deviation with its reason and impact, and obtain approval before implementation.

## 11. Delivery record template

Current evidence for this implementation:

- Implemented commits: D-54 latest residual provenance/test commit `7b3607bc74787c4b2637e8ad8a4211762c76d30d` (CSS, focused tests, docs, and matching Figma residuals; not docs-only); previous closeout product/docs commit `91364cdbf8893550d384986ad825242940c53b18`; D-54 first product/docs commit `cd4b7d5acadad2c3087861e75790290ec9cad4a9`; D-53 Sequence product code `367c10349113426ca36d60f3c0faf52705d677f8`; D-52 naming product code `2832a1ac666bfb4917054883e87048661049e0bc`; D-47–D-50 Studio UX product code `c1dc14af7db5799f00029deff18473ed14cf97e3`; later docs-only residual commits are not recorded as a new product hash. Their documentation closeouts are recorded separately and do not reuse the product-code hashes. Earlier D-15 implementation commit: `3f348f75705cf006cdea4957dd557bc4ba3365d7`; D-15 P2 commit: `fdd10b0d75779456556338c11c1ac0b882be1deb`; D-15 review-fix product code: `7a7b3d42894aa02062b7942fd8676905a82d3940`.
- Figma nodes verified: the 10 Current/override nodes in Section 2.1 plus canonical Sections in Section 2.2. **Superseded Archive evidence:** Character Compatibility `996:5274` and Tiles Provider evaluation `997:6498` are not Current visual gates. Human acceptance synchronized Character Entry node `996:5125` so the obsolete search frame is the real 118 × 28 prompt-helper entry, the framed right-side controls share a 28 px height, and the internal profile-ID line plus decorative empty-stage artwork are absent
- Desktop screenshots: 12 real-browser 1920×1080 captures in `output/playwright/studio-ux-20260813`; Action recovery/Applied, Sequence ordered-input, Tiles Provider evaluation, and Scene recovery captures are explicitly named `visual-fixture` because they render controlled in-page state rather than a live Provider or Job result
- Narrow screenshots: 8 real-browser 390×1080 captures in the same directory, one for each maintained route
- Browser verification: passed under `guard:full`; 8 routes, 16 desktop/narrow overflow checks, 16 desktop/narrow Chinese/English switches, visible-control accessible-name checks, keyboard disclosure, zero console warnings/errors, and zero page errors; the affected-page rerun in `output/playwright/studio-ux-final-20260813` also proved Character Compatibility at 1920 × 1080 and 390 × 1080, Strict hidden/inert outside AI mode, no horizontal overflow, bilingual switching, default-closed native disclosure with Enter toggling and retained focus, and zero console warnings/errors (**pre-D-15 / superseded** as Current Compatibility evidence; Compatibility is no longer a Current Studio surface); the final human-feedback rerun used real Chrome at 1920 × 1080 and 390 × 1080 and proved five 28 px desktop Character header controls with identical top coordinates, no internal profile ID, no decorative empty-stage node, preserved actionable empty-state copy, bilingual switching, no overflow, and zero console warnings/errors
- Focused tests: all affected guarded suites passed after the smallest stale-assertion updates; the final human-feedback run passed 29/29 Character, Advanced Local, and promotion tests, in addition to the earlier affected-module runs
- Pre-D-15 human-feedback checkpoint — full guarded regression: `npm test` passed 1234/1234 (TAP duration 119.539 seconds; guard elapsed 119.592 seconds); peak process-tree RSS 843184 KiB across 5 processes. A sandboxed invocation stopped before test execution because the checked-in resource monitor could not spawn (`EPERM`); the successful run used the same guard and limits outside that sandbox restriction
- Pre-D-15 human-feedback checkpoint — local smoke: `npm run smoke:local` passed in 3.614 seconds; peak process-tree RSS 705040 KiB across 3 processes
- Pre-D-15 human-feedback checkpoint — independent read-only review: PASS at that checkpoint; the initial implementation findings and both human-feedback Figma mismatches in that scope were closed, with no P0/P1/P2, deleted page or file, or protected-path change reported at that time
- Current D-09 focused tests: `npm run test:focused -- test/uiStudioCharacter.test.js test/uiStudioCharacterApi.test.js` passed 30/30 (TAP duration 242.371 ms; guard elapsed 294 ms; peak process-tree RSS 320 KiB; one process)
- Current D-09 browser evidence: the maintained HTTP Studio passed real-browser checks at 1920×1080, 1135×998, and 390×844 in Chinese and English. The Strict setup showed no Profile card, decorative character, pseudo-checkbox, duplicate footer status, text clipping, or horizontal overflow; the single visual Job strip and seven text-only process cards matched the Current frames; all three right-side header controls measured 28 px; both language controls remained reachable at 390 px; keyboard focus was visible; console warnings/errors were empty
- Current D-09 independent review: PASS after the state-title, restore/failure truth, export-copy, live-region, and process-completion findings were closed; no P0/P1/P2 remained
- Current D-10 focused tests: the final latest-disk `npm run test:focused -- test/uiStudioCharacter.test.js test/uiStudioCharacterApi.test.js` run passed 30/30 (TAP duration 296.382 ms; guard elapsed 375 ms; peak process-tree RSS 752 KiB; one process). An earlier sandboxed invocation stopped before test execution because the resource monitor could not spawn (`EPERM`); the successful run used the same checked-in guard outside that sandbox restriction
- Current D-10 browser evidence: the final resource-guarded real Chrome run passed 36/36 controlled layout checks: all six Strict phases at 1920×1080, 1135×998, and 390×844 in Chinese and English. Every phase displayed exactly one accessible `h2` sentence using the approved localized copy; Setup, Confirm, Running, Review Required, and Topdown measured 40 px high, while Accepted measured 32 px, matching their refined Figma banners. There was no text clipping, horizontal overflow, hidden narrow-screen language control, user-visible machine status code, retired Profile card, decorative character, duplicate footer, console warning/error, or page exception. The run completed in 6.049 seconds with peak process-tree RSS 1,782,880 KiB across 12 processes, below the 4 GiB guard ceiling. Setup was loaded through the maintained runtime; the other phase projections were explicitly controlled in-page visual fixtures for layout and copy verification, not live Provider, Job, evidence, or Accepted artifacts
- Current D-10 Figma evidence: all six refined banners were rendered and visually inspected after synchronization; their original widths were preserved, their secondary text was removed, and Running, Review Required, Accepted, and Topdown use the same human-facing primary copy as the maintained UI. Accepted no longer says publication and instead reads `已接受 · 下载已验证`
- Current D-11 Figma evidence: canonical Advanced Local Current frame `971:4596` and overlay `972:5069` were inspected before HTML changes; visible summaries now use localized background, outline, frame-adjustment, and animation-lock language at nodes `972:5093`, `972:5099`, `972:5102`, and `972:5112`. Native select popup chrome is rendered by the browser rather than as a separate Figma state; the exact bilingual option-label matrix and unchanged internal values are controlled by D-11 and focused tests
- Current D-11 focused tests: the final latest-disk `npm run test:focused -- test/uiStudioCharacterAdvancedLocal.test.js` run passed 9/9 (TAP duration 74.682 ms; guard elapsed 124 ms; peak process-tree RSS 640 KiB; one process). The added contract proves all five background values, three outline values, sixteen animation-lock values, and exactly sixty-four frame indices retain their exact internal values while both user-language label sets are present. The first sandboxed invocation stopped before test execution because the resource monitor could not spawn (`EPERM`); the successful runs used the same checked-in guard outside that sandbox restriction
- Current D-11 browser evidence: the final resource-guarded real Chrome run passed Chinese and English at 1920×1080, 1009×998, and 390×844. It verified the exact visible labels for background, outline, all sixteen animation locks, and all sixty-four frame choices; retained selected values `flood`, `both`, `idle_down`, `walk_left`, and frame `7` across language switching; kept both language controls reachable; and found no horizontal overflow, non-GET request, console warning/error, or page exception. Narrow-screen scroll-state captures prove the animation-lock list remains reachable. The run completed in 5.121 seconds with peak process-tree RSS 1,378,368 KiB across 10 processes; screenshots are in `output/playwright/studio-ux-d11-20260813`
- Current D-11 independent read-only review: PASS; no P0/P1/P2 remained after the focused contract was tightened to lock the exact 0–63 frame range, and the review found no API, server, pipeline, export, or Project-gate change
- Current D-12 Figma evidence: the canonical Advanced Local frame `971:4596` and overlay `972:5069` were inspected before HTML changes. The local `Checkbox` component set `402:3188` defines the 16×16, 3 px radius, dark unchecked and brand-green checked states; field `972:5098` now contains compact component instances for Cleanup, Pixel finishing, and Outline. Figma already omitted the retired expanded default-value list, while preserving the Advanced processing entry represented by node `971:4724`
- Current D-12 focused tests: the final latest-disk `npm run test:focused -- test/uiStudioCharacterAdvancedLocal.test.js test/uiStudioPromotion.test.js` run passed 14/14 (TAP duration 154.084 ms; guard elapsed 202 ms; peak process-tree RSS 496 KiB; one process). The contract proves the redundant disclosure/copy/CSS is absent, the real Advanced entry and help relationship remain, all five maintained boolean inputs retain their IDs and native checkbox type, and their parameter readers are unchanged. The first sandboxed invocation stopped before test execution because the resource monitor could not spawn (`EPERM`); the successful run used the same checked-in guard outside that sandbox restriction
- Current D-12 browser evidence: the final resource-guarded real system Chrome run passed 6/6 combinations at 1920×1080, the reported 1009×998 width, and 390×844 in Chinese and English. It verified the disclosure is absent, the Advanced entry and concise help remain, all five defaults are unchanged, the checkbox contract resolves to 16×16/3 px with the correct checked and unchecked colors, real Tab focus is visible, Space toggles and restores Pixel finishing, both language controls remain usable, and there is no document/overlay overflow, non-GET request, console warning/error, or page exception. The latest-disk run completed in 10.817 seconds with peak process-tree RSS 1,354,704 KiB across 9 processes; screenshots are in `output/playwright/studio-ux-d12-20260813`. An initial Playwright launch failed before page execution because its bundled Chromium was absent; the successful run explicitly used the installed system Chrome without downloading dependencies
- Current D-12 independent read-only review: PASS; no P0/P1/P2 remained after the checkbox-only label styling was narrowed and the latest-disk focused/browser evidence was rerun. The review confirmed native checkbox semantics, Figma component parity, and unchanged parameter, API, invalidation, export, and Project gates
- Current D-13 Figma evidence: Action Current Section `726:4445` and all fifteen Current frames were audited before implementation. The fixed `Panel Footer` remains the sole phase-primary operation area; Advanced entry nodes were moved from the viewport toolbar into the guided left control flow or hidden for Source Set, and disabled states have no prototype reaction. Default remains text-only and no Current frame contains the retired five-row internal source metadata table
- Current D-13 focused tests: the final latest-disk `npm run test:focused -- test/uiStudioAction.test.js test/uiMotionSourceOptionsModel.test.js test/uiMotionSourceBinding.test.js test/uiMotionSourceGuidedState.test.js` run passed 43/43 (TAP duration 315.339 ms; guard elapsed 365 ms; peak process-tree RSS 640 KiB; one process). The first sandboxed invocation stopped before test execution because the checked-in guard could not spawn its monitor (`EPERM`); successful runs used the same resource guard outside that sandbox restriction. The contract covers the fixed footer/document-flow narrow layout, Advanced source/operation/flow gates and focus return, preservation of a blocked diagnostic across view-only Advanced entry/return, selected-filename-only rendering, retired decoration/internal metadata, all eighteen maintained options, request body binding, option serialization and invalidation, source replacement cleanup, and the existing source/operation/artifact authority gates
- Current D-13 browser evidence: the final latest-disk real in-app browser run passed the maintained no-source Action state at 1920×1080, the reported 1009×998 width, and 390×844 in Chinese and English. It verified that the Advanced entry is in the left scroll flow rather than the viewport toolbar and is disabled without a source; the phase-primary Analyze control is in the independent bottom footer; the stage is text-only; the five-row internal source metadata table is absent; the selected-filename live region is empty and hidden before selection; both language controls remain visible; focus indication is visible; and there is no horizontal overflow, text clipping, control/stage/artifact overlap, console warning, or page exception. The first narrow render exposed a collapsed grid row; the final CSS uses document-flow block layout at ≤860 px, and all six combinations were rerun after that correction. Screenshots are in `output/playwright/studio-ux-d13-20260813`. The existing in-app browser was reused, so no browser subprocess was launched; its local HTTP server ran under the checked-in full guard and was explicitly stopped after 645.490 seconds with peak process-tree RSS 158,320 KiB across four processes. No upload, Job, or Provider action was invoked; selected-source and enabled/blocked Advanced behavior remain covered by the focused contract rather than represented as live browser output
- Current D-13 independent read-only review: final latest-disk PASS with no P0/P1/P2. The initial finding that a view-only Advanced round trip could clear a blocked diagnostic was closed by retaining that diagnostic until a real parameter change, recovery, or new operation. The final review also confirmed the fixed/footer and narrow-flow structure, filename-only rendering and ARIA behavior, all eighteen option bindings, same-Job recovery, source/operation authority, and artifact gates; it ran no tests, builds, server, browser, Provider call, or protected-directory inspection
- Current D-14 Figma cleanup evidence: `525:3340` was confirmed absent; the eight explicit orphan nodes in D-14 were removed one node at a time; post-write inspection confirmed all eight are absent, canonical Sections `700:3836`, `726:4445`, `726:4446`, `726:4447`, `726:4448`, `726:4450`, `749:4445`, `955:4572`, optimization Section `995:5125`, Current replacement frames `910:4970`, `911:4977`, `914:5109`, `918:5310`, and prototype start `997:5491` remain. The locked authority index `1073:5047` contains six guidance cards and is explicitly marked `NOT UI`. No product code or runtime contract changed, so test/build/browser reruns were not applicable to this design-governance-only increment
- Deviations D-16–D-46 above were explicitly approved through the recorded human-feedback rounds; this delivery adds only the scoped D-47+ rows recorded below. D-51 records the Scene copy/prototype repair and the Archive classification of `603:5380`; human visual acceptance is still pending.
- Checks intentionally not run: real Provider calls, as prohibited by this plan
- Residual risks: human acceptance remains pending; D-51 Figma/nav-copy repair and the Archive classification of `603:5380` are recorded, not accepted. Controlled visual fixtures prove UI state projection and layout but are not represented as current Job or Provider artifacts
- Current D-51 Figma evidence: after mutation, Scene Current frames `650:3694`, `946:4572`, `946:4702`, `946:4832`, `977:5069`, `1119:5324`, and UX v4 `997:6627` / `998:5286` were re-read. Every Current `Nav/项目` destination is `646:3692`. Listed buttons read “前往项目合成…” and keep destination `646:3692`. Listed visible/hidden Current navigation copy and UX v4 leftovers `I997:6724;4:155` / `997:6745` no longer contain 产出. `603:5380` is named `Archive / Historical v2 · NOT CURRENT · 场景工坊 / 场景预览 · v2`, remains in Section `726:4448` as Archive inventory, and is not an implementation source. This is a re-read, not human acceptance.
- Current D-51 focused tests: `npm run test:focused -- test/uiPrimaryNavigation.test.js` passed 3/3 (TAP 77.743 ms; guard elapsed 127 ms; peak process-tree RSS 576 KiB; 1 process). The new contract locks `nav.project` to 项目 / Project and forbids 产出 in Studio Rail user copy. `#project` routing, Project API, and server protocol were not changed.
- Current D-53 Figma evidence: decorative person nodes `870:4740`, `870:4741`, `870:4742`, and `870:4743` were confirmed to have no reactions, component instances, or inbound prototype destinations, then deleted one by one. Title `870:4744` and Body `870:4745` were moved to x=40 / width=524 with original y, font, and color. Truth pill `870:4746` remains centered at x=152 / width=300. Archive `54:107` was not modified. Post-write screenshots of `870:4739` and Default Current `603:3340` were re-read: the person is gone, copy uses the freed slot, and the Default Binding title remains 「尚未建立生成绑定」. This is a re-read, not human acceptance.
- Current D-53 focused tests: `npm run test:focused -- test/uiStudioSequence.test.js` passed 22/22 (TAP duration 122.165917 ms; guard elapsed 171 ms; peak process-tree RSS 976 KiB; one process). The contract now forbids `.sequence-pixel-person` in HTML/CSS/JS, locks desktop empty copy at left 40 / width 524 and narrow copy at left 40 / `calc(100% - 80px)`, and directly maps all nine Current Binding titles in Chinese and English. Language switching re-renders the current phase title and does not assign `phase`. Existing sort, GIF, ZIP, Binding body, stale, download-gate, and ARIA contracts remain.
- Current D-53 browser evidence: resource-guarded system Chrome passed 1920×1080, 1135×998, and 390×844 in Chinese and English. Empty-state person count was 0; desktop empty copy measured left 40px / width 524px; 390 px copy kept left 40px and did not restore the person inset. Default Binding titles were 「尚未建立生成绑定」 / “No generation binding yet”. In-page phase projection (no file import) showed all nine Current titles; language switching left `data-sequence-phase="empty"` unchanged. Document overflow-x was 0; truth pill, Binding `aria-labelledby`, and accessible names remained; console error/warning count was 0; non-GET request count was 0. Guard elapsed 3943 ms; peak process-tree RSS 1,586,384 KiB across 12 processes. The guarded server on port 4177 and Chrome debug port 9333 were stopped after the run.
- Current D-53 independent read-only review: PASS with no P0/P1/P2. The review confirmed Figma deletions were decoration-only, Archive `54:107` was untouched, Studio removed only the person markup/CSS, Binding titles are projected from real phase/`package_after_gif` without raw phase codes, and no route, GIF POST, Job, artifact, or download-gate contract changed. The review ran no additional tests, build, server, browser, or Provider call.
- Current D-54 Figma evidence: 2026-08-20 live Plugin API rescan after `setCurrentPageAsync`. File pages: `0:1` UI Design, `1:2` Icons (Magicoon), `215:167` Archive / Historical Design Spec · NOT CURRENT (board `215:168`, banner `1245:5085` / text `1245:5086`). UI Design top-level still contains Foundations, Components Library, eight Canonical Sections, Settings stub Archive, UX Section, Design Authority, and Archive section `1239:5085`. Permanently deleted in the first D-54 write: `1094:5075`, `310:9177`, `310:9178`, `316:4657`, `321:5251`, `608:3649`–`608:3664`, `608:3667`, `608:3668`. Live absence was reverified; the pre-deletion seven-item proof cannot be independently rebuilt. Archived/relabelled: `209:167`, `237:327`, `639:3649`, `643:3741`, `1094:5074`, `1094:5421`, `1094:5417`, `1094:5418`, `1094:5419`, `1094:5420`, `726:4451`, `907:4568`, `908:4661`, `911:5335`, `915:5116`, `908:5920`, `56:135`, `603:5380`, `215:167`, `215:168`, plus kept boards `316:2510`, `221:2189`, `321:628`, `56:1916`, `321:2657`. 10/10 UX Current/override IDs remain. A prior 2026-08-20 00:02 scan of 16 named Current frames resolved 234 INSTANCE nodes with 0 unresolved mains; that count is a one-time scan record, not a stable gate. Icons page `1:2` unchanged. Historical v1/v2/inventory boards remain labeled inside Canonical Sections. Orientation marker: Authority node `1247:5085` records the write window only. REST file versions API returned 403. Present starts are 55: Archive/NOT CURRENT/v1/v2/old-inventory starts are 0; Current Scene start is `650:3694`; Current Project start is `646:3692`. This-round residual findings before the later repair: `1245:5086` cited missing `DESIGN.md`; `1247:5085` claimed a repo-recorded Figma version; Archive/NOT CURRENT frames `603:5380`, `996:5274`, `971:5301`, `971:6230`, `971:8101`, `56:135` were still flow starts.
- Current D-54 focused tests: first D-54 commit `cd4b7d5` passed 12/12 (TAP 166.162667 ms; guard 216 ms; peak RSS 976 KiB; one process). Closeout commit `91364cd` passed 13/13 (TAP 178.830167 ms; guard 228 ms; peak process-tree RSS 992 KiB; one process). Residual provenance/test commit `7b3607b` passed 13/13 (TAP 176.769375 ms; guard 226 ms; peak process-tree RSS 944 KiB; one process). This docs-only residual rerun of `npm run test:focused -- test/uiStudioScene.test.js test/uiPrimaryNavigation.test.js` passed 13/13 (TAP 149.699958 ms; guard 191 ms; peak process-tree RSS 912 KiB; one process).
- Current D-54 independent read-only review: pending. The first commit’s provenance-only Scene HTML change had no P0/P1/P2. The 2026-08-20 00:31 closeout is **not** independently PASS. Residual `7b3607b` closed the named copy/CSS/test residuals but is not pre-written as independent PASS. Unverified: full Current→Archive reaction scan (the prior whole-graph request ended in an HTTP 504 timeout; it has not been rerun successfully as a complete graph). Implementation self-check only.
- Current D-55 implementation: Studio deleted `.tiles-pixel-person` and exclusive CSS; empty copy uses `.tiles-empty-copy`. Local output dock title/lede/cards use human names and purposes; filenames are secondary; states map empty/ready/building/complete/failed/stale. `LOCAL_OUTPUTS` field mapping, `downloadTiledPair`, and unlock `phase === complete && localTilesResultIsCurrent(state)` are unchanged. Figma person nodes were not mutated.
- Current D-55 focused tests: `npm run test:focused -- test/uiStudioTiles.test.js test/uiPrimaryNavigation.test.js` passed 18/18 (TAP 221.382125 ms; guard 268 ms; peak process-tree RSS 912 KiB; one process).
- Current D-55 browser evidence: guarded Studio on `127.0.0.1:4173`. Live empty/ready in Chinese and English at the in-app browser (~1280×633): person count 0; overflow-x 0; cards have no href and `aria-disabled=true`; EN ready states are “Ready to build”. Headless Chrome 1135×998 Chinese empty shows a 2×2 human-label dock and no person. 390×844 fold still shows the existing 1036 px left form first; a taller 390 capture shows the text-only empty card. building/complete/failed/stale were **visual fixtures** only (dataset/status text); no real build, Provider call, or fake Job href. No new console errors observed in the live session.
- Current D-55 independent read-only review: pending. Implementation self-check only.
- Current D-56 implementation: shared `.studio-module-cta` tokens; Tiles empty/purpose/map-settings/density/solver labels; `constraint`/`seeded` values unchanged. No API/Job/Provider/exporter/route change. Figma person nodes were not mutated.
- Current D-56 focused tests: `npm run test:focused -- test/uiStudioModuleCta.test.js test/uiStudioTiles.test.js test/uiPrimaryNavigation.test.js test/uiStudioSequence.test.js test/uiStudioProject.test.js test/uiStudioCharacter.test.js` passed 66/66 (TAP 587.101417 ms; guard 632 ms; peak process-tree RSS 109808 KiB; 2 processes). Follow-up `test/uiStudioAction.test.js test/uiStudioScene.test.js test/uiStudioPromotion.test.js test/uiStudioCharacterAdvancedLocal.test.js` passed 35/35 (TAP 351.245041 ms; guard 399 ms; peak process-tree RSS 912 KiB; 1 process).
- Current D-56 Figma evidence: Current module CTAs restyled in place to 248×48 / `#0E7A6C` / radius 4. Mutated IDs include Character `655:3802` `660:3800` `685:3832` `663:3813` `686:3835` `688:3937` `645:3747` `996:5242` `701:4940` `702:4012` `709:4350` `704:4112` `706:4210` `711:4445`; Action `829:4588` `829:4956` `829:5324` `265:357` `829:5692` `830:4888` `829:6060` `829:6428` `996:6393` `996:6823`; Scene `650:3782` `946:4668` `946:4798` `946:4928` `1119:5420` `997:6723`; Project `646:3759` `998:5488`; Tiles footer `915:8213` `909:7725`; Sequence busy `870:5089` `894:4650`; UX recovery `998:5382`. Disabled/busy meaning kept on `711:4445` `946:4928` `998:5382` `998:5488`. Tiles Current copy nodes for 地图设置 / 宽度（格） / 高度（格） / 密度（覆盖程度） / 约束求解 / empty title-body-truth were rewritten on `603:4360` `909:6025` `909:7644` `910:4970` `911:4977` `911:6385` `997:5491`. Person nodes `915:8224`–`915:8227` and `997:6467`–`997:6470` remain visible. Archive, QA, Settings save, secondary/ghost/export, leftover clipped Tiles header `603:4433`/`997:5564`, and prototype destinations were not used as mutation targets.
- Current D-56 browser evidence: guarded Studio on `127.0.0.1:4174`. Headless Chrome 1135×998 Chinese `#tiles` shows no person; empty title 把地表素材变成可编辑的地图图块; 地图设置; 宽度（格）/高度（格）; density help; 约束求解; teal 开始编辑地图. `#character` local 开始处理 is the tall teal module CTA, darker while blocked. `#scene` 选择源图块 is the tall teal module CTA; export/header remain secondary. DOM checks: person=false; settings save is not `.studio-module-cta`. No POST/Job/Provider. Screenshots in `/tmp/tiles-d56-browser/`.
- Current D-56 independent read-only review: pending. Implementation self-check only.
- Current D-57 Figma evidence: Game-tool `ro8w6TKkpd969zW2V5bmkx`. Phase 1 removed only the 11 named Archive/SUPERSEDED `flowStartingPoints`; nodes kept. File-wide Present 65→54 (`0:1` 64→54, Archive page `215:167` 1→0). Post-write keep snapshot of the remaining 54 matched (`extra=[]`, `missing=[]`, `renamed=[]`). `706:4136` and `683:4154` remained Present starts. Phase 2 mutated only eight Rail `NAVIGATE.destinationId` values: `797:4760` `54:107`→`603:3340`; `797:4764` `54:1883`→`603:4360`; `797:4768` `56:135`→`650:3694`; `797:4772` `56:1916`→`646:3692`; `706:4148` `54:107`→`603:3340`; `706:4152` `54:1883`→`603:4360`; `706:4156` `56:135`→`650:3694`; `706:4160` `56:1916`→`646:3692`. Independent read-only re-verify: all eight destinations match; each keeps exactly one `ON_CLICK`+`NODE`+`NAVIGATE`; `rolledBack=false`; `706:4226` still destinations `221:2189` with one reaction; Present remains 54; `706:4136` and `683:4154` remain starts with parent `700:3836`; no node delete, move, or rename. No product-code change during the Figma writes. No verified Figma numeric version id or named History is recorded. This docs-only D-57 residual did not write Figma, run tests, build, or browser checks.
- Current D-52 Figma evidence: a whole-file Current/approved-UX scan found 69/69 visible Rail instances labeled 取帧 with parent name `Nav/取帧`. All ten Action canonical Current frames and both approved Action UX headers use 动作取帧. Current input and action nodes `835:4929` / `835:5017` read 添加动作素材 / 分析素材. Prototype destinations remain limited to the existing Current Action destinations `235:2223` and `829:4494`; hidden Source Set inventory and Archive v1 retain their historical wording and were not promoted to Current. Representative 1920×1080 frames `829:4494` and `829:4862` were visually re-read without clipping or overflow.
- Current D-52 Figma independent review: PASS with no P0/P1/P2. The review re-read every changed Current/approved-UX Rail and Action header, the two primary copy nodes, prototype destinations, and the Current versus hidden-inventory/Archive boundary.
- Current D-52 focused tests: `npm run test:focused -- test/uiStudioAction.test.js test/uiPrimaryNavigation.test.js test/uiStudioCharacter.test.js` passed 36/36 (TAP duration 316.948416 ms; guard elapsed 381 ms; peak process-tree RSS 272 KiB; one process). The initial sandboxed invocation stopped before test execution because the checked-in guard monitor could not spawn (`EPERM`); the successful run used the same resource guard and limits outside that sandbox restriction.
- Current D-52 browser evidence: the maintained HTTP Studio was checked in the existing in-app browser at 1135×998 and 390×844 in Chinese and English. Rail, page title, source object, primary CTA, and document title matched the approved D-52 vocabulary; the fixed 92 px English title slot ellipsized without shifting controls; document horizontal overflow was zero and console logs were empty. No upload, Job, Provider, or other POST action ran. The local server ran under `guard:full` and was explicitly stopped (elapsed 355910 ms; peak process-tree RSS 159184 KiB; two processes).
- Current D-47–D-50 Figma evidence: transactionally re-read Current nodes passed title-slot, crumb/search visibility, x=132 first-control, eight-item Rail/QA-utility, and Secondary-export checks. Representative frames are Character config `971:4596`, Character running `683:3795`, Action advanced `829:6334`, Tiles local `603:4360`, Scene complete `946:4702`, and Project UX `998:5408`. Action Current entry `829:6426` is hidden with zero reactions; `JobStage` instance `1084:5191` is visible without percentage text. The final bounded visual correction set is Tiles `915:8175`, `915:8209`, `915:8221`, Scene `946:4804`, `946:4810`, and Project selected Rail `1001:5727`; all were re-read after mutation. `603:5380` is not a D-47 Scene Current source; it is Archive / Historical v2 inventory. Retired Compatibility, Source Set, Tiles Provider, and other Archive frames were not changed
- Current D-47–D-50 focused verification: the broad Studio set passed 99/99 (TAP 891.288 ms; guard elapsed 940 ms; peak process-tree RSS 107472 KiB; 2 processes). Responsive/topbar follow-up passed 34/34 (TAP 279.227 ms; guard elapsed 327 ms; peak RSS 272 KiB; 1 process), and the Project/QA padding contract passed 5/5 (TAP 86.1845 ms; guard elapsed 134 ms; peak RSS 272 KiB; 1 process). After the final failure-copy/provenance repair, the latest-disk closeout set passed 59/59 (TAP 544.047834 ms; guard elapsed 592 ms; peak RSS 125312 KiB; 2 processes)
- Current D-47–D-50 browser evidence: a resource-guarded local server was inspected with the real in-app browser across all eight routes at 1920×1080 and 390×844 in Chinese and English. All eight Rail entries were visible in the accepted order; no route had document-level horizontal overflow, visible machine-status tokens, console warnings/errors, or page exceptions. Character measured 300 px at 1920 and 1009 widths before switching to a single 338 px column at 390; Sequence empty content remained inside the 390 px stage; Scene retained x=132 at narrow width; Project/QA retained 16 px topbar padding. No POST or Provider action ran. The guarded server was stopped explicitly (elapsed 308433 ms; peak RSS 157824 KiB; 2 processes)
- Current D-47–D-50 full guarded regression: final product commit `c1dc14a` passed latest-disk `npm test` 1236/1236 (TAP duration 110574.642834 ms; guard elapsed 110627 ms; peak process-tree RSS 820080 KiB; 5 processes)
- Current D-47–D-50 local smoke: final product commit `c1dc14a` passed latest-disk `npm run smoke:local` (guard elapsed 3609 ms; peak process-tree RSS 722576 KiB; 3 processes). Earlier sandboxed attempts stopped before execution because the guard monitor could not spawn (`EPERM`); successful runs used the same checked-in guard outside that sandbox restriction
- Current D-47–D-50 independent read-only review: final latest-disk PASS with no P0/P1/P2. The final two findings were closed by retaining a localized failure category plus concrete non-machine current-task response, and by separating Action/Character Current design provenance from hidden inventory and Archive evidence. The review ran no tests, build, server, browser, Provider call, or protected-directory inspection
- Current D-15 implementation: Character Compatibility runtime files `src/ui/studio/characterCompatView.js` and `src/ui/studio/characterCompatApi.js` and their exclusive tests were deleted after production references were cleared. Settings Provider Current states `978:5077`, `978:5218`, `978:5359`, and `1111:5317` are projected in Studio. Scene live generation prechecks `GET /api/gemini-state` and posts only a verified native `providerPresetId`. `/api/generate-character`, `/api/provider-config`, `/api/generate-scene-tiles`, Job, artifact, and Provider pipeline contracts are unchanged. Figma Archive Compatibility nodes were not deleted. Authority card `1099:5319` now records that D-15 synced Studio Current product code.
- Current D-15 focused tests: `npm run test:focused -- test/uiStudioCharacter.test.js test/uiStudioCharacterApi.test.js test/uiStudioCharacterAdvancedLocal.test.js test/uiStudioCharacterLocalApi.test.js test/uiStudioSettings.test.js test/uiStudioScene.test.js test/uiStudioSceneApi.test.js test/uiStudioProject.test.js test/uiCharacterPackStructure.test.js test/uiStudioPromotion.test.js test/serverRouteDispatch.test.js` passed 109/109 (guard elapsed 1089 ms; peak process-tree RSS 58112 KiB; 2 processes). After the Scene precheck P1 repair, `npm run test:focused -- test/uiStudioSceneApi.test.js test/uiStudioScene.test.js` passed 12/12 (guard elapsed 251 ms; peak process-tree RSS 576 KiB; 1 process).
- Current D-15 full guarded regression: the latest-disk `npm test` passed 1221/1221 (TAP duration 113.470 seconds; guard elapsed 113524 ms); peak process-tree RSS 829216 KiB across 5 processes. The count is below the pre-D-15 1234 because exclusive Compatibility tests were deleted.
- Current D-15 local smoke: the latest-disk `npm run smoke:local` passed in 3882 ms; peak process-tree RSS 718800 KiB across 3 processes. Studio HTML is asserted not to contain `character-compat-entry` or `character-compat-workspace`.
- Current D-15 browser evidence: resource-guarded real system Chrome passed 1920×1080 and 390×844 in Chinese and English. Character topbar has only Local and AI; AI workspace is hidden/inert/aria-hidden outside AI mode; Settings shows 保存配置, and the four Provider states were captured with Settings saved/failed/technical-details explicitly named `visual-fixture` (not live Provider results); Scene local import remains enabled while live generation locks without native Gemini. Keyboard Tab order Local→AI, focus-visible, and focus return to `character-flow-title` passed. Zero console warnings/errors, zero page errors, zero Provider POSTs, zero other non-GET requests. Guard elapsed 10757 ms; peak process-tree RSS 1688368 KiB across 12 processes. Screenshots: `output/playwright/studio-ux-d15-20260814`.
- Current D-15 independent read-only review: PASS after one P1 was closed. Initial finding: Scene Gemini precheck failures were treated as unknown live submission even though zero generate POSTs ran. Repair: `sceneSubmissionIsDefiniteRejection` treats `gemini_not_ready` and `gemini_preset_mismatch` as definite, and GET `/api/gemini-state` failures wrap as `gemini_not_ready` before any generate POST. Re-review found no remaining P0/P1/P2. Checklist: no protected API/server/pipeline changes; no Compatibility Current residue; Settings copy matches session-replace / not-generation-ready truth; Scene cannot bypass the native Gemini gate; docs and Figma Authority `1099:5319` no longer say product code is unsynced. The review ran no tests, builds, server, browser, or Provider call.
- Current D-15 verification: focused, full, smoke, real-browser, and independent review evidence above; Provider call count 0; final human visual acceptance remains pending.
- D-15 P2 closeout design gap: Figma Settings Current frames `978:5077`, `978:5218`, `978:5359`, and `1111:5317` still cover configure / session-saved-not-enabled / save-failed / technical-details. They do not include a dedicated environment-detected OpenRouter state or an active-OpenRouter-plus-eligible-Gemini-preset state. This session could not re-open the Figma MCP write path, so those two states are recorded as missing Current frames rather than invented layouts. Scene lock copy remains `1119:5324`; the 1920 px English crumb/badge clip is a CSS overflow fix against that existing Current copy.
- Current D-15 P2 focused tests: `npm run test:focused -- test/uiStudioSettings.test.js test/uiStudioScene.test.js test/uiStudioSceneApi.test.js` passed 18/18 (TAP duration 300.145 ms; guard elapsed 350 ms; peak process-tree RSS 1088 KiB; 1 process). Coverage includes pure Gemini, session OpenRouter, environment OpenRouter, active OpenRouter plus eligible native Gemini, and rejected `../escape` preset ids.
- Current D-15 P2 browser evidence: resource-guarded real system Chrome passed 1920×1080, 1135×1080, and 390×844 in Chinese and English. Scene English crumb `· Native Gemini unavailable` and badge `Online generation locked` are unclipped at 1920; both nodes are `display:none` at 1135 and 390; no horizontal overflow, missing status ARIA, console warning/error, or page exception. Empty-env Settings live copy does not claim saved/replaced. Environment, session-saved, and mixed OpenRouter+Gemini Settings states were injected as labeled `visual-fixture` captures, not live Provider results. Provider POST count 0; other non-GET count 0. Guard elapsed 12718 ms; peak process-tree RSS 1698096 KiB across 12 processes. Screenshots: `output/playwright/studio-ux-d15-p2-20260814`.
- Current D-15 P2 independent read-only review: **withdrawn**. The earlier unconditional PASS is not current. Final review found that `generationReady` still treated top-level `provider === 'gemini'` as a shortcut, and environment OpenRouter with real hydration (`selectedAdvancedRoute=null`) could still present saved / session-replaced copy through the route-undisclosed branch.
- Current D-15 review-fix product code: `7a7b3d42894aa02062b7942fd8676905a82d3940` (`fix(studio): fail-close settings ready on native presets`). Settings generation-ready now follows only eligible native Gemini presets. Environment OpenRouter is classified before the route-undisclosed branch. This docs closeout is a later commit and is not that product-code hash.
- Current D-15 review-fix focused tests: `npm run test:focused -- test/uiStudioSettings.test.js test/uiStudioScene.test.js test/uiStudioSceneApi.test.js` passed 18/18 (TAP duration 312.734 ms; guard elapsed 363 ms; peak process-tree RSS 640 KiB; 1 process).
- Current D-15 review-fix browser evidence: resource-guarded real system Chrome passed 1920×1080, 1135×1080, and 390×844 in Chinese and English. Scene English crumb/badge remain unclipped at 1920 and hidden at 1135/390. Settings negative states `geminiEmpty` and `environmentUndisclosed` were labeled `visual-fixture` captures, not live Provider results. Provider POST count 0; other non-GET count 0. Guard elapsed 11767 ms; peak process-tree RSS 1692864 KiB across 12 processes. Screenshots: `output/playwright/studio-ux-d15-review-20260814`.
- Current D-15 review-fix independent read-only review: **withdrawn as a final unconditional no-P2 PASS**. That review closed the Settings preset-shortcut and environment-OpenRouter copy defects, but D-06/D-14 still said “twelve” Current/override frames.
- Historical D-15 final-acceptance independent read-only review: PASS for that closeout after the then-current ledger was corrected to 11 Current/override + 1 pre-D-15 Archive evidence. D-41 later retired Tiles Provider evaluation, so the present ledger is 10 Current/override + 2 Archive evidence frames. No product-code, API, Figma, or Provider-pipeline change was part of that historical docs review. Human visual acceptance remains pending.
- Current D-15 final-acceptance full guarded regression: latest-candidate `npm test` on `dc30496` (product code `7a7b3d4`) passed 1222/1222 (TAP duration 123308.644 ms; guard elapsed 123357 ms); peak process-tree RSS 825312 KiB across 5 processes.
- Current D-15 final-acceptance local smoke: latest-candidate `npm run smoke:local` on the same tree passed in 4563 ms; peak process-tree RSS 709936 KiB across 3 processes.
