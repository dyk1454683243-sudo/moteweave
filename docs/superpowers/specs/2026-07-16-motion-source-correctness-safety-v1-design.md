# Motion Source Correctness And Safety v1 Design

**Date:** 2026-07-16  
**Status:** Implemented and guarded-verified on 2026-07-16
**Owner:** Project lead  
**Target surface:** Provider-free Motion Source browser/API/local-tool workflow

## 1. Decision Summary

Correct Motion Source in three dependent increments:

1. B1 makes automatic versus manual frame selection explicit and restores the
   automatic selector as the default browser authority.
2. B2 replaces browser Base64/JSON media transfer with bounded binary upload,
   binds every job to a server-computed source identity, and adds truthful
   cancellation and same-process recovery.
3. B3 puts FFmpeg and rembg behind a single-concurrency, process-tree resource
   supervisor and adds bounded GIF/ZIP/image decode contracts.

This is correctness and safety work, not the guided Motion Source redesign and
not Motion Selection v2.

## 2. Source Of Truth

The design extends:

- `docs/protocols/motion-source-pipeline.md`
- `docs/protocols/local-api-boundaries.md`
- `docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md`
- `src/motion-source/framePreview.js`
- `src/motion-source/stripBuilder.js`
- `src/motion-source/externalMatting.js`
- `src/video-sprite/frameExtractor.js`
- `src/ui/motionSource/api.js`
- `src/ui/motionSourceTab.js`
- `server.js`

`AGENTS.md`, the UI implementation guardrails, and the master plan are
mandatory. FFmpeg/rembg remain optional user-installed tools; no binary, model,
weight, external code, or asset is bundled.

## 3. Problem Statement

The current Preview -> Build UI marks every preview frame selected and sends the
full index list. The server interprets any non-empty list as manual selection,
so the ordinary path silently bypasses the automatic selector.

The browser also represents media as Base64 inside JSON. A 200 MiB video can
exist simultaneously as a File/ArrayBuffer, binary string, Base64 string, JSON
string/body chunks, concatenated server Buffer, decoded source Buffer, and tool
input file. Body buffering is unbounded, source identity is not bound to jobs,
polling cannot be cancelled, and late jobs can update a newly selected source.

FFmpeg/rembg processes have no whole-tree RSS, deadline, cancellation, or exact
termination boundary. Client requests can also supply local input/output/tool
paths. Removing Base64 alone would leave decode bombs and external-tool hangs
unbounded.

## 4. Goals

1. Make selection authority explicit, deterministic, and backwards compatible.
2. Stream Motion media to a server-owned private source store with exact byte
   and format limits.
3. Bind upload, source digest, options, operation, job, artifact, and browser
   render state.
4. Distinguish “stop observing”, “cancel queued work”, and “terminate active
   work”.
5. Support resuming an exact job in the same server session without duplicate
   queueing.
6. Bound compressed input, decoded frames, FFmpeg, and rembg resource use.
7. Reject browser authority over local paths and executable paths.
8. Preserve provider-free operation and existing CLI local-path capability.

## 5. Non-Goals

- Frame registration, global near-duplicate clustering, periodic loop analysis,
  action phases, or temporal matte. Those belong to Motion Selection v2.
- A guided wizard, tutorial, new evidence HUD, or broad layout redesign.
- Cross-server-restart job recovery or a persistent operation ledger.
- Bundling or downloading FFmpeg, rembg, Python, model weights, or other tools.
- Provider calls, AI video generation, or semantic motion judgment.
- Changing Character generation, Editor Workspace, or unrelated API body limits.

## 6. B1 - Selection Mode Contract

New requests use snake-case API and camel-case internal/UI forms:

```json
{
  "selection_mode": "auto",
  "selected_frame_indexes": null
}
```

Canonical rules:

- Mode is exactly `auto` or `manual`.
- New UI state defaults to `auto`.
- `auto` must omit `selected_frame_indexes`; the server rejects a conflicting
  non-empty list.
- `manual` requires a non-empty, integer, in-range, duplicate-free ordered list.
- The first user edit to selection or order switches UI state to `manual`.
- “Restore automatic selection” clears manual indexes and returns to `auto`.
- Preview frames are selectable candidates, not proof of a user selection.
- Preview metadata adds `default_selection_mode: "auto"`. A legacy per-frame
  `selected` field may remain during migration but new UI must not use it to
  infer selection authority.
- Build reports record both requested and effective selection modes.

Legacy migration:

- Missing mode plus a non-empty index list infers `manual`.
- Missing mode plus no indexes infers `auto`.
- Explicit contradictory new requests fail with a controlled 4xx error; they do
  not fall back to guessing.

## 7. B2 - Upload And Source Identity

### 7.1 Binary upload

The new browser flow is:

```text
POST /api/motion-source/uploads?source_name=<url-encoded>&operation_id=<id>
Content-Type: the browser File type or application/octet-stream
Body: raw File bytes
```

The server streams bytes directly to one private, server-owned spool file while
computing SHA-256 and byte length. It does not call `arrayBuffer()`, Base64 encode,
or accumulate the request in memory.

The response is:

```json
{
  "upload_id": "motion_upload_...",
  "operation_id": "motion_upload_op_...",
  "source_identity": "sha256:<64 lowercase hex>",
  "source_name": "walk.mp4",
  "media_kind": "video",
  "byte_length": 123456,
  "session_scope": "current_server_process"
}
```

Server-owned ceilings:

| Input | Maximum compressed/raw bytes |
| --- | ---: |
| Video | 200 MiB |
| GIF or ZIP | 64 MiB |
| Single raster image | 32 MiB |
| Legacy Motion JSON request | 16 MiB total body |

Content length is an early check, not the authority. Streamed bytes are counted
and the partial explicit file is removed on overflow, abort, or write error.
Format sniffing must agree with the accepted extension/MIME family before the
descriptor is usable.

Existing Base64 fields remain temporarily readable only below the legacy body
ceiling and return a controlled `use_motion_source_upload` error above it. The
new UI never sends Base64 Motion media.

The current server process admits at most 16 live uploads or active writes,
512 MiB of live plus reserved upload capacity, 1024 upload-operation records,
and a separate 1024 Motion lifecycle bindings. Upload and upload-operation
release are idempotent. Release intent may arrive before descriptor commit;
active references defer physical unlink. An exact bound operation remains
replayable after release, while released bytes cannot start a new operation.
Migration-only Base64 operations release their internal upload after worker
completion and require identical bytes/options for exact replay.

### 7.2 Identity and idempotency

- Analyze, Preview, and Build use `source_upload_id` plus the expected
  `source_identity`; they no longer resend source bytes.
- The server resolves the descriptor and rejects an identity mismatch before
  queueing.
- Every operation includes a client-generated `operation_id`. During the same
  server process, retrying the same operation id with the same canonical source
  and options returns the original job; conflicting reuse is rejected.
- Every job and artifact response echoes `source_identity`, `operation_id`, and
  an options hash.
- The browser increments a local `sourceEpoch` whenever the chosen File changes.
  It renders a result only if job id, operation id, source identity, and epoch
  all match current state.
- A server restart expires upload and operation handles. The UI truthfully asks
  the user to select/upload the source again; v1 does not claim durable recovery.

### 7.3 Client path authority

Motion browser/API requests must reject `inputPath`, `videoOutputDir`,
`ffmpegPath`, `rembgPath`, and equivalent local-path/tool-path fields with
`client_path_not_allowed`. CLI commands may retain explicit local paths because
they execute under the local operator's shell authority.

## 8. B2 - Cancellation And Recovery

Three states remain distinct:

1. Poll abort: the browser stops waiting. Server work is unchanged.
2. Queued cancel: the server marks the operation cancelled before heavy work
   begins.
3. Active cancel: the operation's AbortSignal reaches extraction/matting and the
   exact active process group is terminated.

API additions:

```text
POST /api/motion-source/jobs/:jobId/cancel
GET  /api/jobs/:jobId
```

Cancellation does not add a global Job status in v1. A cancelled Motion job is
terminal as `failed_post_processing` with:

```json
{
  "failure_status": "cancelled",
  "motion_source_lifecycle": "cancelled",
  "retry_hint": "resume_with_new_operation"
}
```

Requirements:

- The cancel route is idempotent and scoped to Motion jobs.
- A queued task checks its signal before any decode or spawn.
- An active task checks its signal between pipeline stages and before every
  rembg frame.
- The poller accepts `AbortSignal`. A client polling deadline returns
  `poll_timeout` with the job id and Resume action; it does not fabricate a
  server terminal failure.
- Selecting another file aborts observation of the old job and prevents stale
  rendering. It may request server cancellation only for an operation owned by
  that browser state.
- Resume continues polling the exact job. It never silently queues a duplicate.
- A browser source change issues up to four upload-operation release requests.
  Each request, including response-body parsing, has a 3-second client deadline;
  the server separately retries a failed unlink after 250, 1000, and 4000 ms.

## 9. B3 - Decode Budgets

Before or during decode, enforce:

- ZIP entry count at most 256.
- ZIP total uncompressed payload at most 256 MiB.
- ZIP central-directory declarations and actual chunk-counted inflated bytes
  are both enforced.
- GIF/sequence page count at most 240.
- One decoded frame at most 16,777,216 pixels.
- Aggregate decoded RGBA at most 256 MiB before sampling.
- Extracted/sampled frames at most the existing contract maximum.
- At most 64 ZIP entries are extracted/sampled after preflight.
- Every budget error has a stable code and does not retry.

These are safety ceilings, not claims that all inputs near the ceiling are
useful. B tests use much smaller fixtures.

## 10. B3 - External Tool Boundary

All browser/API FFmpeg and rembg work uses a dedicated Motion media queue with
concurrency `1`. Tool paths come only from server configuration/PATH.

Each POSIX spawn must have:

- a detached process group owned by the supervisor;
- whole-process-tree RSS sampling at least once per second;
- exact process-group termination on cancel, timeout, RSS breach, or parent
  shutdown;
- SIGTERM followed by a bounded grace period and SIGKILL if needed;
- an AbortSignal;
- bounded stdout/stderr capture with only a safe tail in error evidence;
- no automatic retry;
- FFmpeg `-nostdin`, bounded frames/time window, and at most two worker threads;
- a remaining job deadline check before each rembg frame.

Windows guarded external-tool execution fails closed before spawn as
`external_tool_monitor_failed`; v1 does not claim Windows process-group
supervision. JSZip, Sharp, GIF, and image work observes cancellation at explicit
checkpoints but cannot preempt one native/library call already in progress.
FFmpeg normalization records `bounded_scale_v1`; extracted PNG output is capped
at 80 MiB per frame and 320 MiB in aggregate.

Initial limits:

| Tool | RSS ceiling | Wall-clock ceiling | Poll interval |
| --- | ---: | ---: | ---: |
| FFmpeg extraction | 1536 MiB process tree | 120 seconds | 1000 ms |
| One rembg frame | 1536 MiB process tree | 45 seconds | 1000 ms |
| Total rembg stage | 1536 MiB process tree | 180 seconds | 1000 ms |

The limits stay below the repository's 4096 MiB approval boundary. A real
workload that needs more must stop for explicit human approval; the code must
not auto-raise or retry.

Stable failure codes distinguish `external_tool_timeout`,
`external_tool_rss_limit`, `external_tool_cancelled`,
`external_tool_spawn_failed`, and `decode_budget_exceeded`.

## 11. Minimal UI Contract

This design uses the existing Motion Source tab.

- Add a visible Auto/Manual selection control and “Restore auto” action.
- Add a Cancel action only while the current browser-owned job is cancellable.
- Add Resume only when polling timed out or observation was interrupted and the
  current identity still matches.
- Show source name, size, digest prefix, and current selection mode.
- Do not add registration, periodicity, semantic, temporal-matte, or future
  cleanup controls.
- Disable every action until its real upload/job capability exists.
- Preserve existing real-artifact rendering, keyboard/focus behavior, status
  announcements, bounded overflow, and mobile report-only constraints.
- A source change clears derived preview/manual state and prevents old results
  from mutating current UI.

## 12. Compatibility

- Existing CLI file paths remain supported.
- Legacy API requests without `selection_mode` follow the explicit inference
  rules in section 6.
- Legacy Base64 source requests remain only under the motion-specific body
  ceiling during migration.
- Existing global job statuses remain unchanged for B; Motion cancellation uses
  additional lifecycle/failure fields.
- Existing completed artifacts remain readable.
- Non-Motion endpoints and body limits do not change.

## 13. Implementation Outcome

- B1 shipped explicit Auto/Manual authority. Preview defaults to Auto and sends
  no manual indexes; Manual remains ordered, validated, and reversible.
- B2 shipped raw uploads, SHA-256 source identity, exact operation/options/job/
  epoch binding, session caps, explicit/deferred/pre-descriptor release, exact
  replay after release, and truthful poll/cancel/Resume semantics.
- B3 shipped ZIP declaration plus actual-inflation budgets, bounded FFmpeg
  normalization/output evidence, cooperative in-process cancellation, POSIX
  process-group supervision, and Windows fail-closed behavior.
- The browser release path uses four attempts with a 3-second boundary per
  request. D/E capabilities were not added.
- Provider-free focused tests passed. The final guarded full suite passed
  `1357 / 1357` tests at `831568 KiB` peak process-tree RSS; the self-hosted
  local smoke passed at `708432 KiB` peak RSS and left no tracked server/smoke
  process.

## 14. Acceptance Criteria

- Preview defaults to auto and Preview -> Build invokes the real automatic
  selector without sending manual indexes.
- Manual selection is explicit, preserves requested order, and conflicting
  mode/index requests fail.
- The new UI performs no Motion `fileToBase64` call.
- Uploads stream, enforce byte/type limits, compute server-side identity, and
  remove one explicit partial file after overflow/abort.
- Job responses and UI rendering are identity/operation/epoch bound.
- Poll abort, poll timeout, same-process Resume, queued cancel, and active cancel
  have distinct tested behavior.
- GIF/ZIP/page/pixel/decompressed-byte ceilings fail before runaway allocation.
- Browser/API local paths and tool paths are rejected.
- FFmpeg/rembg tests prove timeout, RSS breach, cancellation, bounded stderr,
  no next-frame launch after abort, and descendant cleanup.
- Only one Motion external-tool process runs at once.
- Focused tests, the final guarded suite, and self-hosted local smoke leave no
  tracked server/smoke/external-tool process running and make no Provider call.
