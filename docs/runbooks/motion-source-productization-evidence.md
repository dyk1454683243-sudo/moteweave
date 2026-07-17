# Motion Source Productization Evidence

**Status:** Current guarded provider-free Motion Source v1 review.

Use this runbook after `motion-source build-strip` has produced reviewed
`normalized_motion_strip.png` files for two or more actions belonging to the
same character identity.

## Claim Boundary

This route proves local deterministic set assembly only. It does not call a
provider, generate AI video, judge semantic action quality automatically, or
claim arbitrary full-action-library readiness. FFmpeg and rembg, when used, are
optional user-installed tools; the repository does not bundle them, Python,
models, weights, plugins, or third-party assets.

This review also does not prove Motion Selection v2 registration, global
near-duplicate clustering, periodic loop/action-phase analysis, temporal matte,
or the Guided Motion Source UI/HUD. Those D/E blocks remain separately planned
and require independent authorization and evidence.

## Correctness And Safety Preflight

Before treating a browser/API strip as reviewable evidence, confirm:

- the source was uploaded as raw bytes through
  `POST /api/motion-source/uploads`, not Base64 Motion JSON;
- the returned descriptor records source name, media kind, byte length, and a
  server-computed `sha256:<hex>` `source_identity`;
- the Analyze/Preview/Build job echoes the same `source_identity`,
  `operation_id`, and `options_hash`;
- the browser rendered the result only for the matching job id and local source
  epoch;
- the server process has not restarted since upload. Upload and operation
  recovery are session-only; after restart, select/upload the source again.

The accepted upload ceilings are:

| Input family | Maximum request bytes |
| --- | ---: |
| Video | 200 MiB |
| GIF or frame-sequence ZIP | 64 MiB |
| Single raster image | 32 MiB |
| Legacy Motion JSON request | 16 MiB total body |

The current process also caps live uploads/active writes at 16, live plus
reserved upload capacity at 512 MiB, and upload-operation records at 1024.
Motion lifecycle bindings have an independent 1024-operation cap. A 507
capacity response is evidence that the current session must reuse/release an
upload or restart; it is not permission to raise the ceilings.

When the selected source changes, record the release request made through
`DELETE /api/motion-source/upload-operations/:operationId` or the explicit
upload-id endpoint. `pending: true` is the expected response while queued/active
work still references the source. Exact bound-operation replay remains available
after the physical file is released, but a released upload cannot start a new
operation. Legacy Base64 operations release their internal source file after
worker completion; exact replay must resend the same bytes and options for
verification.

Requests containing browser-owned local input/output/tool paths are invalid.
`inputPath`, `videoOutputDir`, `ffmpegPath`, `rembgPath`, and equivalent fields
must fail as `client_path_not_allowed`. Local CLI paths remain under the
operator's shell authority.

## Selection Evidence

For the normal untouched Preview -> Build route:

- preview metadata reports `default_selection_mode: "auto"`;
- the Build request records `selection_mode: "auto"`;
- no `selected_frame_indexes` are sent;
- the strip report records requested/effective Auto authority and the
  deterministic selector's chosen/rejected-frame evidence.

For a reviewed manual route:

- the first selection/removal/reorder edit switches authority to Manual;
- the request records `selection_mode: "manual"`;
- indexes are non-empty, integer, in range, duplicate-free, and retain the
  reviewer's requested order;
- Restore Auto clears the manual list and returns authority to the selector.

Legacy requests without a mode may infer Manual only from a non-empty index
list. Do not count explicit Auto plus indexes as evidence; that is a controlled
request error.

## Poll, Cancel, And Resume Evidence

Keep these states distinct when reviewing UI/API behavior:

- Poll abort means the browser stopped observing; server work continues.
- Queued cancel prevents heavy work from starting.
- Active cancel propagates to extraction/matting. JSZip, GIF/image, and Sharp
  work observes it cooperatively at checkpoints and cannot preempt one library
  call already in progress. On POSIX, FFmpeg/rembg uses one detached process
  group with verified TERM/KILL escalation. Windows fails closed before spawn
  as `external_tool_monitor_failed`.
- `poll_timeout` preserves the exact job id and enables Resume.
- Resume polls `GET /api/jobs/:id`; it never queues a duplicate operation.

A cancelled Motion job remains terminal `failed_post_processing` with
`failure_status: "cancelled"`,
`motion_source_lifecycle: "cancelled"`, and
`retry_hint: "resume_with_new_operation"`. Selecting another File must abort
old observation and prevent stale artifacts from updating the new source state.

## Decode And Local Tool Evidence

The decode boundary rejects inputs exceeding 256 ZIP entries, 256 MiB total
uncompressed ZIP payload, 240 GIF pages/decoded frames, 16,777,216 pixels in one
decoded frame, 256 MiB aggregate decoded RGBA before sampling, or 64 extracted/
64 sampled frames. ZIP EOCD/central-directory preflight rejects Zip64,
multi-disk, malformed, and declared-budget-overrun archives before JSZip; actual
inflation is then counted chunk-by-chunk and paused at the same byte ceiling.

Browser/API FFmpeg and rembg operations run in one dedicated Motion media queue
with concurrency `1`:

| Tool boundary | Process-tree RSS | Wall-clock |
| --- | ---: | ---: |
| FFmpeg extraction | 1536 MiB | 120 seconds |
| One rembg frame | 1536 MiB | 45 seconds |
| Total rembg stage | 1536 MiB | 180 seconds |

Resource/cancellation failures are terminal and are not automatically retried.
Review stable codes such as `decode_budget_exceeded`,
`external_tool_timeout`, `external_tool_rss_limit`,
`external_tool_cancelled`, `external_tool_spawn_failed`,
`external_tool_failed`, and `external_tool_monitor_failed`. On FFmpeg evidence,
review `bounded_scale_v1`, planned-frame/pixel parameters, and `output_bytes`;
extracted PNGs are bounded to 80 MiB each and 320 MiB total. Do not raise the
documented ceilings to make one failing source complete without explicit human
approval.

## Guarded Verification

Run `npm run smoke:local`. The command starts its own ephemeral loopback server
inside the repository full resource guard, clears the direct Provider API-key
variables, executes provider-free local routes, and terminates plus verifies the
tracked POSIX server/smoke process groups. It reads `/api/gemini-state` metadata
but does not call a Provider.

The Motion smoke covers raw ZIP upload, Preview, Auto, Manual, stale-identity
rejection, queued cancellation, exact cancelled-job replay, explicit release,
exact replay after release, and rejection of a new operation on released bytes.
Focused guarded tests separately prove session capacity, pre-descriptor release
intent, forged ZIP-declaration resistance, cooperative in-process cancellation,
and POSIX external-tool process-group cleanup. Windows is a documented
fail-closed boundary, not a process-group implementation.

Guarded closure evidence on 2026-07-16: the final full suite passed all
`1357 / 1357` tests in `135.864s`, with `831568 KiB` peak process-tree RSS and
`5` peak processes. The self-hosted local smoke passed in `3.741s`, with
`708432 KiB` peak RSS and `3` peak processes. No timeout, pressure event, or
resource breach occurred, and no tracked smoke/server process remained.

## Required Inputs

- `normalized_sheet.png` from an existing character pack;
- `motion_source_set_v1` manifest;
- one reviewed `normalized_motion_strip.png` per source id or runtime action;
- source-set identity gate configured through the manifest.

## Command

```bash
npm run character-pack -- motion-source apply-set \
  --sheet <normalized_sheet.png> \
  --manifest <motion_source_set.json> \
  --strip idle_down=<idle_strip.png> \
  --strip walk_down=<walk_strip.png> \
  --output-dir generated/cli \
  --job-id motion_source_set_apply_review
```

The same guarded apply route is available through `POST
/api/apply-motion-source-set` and the browser `Motion Source` tab's `Apply Set`
action. All three entries should produce the same set-apply evidence files when
given the same reviewed sheet, manifest, and strips.

## Expected Artifacts

- `applied_normalized_sheet.png`
- `motion_source_set_apply_report.json`
- `motion_source_set_report.json`
- `identity_consistency_report.json`

## Review Checklist

- Source identity, operation id, options hash, job id, and browser source epoch
  refer to the same source and operation.
- Selection evidence is explicitly Auto or Manual; preview candidate flags are
  not treated as manual authority.
- Poll abort, Cancel, and Resume are reported truthfully and Resume targets the
  original current-session job.
- No browser/API request supplies a local file, output, FFmpeg, or rembg path.
- Decode/tool resource failures, if present, use stable failure evidence and no
  automatic retry.
- `motion_source_set_apply_report.json.status` is `done` or explicitly explains
  why it is `fail`.
- `can_apply_multi_strip` is true before any strip application is accepted.
- `applied_actions` lists every intended runtime action in manifest order.
- `blocking_errors` is empty for release evidence.
- The final sheet still passes existing character-pack validation.
- The reviewer inspects the applied sheet and generated Row GIFs before making
  quality claims.
