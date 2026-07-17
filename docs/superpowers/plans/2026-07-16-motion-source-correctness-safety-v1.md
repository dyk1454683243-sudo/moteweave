# Motion Source Correctness And Safety v1 Implementation Plan

**Status:** Complete and guarded-verified on 2026-07-16; B closes in its
independent commit and C-E remain unimplemented.

**Goal:** Restore the automatic Motion selector as the default authority, remove
browser Base64 media amplification, bind jobs to exact source identity, add
truthful cancellation/recovery, and bound decode plus FFmpeg/rembg resource use.

**Architecture:** B lands in three dependent slices. B1 makes selection mode a
canonical request/report field. B2 adds a streamed, server-owned upload store and
an in-process idempotent Motion job lifecycle with source/operation binding. B3
adds decode budgets and a single-concurrency guarded tool runner shared by video
extraction and external matting. The existing Motion Source tab gains only the
controls required to expose these real capabilities.

**Tech stack:** Node.js ES modules and streams, `node:test`, existing Sharp/GIF/
ZIP dependencies, plain browser modules, local FFmpeg/rembg when configured,
and a process-tree supervisor with no new third-party dependency.

---

## Normative Source And Boundaries

- Approved design:
  `docs/superpowers/specs/2026-07-16-motion-source-correctness-safety-v1-design.md`.
- Master plan:
  `docs/superpowers/plans/2026-07-16-character-production-quality-master-plan.md`.
- A must be completed and committed before B implementation begins.
- Use `design-to-implementation-contract` before touching `index.html` or
  `src/ui/`. The approved B design is the behavior source of truth. Record any
  deviation before implementation.
- Do not implement registration, global duplicate clustering, periodicity,
  action phases, temporal matte, a guided wizard, or a new evidence HUD.
- Do not bundle/download tools, binaries, weights, code, or assets.
- Do not accept browser-provided local paths or executable paths.
- Do not call a Provider.

## Resource, Process, Test, And Git Safety

- The primary agent is the only test/build/browser/media runner.
- Every test/build/smoke command uses the checked-in resource guard. Never run
  raw `node --test`, a raw server, or browser automation.
- Focused tests are serial under 1024 MiB V8, 1536 MiB process-tree RSS, and 60
  seconds. Tool-runner unit tests use tiny local commands/fixtures and remain
  inside those same outer ceilings.
- External-tool runtime defaults are fixed by the design: one media operation,
  at most 1536 MiB RSS, bounded deadlines, and no retry.
- Run `npm test` only after all B slices pass focused tests. A failed full run
  may be rerun only after its concrete lifecycle, fixture, assertion, or
  integration defect is identified and fixed. Run `npm run smoke:local` only
  after the UI path is complete. Stop after any resource anomaly.
- Track and stop the exact smoke server/browser/process group. Leave no detached
  process.
- Do not scan `output/`, `generated/`, or unrelated artifacts. Tests address
  only exact temporary files they create and remove individual files only.
- Preserve the exclusive Frame Repair worktree and unrelated untracked duplicate
  files. Stage only B paths.

## Fixed Contracts

- New UI/API selection mode: `auto | manual`; new UI defaults to `auto`.
- Legacy missing mode infers manual only when indexes are non-empty.
- New upload endpoint streams raw bytes and returns a server-computed SHA-256
  source descriptor.
- Analyze/Preview/Build requests use `source_upload_id`, expected identity, and
  an idempotent `operation_id`.
- Same-process Resume polls the original job; it does not queue another.
- Motion cancellation remains global `failed_post_processing` plus
  `failure_status: "cancelled"` and
  `motion_source_lifecycle: "cancelled"`.
- External tools use server configuration/PATH only and a dedicated
  single-concurrency boundary.

## File Responsibility Map

| File | Responsibility |
| --- | --- |
| `src/motion-source/selectionMode.js` | Canonical new/legacy request normalization and conflict validation |
| `src/motion-source/framePreview.js` | Candidate preview metadata with default auto authority |
| `src/motion-source/stripBuilder.js` | Explicit effective mode and selector/manual branch |
| `src/motion-source/uploadStore.js` | Stream, sniff, hash, byte-limit, resolve, and explicitly release one private source file |
| `src/motion-source/jobLifecycle.js` | In-process operation idempotency, source/options binding, AbortController, resume/cancel projection |
| `src/motion-source/decodeBudget.js` | ZIP/GIF/frame/pixel/decompressed-byte safety accounting |
| `src/motion-source/guardedToolRunner.js` | Single-concurrency spawn, process-tree RSS/deadline/cancel/termination, bounded diagnostics |
| `src/video-sprite/frameExtractor.js` | Path-based video input, decode budgets, guarded FFmpeg |
| `src/motion-source/externalMatting.js` | Guarded rembg with total/per-frame deadline and abort checks |
| `src/ui/motionSource/api.js` | Raw File upload, identity-bound operations, abortable poll, Resume/Cancel |
| `src/ui/appState.js` | Selection mode, source epoch/descriptor, active operation/job lifecycle |
| `src/ui/motionSourceTab.js` | Correct request authority and minimal truthful controls |
| `index.html` | Auto/Manual, Restore, Cancel, Resume, and identity/status hooks only |
| `server.js` | Motion-specific bounded readers/routes, descriptor resolution, lifecycle wiring, path rejection |

## Task 1: B1 - Canonical Selection Mode

**Files:**

- Create: `src/motion-source/selectionMode.js`
- Create: `test/motion-source/selectionMode.test.js`
- Modify: `src/motion-source/framePreview.js`
- Modify: `src/motion-source/stripBuilder.js`
- Modify: `test/motion-source/stripBuilder.test.js`
- Modify: `server.js`
- Modify: `test/motion-source/api.test.js`

- [x] Write pure tests for explicit auto/manual, contradictory requests, manual
      empty/invalid/duplicate/out-of-range indexes, and both legacy inference
      branches.
- [x] Add Preview -> Build regressions proving preview defaults do not generate
      manual indexes and auto mode invokes the real selector.
- [x] Add manual order-preservation and requested/effective report assertions.
- [x] Implement one shared normalizer; do not duplicate inference between server
      and builder.
- [x] Change preview root metadata to `default_selection_mode: "auto"`; keep any
      legacy frame field non-authoritative.
- [x] Thread explicit mode through server and builder and reject new conflicts
      before heavy processing.
- [x] Run:
      `npm run test:focused -- test/motion-source/selectionMode.test.js test/motion-source/stripBuilder.test.js test/motion-source/api.test.js`

## Task 2: B1 - Browser Selection Authority

**Files:**

- Modify: `index.html`
- Modify: `src/ui/appState.js`
- Modify: `src/ui/motionSourceTab.js`
- Create: `test/uiMotionSourceStructure.test.js`
- Modify: `docs/protocols/motion-source-pipeline.md`
- Modify: `docs/protocols/local-api-boundaries.md`

- [x] Add failing source/structure tests for default Auto, explicit Manual,
      first-selection-edit transition, Restore Auto, and no indexes in Auto
      request construction.
- [x] Add the minimal accessible Auto/Manual and Restore controls without moving
      unrelated layout or exposing future D/E capabilities.
- [x] On source change, reset selection mode, manual indexes, preview-derived
      state, and source epoch atomically.
- [x] Send `selection_mode` on all new Build requests and indexes only in Manual.
- [x] Update the protocol from “planned” to an honest implemented baseline plus
      the new migration semantics.
- [x] Run the B1 focused set:
      `npm run test:focused -- test/motion-source/selectionMode.test.js test/motion-source/stripBuilder.test.js test/motion-source/api.test.js test/uiMotionSourceStructure.test.js`
- [x] Inspect B1 against the design contract before beginning upload work.

## Task 3: B2 - Streamed Source Store And Decode Descriptor

**Files:**

- Create: `src/motion-source/uploadStore.js`
- Create: `test/motion-source/uploadStore.test.js`
- Create: `src/motion-source/decodeBudget.js`
- Create: `test/motion-source/decodeBudget.test.js`
- Modify: `src/motion-source/sourceAnalyzer.js`
- Modify: `src/video-sprite/frameExtractor.js`
- Modify: `test/motion-source/sourceAnalyzer.test.js`
- Modify: `test/video-sprite/frameExtractor.test.js`
- Modify: `server.js`

- [x] Write upload-store tests for raw stream success, declared/actual overflow,
      aborted stream, write failure, MIME/extension/sniff disagreement,
      idempotent same operation, conflicting operation reuse, descriptor resolve,
      identity mismatch, and one-file release.
- [x] Use tiny fixtures and assert only exact files created by each test; never
      enumerate or bulk-clean a directory.
- [x] Implement streaming hash/write with 200/64/32 MiB media ceilings and a
      private non-static spool path. Remove only the explicit partial file after
      a failed upload.
- [x] Add the upload route and a 16 MiB Motion-only legacy JSON body limit with
      `413`/`use_motion_source_upload`. Do not change unrelated `readBody` calls.
- [x] Add pure decode-budget accounting and enforce ZIP entries/uncompressed
      bytes, GIF pages, frame pixels, and aggregate RGBA before runaway work.
- [x] Make video extraction accept the server-owned path so a 200 MiB video is
      not re-read into a source Buffer before FFmpeg.
- [x] Reject browser/API input/output/tool paths before queueing.
- [x] Run:
      `npm run test:focused -- test/motion-source/uploadStore.test.js test/motion-source/decodeBudget.test.js test/motion-source/sourceAnalyzer.test.js test/video-sprite/frameExtractor.test.js`

## Task 4: B2 - Identity-Bound Jobs, Polling, Cancel, And Resume

**Files:**

- Create: `src/motion-source/jobLifecycle.js`
- Create: `test/motion-source/jobLifecycle.test.js`
- Modify: `src/character-pack/jobQueue.js` only if the lifecycle tests prove a
  minimal queue hook is required
- Modify: `server.js`
- Modify: `src/ui/motionSource/api.js`
- Modify: `src/ui/appState.js`
- Modify: `src/ui/motionSourceTab.js`
- Modify: `test/motion-source/api.test.js`
- Modify: focused UI structure/state tests

- [x] Test canonical source/options hashing, same-operation same-job recovery,
      conflicting reuse, queued abort before work, active AbortSignal,
      idempotent cancel, terminal projection, and server-session expiry.
- [x] Add server route tests for upload -> Analyze/Preview/Build descriptor use,
      expected identity mismatch, operation replay, scoped Cancel, and Resume by
      GET of the exact job.
- [x] Add API tests for AbortSignal polling, `poll_timeout` preserving job id,
      Resume without enqueue, and distinction between poll abort and server
      cancellation.
- [x] Add browser state tests/source assertions proving epoch/identity/operation
      mismatch blocks late rendering after a source change.
- [x] Implement one AbortController per active Motion operation and check it
      before decode, between stages, and at task start.
- [x] Add minimal Cancel/Resume controls whose enabled states reflect real job
      authority. Do not label poll abort as server cancellation.
- [x] Ensure the new browser path uploads File bodies directly and makes no
      Motion call to `fileToBase64`.
- [x] Run:
      `npm run test:focused -- test/motion-source/jobLifecycle.test.js test/motion-source/api.test.js test/motion-source/uploadStore.test.js test/uiMotionSourceStructure.test.js`

## Task 5: B3 - Guarded External Tool Runner

**Files:**

- Create: `src/motion-source/guardedToolRunner.js`
- Create: `test/motion-source/guardedToolRunner.test.js`
- Modify: `src/video-sprite/frameExtractor.js`
- Modify: `src/motion-source/externalMatting.js`
- Modify: `test/video-sprite/frameExtractor.test.js`
- Create or modify: `test/motion-source/externalMatting.test.js`
- Modify: `server.js`

- [x] Write tiny local-process tests for normal exit, spawn failure, timeout, RSS
      ceiling using a deliberately tiny test limit, AbortSignal, bounded stderr,
      SIGTERM->SIGKILL escalation, descendant cleanup, and global concurrency 1.
- [x] Tests must never approach product ceilings and must complete within the
      outer focused-test resource guard.
- [x] Implement detached process groups, recursive process-tree RSS sampling at
      least once per second, exact group termination, and a bounded diagnostic
      tail without shell interpolation.
- [x] Resolve FFmpeg/rembg from server config/PATH only. Add FFmpeg `-nostdin`,
      frame/time bounds, and at most two threads.
- [x] Pass the operation AbortSignal to FFmpeg and rembg. Before each rembg frame,
      verify both the signal and remaining total stage deadline; never launch the
      next frame after cancellation.
- [x] Map timeout/RSS/cancel/spawn/decode failures to the stable design codes and
      do not retry.
- [x] Run:
      `npm run test:focused -- test/motion-source/guardedToolRunner.test.js test/video-sprite/frameExtractor.test.js test/motion-source/externalMatting.test.js`

## Task 6: Protocol, Runbook, And Focused B Verification

**Files:**

- Modify: `docs/protocols/motion-source-pipeline.md`
- Modify: `docs/protocols/local-api-boundaries.md`
- Modify: `docs/runbooks/motion-source-productization-evidence.md`
- Modify: `docs/roadmap/technology-reference-roadmap.md`
- Modify: `docs/roadmap/p0-p2-technical-upgrade-plan.md`

- [x] Document the exact selection migration, upload/body/decode limits, source
      descriptor, operation/job identity, poll/cancel/Resume distinctions,
      server-session recovery boundary, path rejection, process ceilings, and
      failure codes.
- [x] State that D/E capabilities are not included and tools remain optional and
      unbundled.
- [x] Run the complete focused B set once, split into the smallest serial groups
      if command length/readability requires it. Every invocation must still use
      `npm run test:focused --` and no group may overlap another.
- [x] Run `git status --short`; inspect every changed path and confirm unrelated
      untracked files remain untouched.

## Task 7: Final Guarded Verification And B Commit

- [x] Run `npm test` through the checked-in full resource supervisor.
- [x] If it fails, diagnose and run only the smallest focused reproducer; do not
      rerun the full suite unless the concrete defect is fixed and a rerun is
      genuinely required.
- [x] Run `npm run smoke:local` once. Verify real local upload -> Preview -> Auto
      Build, explicit Manual, source-change stale-result rejection, Cancel, and
      Resume states without a Provider. Stop the exact server/smoke/tool process
      group at the end.
- [x] Record any visual/content/interaction deviation from the approved B design
      with a reason. Do not expand into E.
- [x] Run `git status --short`, stage only B files, and commit with a conventional
      message such as `fix: harden motion source lifecycle`.
- [x] Record the commit hash in the final handoff together with focused/full/
      smoke results, resource observations, and residual platform/tool risk.

Verification record:

- Provider-free focused groups passed, including selection/upload/lifecycle,
  decode/tool/matting/video extraction, UI/API, CLI, smoke structure, and the
  focused integration regressions discovered by full-suite runs.
- The final guarded full run passed `1357 / 1357` tests in `135.864s`, with
  `831568 KiB` peak process-tree RSS and `5` peak processes.
- `npm run smoke:local` passed in `3.741s`, with `708432 KiB` peak process-tree
  RSS and `3` peak processes. It cleared direct Provider-key variables, made no
  Provider call, and left no tracked smoke/server process.
- No timeout, swap surge, memory-pressure warning, or resource breach occurred.
  Full-suite reruns happened only after a concrete integration defect was
  identified and fixed with the smallest focused reproducer.
- Residual boundaries remain explicit: in-process JSZip/Sharp cancellation is
  cooperative, POSIX external tools use process-group supervision, and Windows
  external-tool execution fails closed before spawn.

## B Completion Checklist

- [x] New UI Preview -> Build is truly Auto by default.
- [x] Manual is explicit, validated, ordered, and reversible to Auto.
- [x] New UI sends raw File bytes, not Base64 Motion JSON.
- [x] Source identity, operation id, options hash, job, and browser epoch agree.
- [x] Poll abort, timeout, Resume, queued cancel, and active cancel are truthful.
- [x] Client local/tool paths are rejected while CLI local paths remain.
- [x] Decode budgets cover compressed, page/entry, pixel, and aggregate RGBA
      dimensions.
- [x] FFmpeg/rembg run serially inside documented process-tree ceilings and stop
      descendants on failure/cancel.
- [x] Focused, full, and smoke verification used only checked-in guards and left
      no tracked smoke/server/external-tool process running.
- [x] B closes in this independent commit; C-E remain unimplemented.
