# Frame Repair Live Quality Gate v1 Runbook

**Date:** 2026-07-13

**Status:** Implementation closeout complete; live provider quality remains unverified

**Protocol:** `docs/protocols/editor-frame-repair-quality-gate-v1.md`

**Design source:** `docs/superpowers/specs/2026-07-12-frame-repair-live-quality-gate-design.md`

This runbook has two deliberately separate operating lanes:

1. **Implementation verification** is provider-free and is the only lane
   authorized during implementation closeout.
2. **Live pilot** may use at most eight provider calls, but begins only in a
   later task after a separate explicit authorization packet is complete.

Completing tests, smoke, or browser checks does not authorize the live pilot.
Completing the live pilot does not by itself establish broad production
quality. The only valid quality claim is the exact result and evidence boundary
published by that one sealed session.

## 1. Fixed Operating Boundary

The session contains exactly eight cases:

- two repository-generated deterministic controls;
- six explicitly selected, user-owned Character Packs from one source Editor
  project;
- exactly two basic, four medium, and two hard cases;
- one exact configured/capability-eligible preset and one image size;
- at most one explicit Generate call per case and eight calls total.

The gate adds no bulk run, automatic next case, retry, fallback, model switch,
or automatic visual score. Every case proceeds sequentially through the
existing provider-free Frame Repair Plan, one explicit Generate confirmation,
original-operation recovery when needed, blind review, revealed functional
verdict, and specialized Accept or explicit Reject.

Setup exclusively creates one isolated target project and is the only new
quality-gate project-creation authority. Successful specialized Accept may add
one child revision only in that target. No quality-gate action may mutate the
source project.

## 2. Lane A — Zero-Call Implementation Verification

### 2.1 Preconditions

- Work only in the designated implementation worktree and branch.
- Preserve all existing changes; do not reset, replace, or remove them.
- Do not scan `output/`, `generated/`, or workspace project roots.
- Do not enter provider credentials, click Generate, or call a live Frame
  Repair endpoint.
- Run only one guarded test/build/server process at a time.
- Focused runs use the repository supervisor with 1024 MiB V8 old-space,
  1536 MiB process-tree RSS, and a 60-second timeout.
- Full suite and smoke use 2048 MiB V8 old-space, 4096 MiB process-tree RSS,
  serial execution, and the checked finite timeout.
- On timeout, continuous growth, memory pressure, an unresponsive process, or
  any resource-limit breach, stop the exact process group immediately. Do not
  automatically rerun.

### 2.2 Static audit

Run the four read-only audits from the implementation plan, then
`git diff --check`. Review each match in context; a non-empty result is not
automatically acceptable.

The required conclusions are:

- no quality-gate server module dispatches, queues, or submits provider work;
- no quality-gate module enumerates artifact roots or ingests credentials,
  environment provider configuration, raw remote text, or encoded image data;
- no restricted product branding or comparative substitution claim exists;
- no whitespace error exists.

### 2.3 Focused verification groups

Run these commands serially and exactly through the guard:

```bash
npm run test:focused -- test/editor-project/editorFrameRepairQualityGateProtocol.test.js test/editor-project/editorFrameRepairQualityGatePlan.test.js test/editor-project/editorFrameRepairQualityGateControls.test.js
npm run test:focused -- test/editor-project/editorFrameRepairQualityGateAssets.test.js test/editor-project/editorFrameRepairQualityGateEvidence.test.js test/editor-project/editorFrameRepairQualityGateCoordinator.test.js
npm run test:focused -- test/editor-project/editorFrameRepairQualityGateApi.test.js test/editor-project/editorFrameRepairQualityGateServerWiring.test.js
npm run test:focused -- test/editor-project/editorFrameRepairQualityGateState.test.js test/editor-project/editorFrameRepairQualityGateController.test.js
npm run test:focused -- test/editor-project/editorFrameRepairQualityGatePanel.test.js test/editor-project/editorRepairWorkbenchPanel.test.js
npm run test:focused -- test/editor-project/editorFrameRepairLifecycle.test.js test/editor-project/editorFrameRepairController.test.js test/editor-project/editorRepairWorkbenchController.test.js
npm run test:focused -- test/editor-project/editorRepairArtifactClient.test.js test/editor-project/editorShellStructure.test.js
```

All provider states, operations, jobs, candidates, accepted revisions, and
artifacts in these tests are injected deterministic fixtures. A test must not
read local provider credentials or call the provider adapter.

### 2.4 Full suite and smoke

Run the full suite **once** after all focused groups pass:

```bash
npm test
```

Do not rerun after a resource breach or hang. Identify and change the smallest
responsible focused lifecycle/fixture first.

Then run the local smoke **once**:

```bash
npm run smoke:local
```

Smoke may verify served modules/CSS, health, the ordinary Editor, the ordinary
Frame Repair entry, safe provider-unavailable state, and provider-free Setup
only when the harness supplies an exact isolated fixture. It must not fabricate
a passed quality report or dispatch a provider request.

### 2.5 Browser verification

Start one tracked server under the exact bounded supervisor on one confirmed
free port. Use the already-open in-app browser; do not spawn another browser
process.

```bash
PORT=57231 node scripts/run-with-resource-guard.mjs --max-old-space-mib 1024 --max-rss-mib 1536 --timeout-ms 600000 --poll-ms 500 -- npm start
```

If that port is occupied, select one other explicit free port before starting.
Never start two servers. Verify without a live candidate at:

- 1440×900;
- 390×844.

At desktop, verify Setup/authoring/provider-unavailable states, bounded Canvas,
evidence rail, progress strip, focus, disabled reasons, live announcements,
keyboard strip navigation, reduced motion, and ordinary Frame Repair open/close.
There must be no overlap, clipping, content behind shell chrome, large blank
page region, horizontal overflow, or console error.

At mobile, verify readable progress/report/diagnostics and visibly disabled
verdict/Accept/Reject controls with `Desktop pixel inspection is required`.
Mobile must never imply that final pixel approval is available.

Stop the exact guarded server session when inspection ends. Confirm its port
has no listener. Browser verification in this lane cannot validate a real A/B
candidate, visual improvement, live Accept result, or the 70% threshold.

### 2.6 Zero-call proof

Closeout must record all of the following, not merely the absence of a visible
error:

- no Generate action was clicked;
- no quality-gate route dispatched provider work;
- smoke and browser network activity contain no live Frame Repair POST;
- all test provider/job data came from deterministic injected fixtures;
- safe provider-unavailable preflight left Start/Generate disabled;
- refresh, close, project switch, and recovery checks issued no Generate;
- no real provider quota or candidate was consumed.

## 3. Lane B — Separately Authorized Live Pilot

Do not enter this lane during implementation verification. Before any call, the
user must approve one written packet naming all of:

| Required authorization | Exact value required |
| --- | --- |
| Provider preset | One configured/capability-eligible preset id and image size |
| Source ownership | One source project plus six exact asset/revision ids, with explicit ownership confirmation for all six |
| Target | One previously unused isolated target project id and name |
| Call budget | Maximum eight total; maximum one per case; no retry, fallback, or substitute call |
| Operator | Named desktop human reviewer present for every candidate decision |
| Resource budget | Guard command, memory ceilings, timeout, chosen port/process ownership, and current system capacity |
| Stop authority | Named person authorized to stop immediately without spending the remaining budget |

The packet must also confirm the sealed case definitions and expected
improvement criteria. Missing or ambiguous authorization means zero calls.

### 3.1 Live pilot sequence

1. Load the one named source project and verify the exact revision.
2. Select the six named owned active Character Pack revisions and attest
   ownership.
3. Run provider-free Setup once. Record the returned target project,
   eight-entry mapping, and Setup-manifest SHA-256.
4. If Setup leaves an orphan or reports a collision, stop. Never reuse or
   remove that target; choose a new target only under explicit operator control.
5. Author the six real case definitions. The two control definitions remain
   repository-locked.
6. Select the authorized preset/image size and run provider-free Plan.
7. Review all eight identities, masks, instructions, difficulty/category
   distribution, preset, call ceiling, Setup digest, and session plan hash.
8. Start only after the operator explicitly confirms the sealed plan.
9. For the one unlocked case, run the existing provider-free Frame Repair Plan.
10. The operator explicitly confirms and clicks **Generate one candidate** once.
    Never run a loop or move automatically to another case.
11. Recover that exact planned operation when its outcome is uncertain. Do not
    allocate another operation or repeat Generate.
12. If a candidate is complete and hard gates pass, perform blind A/B choice,
    reveal, functional verdict, and seal the immutable review.
13. Invoke specialized Accept only when the operator chooses to adopt the
    candidate into the isolated project; otherwise seal Reject.
14. Seal the exact terminal outcome. Only then may the next case unlock.
15. Recheck call accounting, revision chain, integrity, resource state, and
    conservation stop before every later confirmation.
16. After eight terminal outcomes, or when an approved stop leaves evidence
    insufficient, explicitly Finalize and inspect all four final artifacts.

### 3.2 Immediate stop conditions

The operator with stop authority ends the pilot immediately when any of these
occurs:

- any case exceeds one call or the session exceeds eight;
- the original operation has an unknown outcome that recovery has not resolved;
- decoded pixels outside the canonical mask changed;
- candidate/manifest/plan/case/operation/job identity is incomplete or differs;
- source project mutation, unrelated target mutation, or accepted revision-chain
  drift is detected;
- validator, continuity, required quality evidence, storage, path, symlink,
  size, digest, or schema integrity blocks;
- `provider_safety_filter` is recorded;
- two consecutive terminal calls produce no reviewable candidate;
- process-tree guard reports pressure, timeout, continuous growth, or an
  unresponsive process;
- the operator cannot complete desktop blind/revealed review;
- the stop authority requests termination for any safety reason.

There is no automatic resume. Preserve append-only evidence and use the
recovery matrix. Never delete an orphan or evidence to make the run continue.

## 4. Recovery Matrix

| Observed state | Authoritative check | Allowed action | Forbidden action |
| --- | --- | --- | --- |
| Setup rejects source revision/asset | Reload the one named source project and exact six revisions | Correct provider-free inputs before reserving another target | Mutating the source project through Setup |
| Setup target/evidence collision | Exact target path and exact Setup-manifest path | Stop; retain for inspection; use a new explicit target id later | Reuse, overwrite, or automatically remove it |
| Setup manifest exists but target `project.json` does not | Exact Setup manifest plus exact target path | Treat as unpublished orphan and stop | Publish over it or delete it as recovery |
| Plan is stale or preset unavailable | Reload target revision, Setup digest, and safe provider state | Edit provider-free case facts, create a fresh session id, and Plan again | Start or Generate against stale facts |
| Start response is lost | GET the exact project/session id | Rehydrate the sealed plan and blind order | Create another session implicitly or Generate automatically |
| Generate response is lost | Recover the exact planned operation id | Observe the original durable winner only | Allocate another operation or submit a substitute call |
| Operation is `outcome_unknown` | Exact durable operation/job recovery | Keep paused and recover the same operation | Seal `provider_blocked`, Generate again, or Accept |
| Known provider failure, no candidate | Exact operation and **durable job id**, zero candidate, controlled known reason | Seal `provider_blocked`; stop immediately for safety-filter or after conservation rule | Record blocked without a job, copy raw remote text, or retry |
| Candidate evidence is incomplete/blocked | Sealed Frame Repair artifacts and server hard gates | Seal `quality_blocked` when exact durable job authority proves it | Enter human review or Accept |
| Review response is lost | GET the exact case review URL/view | Repeat only the same provider-free semantic review; first writer wins | Change verdict under the same case record |
| Reject outcome response is lost | GET exact case outcome | Repeat only the identical provider-free rejected outcome | Generate or mutate project |
| Accept response is uncertain | Reload target project, exact job, sealed review, and planned parent | Recover the exact already-created child before recording outcome | Repeat Generate or blindly repeat Accept |
| Accept succeeded, outcome record failed | Verify the one matching child revision and current project chain | Record only the provider-free accepted outcome, then adopt/refetch | Repeat Generate or Accept |
| Project revision/projection drift | Recompute chain from exact prior accepted outcomes | Pause, export/inspect existing evidence | Guess revision, skip a case, or continue Generate |
| Browser closes, refreshes, or switches project | Safe recovery handle plus server Get | Rehydrate ids/hashes and authoritative evidence | Restore notes/images/provider state from browser storage or enqueue work |
| Finalize response is lost/partial | Exact fixed final files and their digests | Repeat identical Finalize only | Add new review/outcome or finalize different evidence |
| Integrity/storage/path failure | Exact fixed file, expected size, SHA-256, and schema | Pause and preserve evidence for inspection | Repair in place, overwrite, rename, or automatically remove evidence |
| Guard timeout/memory pressure/growth | Supervisor result and exact process group | Terminate, record peak/reason, inspect smallest focused cause | Automatically rerun the failed combined command |

`provider_blocked` always requires a durable job id in the current protocol.
A planned operation reservation or zero-job pre-dispatch state is not terminal
blocked evidence. `outcome_unknown` is not persisted as an outcome file.

## 5. Evidence Review

Finalization must yield these fixed files under the exact session:

- `session_plan.json`;
- `blind_order.json`;
- any existing `case_<case-id>_review.json`;
- eight terminal `case_<case-id>_outcome.json` files for a pass or visual
  quality failure;
- `frame_repair_quality_gate.json`;
- `frame_repair_quality_gate.md`;
- `frame_repair_quality_gate_contact_sheet.png`;
- `artifact_manifest.json`.

Verify manifest entries are sorted and contain only filename, byte size, and
SHA-256. The manifest must cover every final evidence file except itself.
Blocked/no-candidate contact-sheet cells must be controlled text tiles, never
fabricated character images. Reviewer notes must remain in review JSON and not
appear in Markdown or image labels.

Verify the JSON and Markdown agree on result, failure domain, success fraction,
required integer, rate, calls, terminal counts, difficulty/category breakdowns,
hard-gate taxonomy, controlled provider taxonomy, exact preset, and session
plan hash.

## 6. Complete Verification Record

Fill every `Recorded result` and `Peak process-tree RSS` cell during closeout.
Do not change the design status to implemented while any required row is
pending or failed.

| Verification | Required evidence | Provider calls | Recorded result | Peak process-tree RSS |
| --- | --- | ---: | --- | ---: |
| Provider-dispatch static audit | No dispatch/enqueue/submission site in quality-gate server modules | 0 | Pass; no dispatch, enqueue, or submission match | — |
| Secret/path/enumeration static audit | No root enumeration, credential ingestion, raw remote text, or encoded image evidence | 0 | Pass; reviewed matches are guarded browser globals only | — |
| Naming static audit | No restricted branding or comparative substitution copy | 0 | Pass; reviewed matches are internal generic copy helpers only | — |
| `git diff --check` | No whitespace error | 0 | Pass after final verification record update | — |
| Core focused group 1 | Protocol + Plan + Controls all pass | 0 | Pass, 35 tests | 134304 KiB |
| Core focused group 2 | Assets + Evidence + Coordinator all pass | 0 | Pass, 46 tests | 393168 KiB |
| Core focused group 3 | API + Server wiring all pass | 0 | Pass, 3 tests | 576 KiB |
| Browser focused group 1 | State + Controller all pass | 0 | Pass, 10 tests | 1040 KiB |
| Browser focused group 2 | Panel + Workbench Panel all pass | 0 | Pass after the full-suite finding, 53 tests | 528 KiB |
| Browser focused group 3 | Lifecycle + Frame Repair Controller + Workbench Controller all pass | 0 | Pass, 75 tests | 512 KiB |
| Browser focused group 4 | Artifact Client + Shell Structure all pass | 0 | Pass, 16 tests | 576 KiB |
| Full `npm test` | Initial guarded serial run plus one explicitly authorized post-fix rerun; retain both results | 0 | Initial run failed 1311/1312 and exposed the blind-mapping defect fixed in `526044f`. The explicitly authorized post-fix rerun passed 1312/1312 in 141830.707 ms (guard elapsed 141881 ms, peak 6 processes). | 3084224 KiB initial; 3059888 KiB post-fix |
| `npm run smoke:local` | One guarded run; no detached server/browser | 0 | Pass after correcting the smoke's exact-export counter; provider-unavailable Start stayed disabled | 105104 KiB |
| Desktop visual 1440×900 | Bounded layout, focus/keyboard/disabled reasons, no console error, ordinary Frame Repair preserved | 0 | Pass for real Setup/authoring, disabled reasons, keyboard filmstrip, and ordinary Frame Repair open/close; real candidate view remains unverified | 190656 KiB |
| Mobile visual 390×844 | Readable report-only truth, no overflow/overlap/hidden action | 0 | Setup/authoring pass with 390 px document width and wrapped actions; candidate report-only view remains deterministic-test-only | Same tracked server |
| Server shutdown | Exact process group exited; chosen port has no listener | 0 | Pass; tracked process group stopped and port 57231 has no listener | — |
| Zero-call confirmation | No Generate/live POST/quota/candidate; injected fixtures only | 0 | Pass; no Generate, live Frame Repair POST, quota use, candidate, or provider request | — |

If one full suite or smoke has already been attempted, record that result even
when it fails or hits a guard. Do not conceal it by replacing it with an
automatic rerun.

## 7. Capability Truth And Release Decision

After all Lane A rows pass, the implementation may claim only:

- exact request/evidence protocols and provider-free orchestration exist;
- deterministic controls, Setup isolation, hashes, blind order, hard gates,
  revision-chain checks, idempotency, recovery, aggregate formula, responsive
  UI states, and ordinary-flow compatibility are covered by deterministic
  tests and zero-call browser verification;
- no real provider quality was measured.

The implementation must not claim that a real candidate is visually improved,
that six of eight completed candidates meet the 70% threshold, or that the
feature is production-ready. Those facts remain unverified until Lane B is
separately authorized and its append-only live report is reviewed.

For a live report:

- `passed` supports only the exact tested preset, case set, masks,
  instructions, assets, and implementation revision;
- `quality_failed` must retain its `safety` or `visual_quality` domain;
- `evidence_insufficient` remains an honest terminal result, not permission to
  spend more calls;
- no result supports broader provider, character, defect, or production
  claims without additional separately authorized evidence.
