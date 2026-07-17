# Targeted Frame Repair v1 Closeout

**Date:** 2026-07-11
**Status:** Deterministic MVP implemented and verified; live first-call quality remains Experimental/opt-in
**Branch:** codex/targeted-frame-repair-v1
**Implementation base:** 427d056 (the implementation plan on main; the approved design was 1bb606e)
**Implementation range:** fa5e987 through 4b85c97
**Worktree used for verification:** <workspace>/.worktrees/targeted-frame-repair-v1

This runbook is the operational and release boundary for the first targeted
single-frame repair workflow. It records what was actually implemented and
verified. It does not authorize a real provider benchmark, promise semantic
diagnosis, or claim that the first generated candidate will be visually good.

## 1. Release Decision And Scope

The deterministic safety MVP is ready for review:

- one real managed Character Pack frame is selected by clip position and sheet
  frame index;
- a bounded canonical mask is derived on the server and refined by ordered Add
  or Remove rectangle edits;
- Review builds a provider-free, hash-bound Plan;
- one confirmed operation can dispatch at most one provider request and produce
  one candidate;
- local composition preserves all non-target pixels and all target pixels
  outside the mask in decoded RGBA space;
- complete evidence is sealed before a candidate can become reviewable;
- specialized Accept re-verifies the sealed job and creates one immutable child
  revision with processing_recipe_ref set to null;
- failures, conflicts, close, and Discard do not mutate project JSON or history.

The live effect remains Experimental/opt-in. The configured browser fixture had
no available provider preset, so the real-render session stopped after a
provider-free Plan. No real provider call or quota was used. One-call live
generation, candidate hydration, integrity gates, warning acceptance, restart
recovery, and specialized Accept are covered by injected deterministic tests,
but the candidate/result/Accept path was not exercised end-to-end in the
browser. A separately authorized 8-12 call first-call benchmark is still
required before any broad quality or production-readiness claim.

## 2. Design Sources And Deviation Log

The capability and UI source of truth was the accepted Editor Workspace and
Character Finishing Workbench on main. The three approved local visual
explorations under .superpowers/brainstorm/4735-1783751584 were used only to
confirm layout direction and were not staged or shipped.

| Approved decision | Implemented result | Deviation |
| --- | --- | --- |
| Repair Frame temporarily replaces the right Recipe content | Existing Recipe rail/drawer is reused; Canvas and filmstrip remain mounted | None |
| Four-stage progressive flow | Target & Mask, Review AI Call, Processing, and Result & Validation are stable headings; only the current body expands in an internal scroll region | No capability deviation; this is the bounded-height implementation detail |
| Result review reuses Canvas comparison modes and the filmstrip | Existing Before/After/Split/Difference/Onion, zoom, anchor/bounds overlays, and clip playback are reused; one actual candidate frame receives an R badge | None |
| Narrow layout reuses the existing Recipe drawer | 390 px uses the existing backdrop, focus trap, Escape handling, and focus return | None |
| One deterministic browser candidate and Accept without provider spend | Runtime preset was unavailable; browser verification stopped after Plan | Open verification limitation; deterministic API/controller/service/Accept tests cover the path |

Real-render verification found and fixed two issues before closeout: a false
Repaired candidate badge before a candidate existed, and a desktop rail whose
four stage headings could fall below the viewport. Neither remains an accepted
design deviation.

No external code, UI, wording, prompt, template, asset, binary, or private
behavior was used. The implementation is original and uses neutral internal and
public names.

## 3. Runtime Contract

### Routes

All routes are under the existing Editor namespace and require safe encoded
project/asset/job/operation identities.

| Method and route | Result | Provider/project effect |
| --- | --- | --- |
| POST /api/editor/projects/:projectId/assets/:assetId/frame-repair/plan | 200 with canonical Plan, hash, diagnostics, and can_run | Zero provider calls; zero project mutation |
| POST /api/editor/projects/:projectId/assets/:assetId/frame-repair | 202 with the persisted operation winner/job | At most one provider call after exact confirmation; zero project mutation |
| GET /api/editor/projects/:projectId/assets/:assetId/frame-repair/operations/:operationId | 200 with the exact original operation/recovered job | Never enqueues or retries |
| POST /api/editor/projects/:projectId/assets/:assetId/frame-repair/:jobId/accept | 200 with accepted project/asset/revision | The only project-mutating route |
| GET /api/jobs/:jobId | Existing polling route | Read-only; unchanged |
| GET /api/gemini-state | Existing safe provider-state route | Public preset facts only; no key |

The live body must repeat the exact Plan fields and add operationId,
expectedPlanHash, confirmLiveGeneration: true, and maxProviderCalls: 1.
Accept requires expectedRevision, expectedAssetRevisionId, expectedPlanHash,
and a boolean warningConfirmed.

### Fixed artifact set

The sealed job contains the inherited Character Pack outputs:

- source.png, source_layout_overlay.png, normalized_sheet.png, and
  multi_resolution.json;
- normalized_sheet_96.png, normalized_sheet_64.png,
  normalized_sheet_48.png, normalized_sheet_32.png, and
  normalized_sheet_16.png;
- animations.json, metadata.json, editor_metadata.json, debug_report.json,
  debug_overlay.png, onion_skin_overlay.png, inspection_index.json, and
  inspection_sheet.png;
- godot_npc_pack.zip, rpgmaker_pack.zip, ocad_pack.zip, and
  character_pack.zip.

It also contains exactly these repair-specific files:

- frame_repair_plan.json;
- editor_frame_repair_context.json;
- target_before.png;
- frame_repair_mask.png;
- frame_repair_context.png;
- raw_provider_output.png;
- normalized_candidate_frame.png;
- composited_candidate_frame.png;
- frame_repair_difference.png;
- frame_repair_quality.json;
- frame_repair_prompt.txt;
- patched_normalized_sheet.png.

Only controlled inspection_gifs and inspection_strips subdirectories may be
referenced in the inherited preview set. The outer integrity manifest binds the
complete fixed set. The browser hydrates only controlled artifact URLs.

### Durable operation ledger

The private ledger root is:

    <workspaceRoot>/.operations/frame-repair/

Each record filename is the SHA-256 of project_id, a NUL separator, asset_id, a
NUL separator, and operation_id. It is never caller-provided and never lives
under generated/. The exact record contains scalar identity, status, call
accounting, timestamps, controlled failure text, and an optional terminal
artifact-manifest digest. It contains no instruction, prompt, mask, image,
provider credential/runtime object, filesystem source path, or project JSON.

| Operation status | Job status | Calls used | Provider outcome | Meaning |
| --- | --- | ---: | --- | --- |
| reserved | queued | 0 | not_dispatched | Durable winner exists; no provider call |
| dispatched | generating | 1 | unknown then known | Budget is consumed before dispatch; no retry |
| post_processing | post_processing | 1 | known | Normalize, mask composite, package, validate, seal |
| done | done | 1 | known | Manifest digest is durable; candidate may be hydrated |
| failed | failed_model_error / failed_post_processing / failed_safety_filter | 0 or 1 | not_dispatched / known / unknown | Terminal failure or conservatively uncertain outcome |

Recovery classifies a durable terminal record as terminal, a one-call uncertain
record as outcome_unknown, and a zero-call reserved interruption as
interrupted_before_dispatch. Recovery performs no provider submission.

## 4. UI-To-Runtime Binding Audit

| UI control or event | Browser/controller action | Request/provider/pipeline binding | Project mutation |
| --- | --- | --- | --- |
| Repair Frame | Snapshot the real selected clip position, sheet frame, parent revision, Workbench view, and safe provider metadata | Managed artifacts are read through controlled URLs; no Plan/live call | No |
| Add/Remove rectangle, drag, rectangle inputs, Undo | Update ordered ephemeral mask edits and provisional mask; invalidate a pending Plan | No request and no provider call | No |
| Repair instruction | NFC-trim/cap locally; invalidate Plan | No request until Review | No |
| Provider preset / image size | Select only safe public preset id and 1K/2K config; invalidate Plan | No key and no implicit fallback | No |
| Review AI Call | Build one canonical provider-free Plan and display exact target/mask/context/model/call/hash facts | One Plan POST; server re-resolves managed authority and exact preset; zero provider calls | No |
| Generate one candidate | Allocate one operation id synchronously and submit the reviewed hash once | One live POST; shared queue, durable ledger, exact provider adapter, one candidate, local normalization/composite/package/seal | No |
| Recover original operation / reload | Query the exact scoped operation handle | One GET; no POST, enqueue, retry, or fallback | No |
| Before/After/Split/Difference/Onion, zoom, anchor/bounds | Reuse the Workbench renderer and already hydrated evidence | Local render only; no fetch/decode/hash/layout read in the draw path | No |
| Clip selector, filmstrip navigation, playback | Reuse real clip metadata and candidate sheet; repaired badge appears only after candidate hydration | Local state/playback only | No |
| Warning confirmation | Bind acknowledgement to the exact job id and Plan hash | No request until Accept | No |
| Accept revision | Deduplicate exact Accept and ignore late/stale results | One specialized Accept POST; lock, sealed evidence/pixel re-verification, immutable child import; never general import | Yes, only on success |
| Discard candidate | Stop observation, clear local candidate/recovery acknowledgement, restore Workbench | No provider cancellation/retry and no artifact deletion | No |
| Close, project/asset switch, teardown | Abort local observation/hydration, clear pointers/timers, preserve recoverable submitted operation | No implicit provider retry | No |

## 5. Capability Truth

| Capability | Status | Boundary |
| --- | --- | --- |
| Managed Character Pack normalized-frame targeting | Implemented | Imported, quality-gated managed character assets only |
| Rectangle mask editing and canonical runs | Implemented | Add/Remove rectangles only; no brush, lasso, polygon, or pixel editor |
| Server-owned identity, mask, Plan, and hash | Implemented | Client images/paths are never authoritative |
| Provider-free preflight | Implemented | Provider-unavailable returns can_run false and a real diagnostic |
| One-call deduplication and durable recovery | Implemented | No automatic retry or provider-family fallback |
| Mask-constrained decoded-RGBA composite | Implemented | Provider output outside the mask is discarded locally |
| Full package rebuild from exact patched normalized sheet | Implemented | Does not call the normal process-sheet pipeline or fabricate a Processing Recipe |
| Pass/warning/fail/unknown acceptance policy | Implemented | Only complete pass/warning evidence can accept; warning needs exact confirmation |
| Semantic anatomy/prop/action diagnosis | Not implemented | Instruction remains user-authored; validators measure structural/pixel/continuity evidence |
| Mask-native provider inpainting | Not required | Provider proposes a frame; deterministic local composition enforces the mask |
| Fixed-region source reverse projection | Not implemented | v1 repairs the managed normalized runtime sheet |
| Multiple candidates, blending, retry, auto-accept | Not implemented | Intentionally excluded |
| Live first-call visual quality | Experimental/opt-in | No authorized benchmark or browser candidate evidence yet |

## 6. State, Failure, And Recovery Behavior

- Pass: complete evidence can Accept.
- Warning: candidate stays reviewable; the user must confirm the exact job and
  Plan hash before Accept.
- Fail or unknown: candidate evidence may remain inspectable, but Accept is
  blocked.
- Provider unavailable: Plan remains provider-free and can_run is false.
- Model/safety failure: the single attempt is terminal and is never retried
  automatically.
- Post-processing failure: the parent is unchanged; diagnostic evidence and
  retry guidance remain explicit where safe.
- Project conflict: reload the project; no late acceptance may mutate it.
- Asset revision conflict: reopen against the current immutable parent.
- Selection switch: late Plan/job/artifact results are ignored.
- Outcome unknown: use Recover original operation. Do not click Generate for a
  new operation until the original result is resolved or explicitly discarded.
- Browser reload: only a minimal scoped operation handle is retained; it has no
  Plan body, image, prompt, credential, or path.
- Server restart: the direct ledger record plus the fixed Context and two-level
  sealed manifest reconstruct the same operation without enqueueing.
- Close: detaches observation but preserves a submitted operation for recovery.
- Discard: clears the local review/recovery state and restores the previous
  Workbench view. It does not delete evidence or mutate the project.
- Accept uncertainty: keep the recovery handle and reload before retrying.

## 7. Verification Evidence

### Automated checks on implementation commit 4b85c97

| Check | Result | Test duration / guard elapsed | Peak process-tree RSS |
| --- | --- | --- | ---: |
| Task 13 UI-focused set | 132 / 132 passed | 3.668 s / 3.718 s | 758128 KiB |
| Final 18-file contract set | 255 / 255 passed | 27.555 s / 27.603 s | 425200 KiB |
| Full npm test | 1185 / 1185 passed | 121.777 s / 121.809 s | 3850272 KiB |
| Local smoke against 127.0.0.1:4173 | Passed: tabs, editor shell, safe provider state, 267-byte GIF API, scene/project/2.5D APIs, and Frame Repair markers | 2.795 s | 102640 KiB |

All tests were serial and ran through scripts/run-with-resource-guard.mjs. The
focused ceiling was 1024 MiB V8 old-space, 1536 MiB process-tree RSS, and 60
seconds. Full/smoke used 2048 MiB V8 old-space and 4096 MiB process-tree RSS
with finite timeouts. No resource ceiling was exceeded.

The smoke server was tracked under the guard, stopped with SIGINT after the
client passed, and its exact process tree exited. A final lsof check found no
listener on TCP 4173.

### Real-render browser evidence

The fixture was created through existing APIs and used project revision 2,
asset asset_frame_repair_hero, and parent revision rev_001. No external package
asset was imported.

| Viewport | Observed evidence |
| --- | --- |
| 1440 x 900 | Document and Workbench ended at the viewport with no page overflow. Canvas occupied 1100 px while the existing Recipe rail remained 340 px; the Frame Repair content rail was 315 px. All four headings were visible. A real Canvas drag produced Add at 65,30 with size 26 x 31, and no false repaired badge appeared before a candidate. |
| 2048 x 963 | Document matched 2048 x 963. Canvas occupied 1708 x 497 CSS pixels with a 3416 x 994 backing store and pixelated nearest-neighbor rendering. Recipe remained 340 px, the four headings remained visible, and the current stage used internal vertical scroll without horizontal stretch. |
| 390 x 844 | Document scroll width stayed exactly 390 px. Workbench, Canvas region, Canvas, and filmstrip were each 390 px wide. Open drawer was about 358.8 px wide at x=31.2 and ended at x=390; backdrop was 390 x 844. The four heading bottoms were 170, 205, 240, and 275 px. Drawer/rail/stage content had no horizontal overflow. Vertical drawer scrolling remained available. |

The mobile focus set contained 15 active controls and included the instruction
textarea. Shift-Tab from the first Close control wrapped to the final Review
control; Tab wrapped back to Close. Escape and a backdrop click at x=10, y=400
both closed the drawer, restored focus to Frame Repair, set aria-expanded false,
restored inert plus aria-hidden, and re-enabled Canvas/filmstrip interaction.

Browser console warnings/errors were an empty list. Local mask/instruction edits
and the single Review left project revision 2 and active asset revision rev_001
unchanged. Review returned a provider-free Plan with one estimated/max call and
the configured unavailable preset; Generate was truthfully disabled. No live or
Accept browser request was made.

## 8. Protected Surfaces, Fallbacks, And Residual Risk

The implementation range changed no file under src/character-pack/. Therefore
the existing process-sheet/frame pipeline, validator, provider adapters/config,
engine exporters, shared job queue, and shared job status enum remain unchanged.
The feature adds an Editor-specific coordinator/service/ledger and reuses those
existing boundaries.

package.json, lockfiles, and ATTRIBUTIONS.md are unchanged. No dependency,
bundled asset, binary, model weight, template, or public schema attribution was
added. Accepted output keeps existing Godot, RPG Maker, and OCAD package
contracts without changing their exporters.

Fallback behavior is fail-closed:

- missing, malformed, oversized, symlinked, mismatched, or unsafe managed
  artifacts block the flow;
- unavailable provider configuration disables Generate rather than selecting a
  different preset;
- stale Plan, project, asset, frame, or manifest identity blocks without
  mutation;
- an uncertain one-call result remains recoverable and never becomes a retry;
- no Frame Repair UI state writes directly to project JSON, scene history, or
  the persistent editor camera.

Final static and binding scans were reviewed rather than treated as a
zero-output-only gate:

- git diff --check had no findings;
- the unfinished-marker scan matched only the intentional pendingFile staging
  helper used to bind bytes, size, and digest before exclusive writes;
- the restricted-name scan matched only a security-test assertion that proves
  generated prompts exclude external product names; no restricted product or
  module name was added;
- secret-literal scanning found no credential or bearer literal. The only
  apiKey assignments are the server-private resolved-preset handoff into the
  exact provider adapter; PUBLIC_SCALARS allowlisting and dedicated tests prove
  that private runtime never enters public jobs, plans, packages, or browser
  state. selectionToken hits are late-result generation guards, not
  credentials;
- normalizedCharacterSheetPackage.js has no processSheet or
  processSheetBuffer import/call;
- Frame Repair source has exactly one generateCandidate dispatch site. Other
  retry/fallback hits are controlled retry_hint metadata, fail-closed UI copy,
  or display-value fallback helpers; there is no automatic provider retry or
  provider-family fallback;
- frameRepairOperationLedger.js contains no generated path reference;
- frameRepairCanvas.js contains no fetch, decode, hash, DOM geometry, or layout
  read in its draw path;
- no package/lock/ATTRIBUTIONS file, src/character-pack file, or direct UI
  project-write pattern changed.

Residual risks:

1. First-call visual improvement and semantic correctness are unmeasured. Keep
   live entry Experimental/opt-in.
2. Browser result-review and specialized Accept still need a deterministic
   real-render harness or an explicitly authorized provider gate.
3. Rectangle masks are intentionally coarse for very small details; freehand
   editing is out of scope.
4. Evidence/package generation is bounded but can still approach the ordinary
   full-suite memory envelope; retain resource guards.
5. Acceptance copy/save failures can preserve an orphan revision directory for
   audit safety while leaving project JSON unchanged; cleanup remains a manual,
   non-destructive maintenance decision.

## 9. Repeatable Closeout Commands

Run only through the repository resource guard and only one runner at a time:

    npm run test:focused -- <the 18 Frame Repair test files in the implementation plan>
    npm test

For smoke, first start a tracked guarded server:

    npm run guard:full -- node server.js
    npm run smoke:local -- --base-url http://127.0.0.1:4173

Stop the exact server session after smoke and confirm TCP 4173 has no listener.
Do not run the post-MVP live quality gate without explicit preset, asset-rights,
and 8-12 call-budget authorization.

## 10. 2026-07-12 Bounded Live Pilot And Safe Diagnostics

A later, separately authorized pilot used one synthetic managed Character Pack
fixture, one selected `walk_down` frame, one bounded mask, the `gemini31`
preset, and exactly one provider call. The operation recorded one used call out
of one, ended `failed_model_error`, produced no candidate, did not retry during
recovery, and left project revision 2, active revision `rev_001`, project JSON,
history, and selection unchanged.

The historical record persisted only `provider_failed` with an unknown outcome,
so the exact remote cause cannot be reconstructed and must not be inferred.
Future Frame Repair operations preserve only the safe structured taxonomy in
the protocol. The Processing rail shows fixed local copy for those codes and
never displays remote free text.

Operator handling remains conservative:

- known authentication, quota, route, rate, request, service, and output
  failures may show a local next-check hint;
- transport and generic unknown outcomes require recovery of the original
  operation before any new decision;
- no hint, recovery action, refresh, close, or project switch authorizes a new
  provider call;
- another live request requires separate human authorization and the normal
  provider-free Review plus one-call confirmation flow.

## 11. 2026-07-14 Fixed-Region Failure Evidence

A separately authorized fixed-region action test first generated one source
sheet with Gemini, then imported it as managed project
`project_teal_ranger_fixed_v15_20260714`. The user reviewed an `idle_left`
position-0 Plan and explicitly authorized operation
`fr_idleleft_v15_20260714_001`. Job `job_mrjeg44c_2d4dk0` used one call out of
one and returned one image candidate, but local normalization ended
`failed_model_error` / `provider_candidate_invalid`. There was no retry or
second candidate, and project revision 2 with active asset revision `rev_001`
remained unchanged.

That job predates subtype evidence. Its persisted generic
`inspect_provider_output_contract` hint and empty failed-job directory cannot
prove whether the local cause was invalid decoding, a full sheet, an empty
subject, or multiple subjects. Do not relabel that historical job by
inference.

Future allowlisted normalization failures use these operator steps:

1. Read `<generated-root>/<job-id>/provider_failure.json`. Treat only its exact
   `normalization_code` and fixed preview metadata as diagnostic evidence.
2. If `provider_failure_preview.png` exists, inspect it as a bounded,
   re-encoded PNG. It is not the original response bytes, a candidate, an
   importable asset, or Accept input.
3. If `preview` is null and the PNG is absent, the candidate could not be
   decoded safely. Do not search for or reconstruct raw provider payloads.
4. Keep the operation terminal. Never convert inspection, recovery, refresh,
   close, or a subtype hint into an automatic retry.
5. If the user wants another call, perform a new provider-free Review, allocate
   a new operation id, and obtain a separate explicit confirmation.

The subtype and preview implementation was verified only with deterministic
local fixtures. It made no provider request and does not establish real
provider quality.

## 12. 2026-07-14 Gemini Native Transport Evidence

A later separately authorized test reused the same managed fixed-region source,
targeted `idle_left` position 0 / sheet frame 8, selected the `gemini-native`
`gemini-3.1-flash-image-preview` preset at 1K, and used exactly one call.
Operation `fr_822cfb15e85b95336ce42871edc1348f`, job
`job_mrjhcu8x_vo8vec`, ended `transport_outcome_unknown` with one call used out
of one. Recovery returned the same durable unknown outcome, no candidate or
failure preview existed, and active revision `rev_001` remained unchanged.

That job predates provider-request evidence version 2. DNS, TCP, and TLS checks
performed after the terminal result cannot reconstruct the request failure and
must not be used to relabel it. It remains an unknown transport outcome.

Future provider-phase failures use these operator steps:

1. Recover the original operation first. Recovery never authorizes or performs
   another provider call.
2. Read only `<generated-root>/<job-id>/provider_failure.json` for the exact
   failed job. For `failure_stage: provider`, use only the fixed `reason`,
   `provider_outcome`, allowlisted `error_name`, allowlisted `connection_code`,
   and integer `http_status` fields. Null means no safe value was captured.
3. Expect `normalization_code: null`, `preview: null`, and no
   `provider_failure_preview.png` for provider-request failures.
4. Never search for a request, response body, error message, headers, key,
   stack, URL, or raw provider payload; version 2 intentionally persists none
   of them.
5. Keep the one-call operation terminal. Any later live attempt requires a new
   provider-free Review, a new operation id, and separate explicit approval.

Provider-request evidence is verified with deterministic local exceptions and
does not itself call or validate a real provider.

## 13. 2026-07-14 Stable Flash Reference-Bundle Evidence

A separately authorized one-call comparison selected Gemini native model
`gemini-3.1-flash-image` with the same managed project, `idle_left` position 0,
sheet frame 8, 1K image configuration, instruction, and 1,035-pixel user mask.
Operation `fr_88d2927fa8fe633d32f1f317c8fe0788`, job
`job_mrjk90av_r0pus5`, used one call out of one and returned a decodable image,
but local normalization correctly ended `failed_model_error` /
`provider_candidate_invalid` with
`normalization_code: provider_output_multiple_subjects`. The bounded diagnostic
preview showed that the model reproduced many sheet and context poses around a
large target subject. There was no retry, candidate, Accept, or project
mutation.

The provider input contract was therefore narrowed without spending another
call. New Plans send only the enlarged target, mask visualization, and one
enlarged adjacent frame, all with identical nearest-neighbor authoring-cell
geometry. The full managed sheet remains local authority and is never provider
input; the context image is no longer a previous-target-next contact sheet. The
fixed prompt identifies the first image as the sole layout authority and
forbids sheets, grids, repeated characters, multiple poses, checkerboards, and
colored mask backgrounds. Deterministic regression tests verify this reference
order and context geometry, but do not establish that a future provider
response will satisfy the contract.

## 14. 2026-07-14 Narrow Reference-Bundle Provider Evidence

A separately authorized post-hardening test used the narrowed three-image
reference bundle with Gemini native model `gemini-3.1-flash-image`, the same
managed project, `idle_left` position 0 / sheet frame 8, 1K configuration, and
the 1,035-pixel mask. Plan
`66a83d782686c2284002770f36ca9dc1c560e2769aa369c146df3119d654a588`
allowed exactly one call. Operation
`fr_08ee9ee1a84e01064bc10bbc288f76d8`, job
`job_mrkbngr2_tdvpbc`, used that one call and ended
`failed_model_error` / `provider_failed` with `provider_outcome: unknown`.
It produced no candidate, manifest, or diagnostic preview. Recovery returned
the same terminal operation, and project revision 2 with active asset revision
`rev_001` remained unchanged.

The version-2 provider failure evidence recorded null `error_name`,
`connection_code`, and `http_status`. It therefore cannot prove an API-key,
quota, model, HTTP, transport, or local request-construction cause, and it must
not be relabeled by inference. This attempt also provides no provider-quality
evidence for or against the narrowed reference bundle because no candidate was
returned.

A provider-free follow-up found that the diagnostic extractor retained only an
own `name` field, while native `Error` and `TypeError` names are inherited.
The extractor now follows a bounded prototype chain using data descriptors
only, stops on accessors or unsafe prototypes, and still writes only the fixed
allowlist. The version-2 schema is unchanged. Historical null evidence remains
null; a future separately authorized call would be required to observe the
improved classification against a real provider.
