# Local API Boundaries

**Status:** Active  
**Scope:** Local Node server endpoints, browser client responsibilities, and
core pipeline ownership.

This project is a local Node service plus a static browser client. It is not a
pure frontend app. The HTTP listener is loopback-only. Static delivery is an
allowlist limited to the two app entry documents, `src/`, and `generated/`;
workspace data, root dotfiles, repository metadata, configuration, tests, and
server source are not public paths. Provider keys remain server-side.

## Boundary Summary

| Layer | Owns | Must Not Own |
|---|---|---|
| `src/character-pack/*` | Character processing, generation contracts, validation, exports, artifacts | Browser DOM, form state, provider secrets in client code |
| `src/scene-pack/*` | Tile profiles, scene prompts, tile ingestion, live scene generation wrapper, quality gates, LDtk export, artifacts | Browser DOM, project-pack composition |
| `src/project-pack/*` | Character + scene artifact composition and combined ZIP export | Image generation, tile slicing, UI state |
| `src/motion-source/*` | Motion selection contracts, upload/source identity, lifecycle, decode budgets, guarded local-tool execution, strip/set evidence | Browser DOM, Provider calls, client-owned filesystem or executable paths |
| `server.js` | Local API routing, job queue, env loading, generated artifact writing, static file serving | Pixel-perfect UI layout, generated artifact business rules |
| `src/ui/*` | Form controls, client-side preview, job polling, links, user interaction | Provider keys, pipeline contracts, exporter logic |

## Local Endpoints

### Character Pack

- `POST /api/generate-character`
  - Live provider call.
  - Uses server-side provider credentials.
  - Accepts `t2iMode`.
  - `production_sheet_v0` routes selected provider output through
    `processSheetBuffer()`.
  - `quality_character_v0` writes text-to-image single-character artifacts
    without invoking sheet post-processing.
  - Accepts structured `promptFields`, `characterPreset`, `imageConfig`, and
    `generationOptions` such as `candidateCount`, `seed`, `temperature`,
    `topP`, and `topK`.
  - Applies a provider call budget. When `maxProviderCalls` /
    `max_provider_calls` is omitted, the server caps provider attempts at the
    planned `candidateCount`; pass a larger explicit max only when fallback
    retries are intentional.
  - Returns `provider_call_budget` and `candidate_selection` on completed jobs.
    `quality_character_v0` jobs also return `quality_spec` metrics for the
    selected finished image.
  - Candidate ranking does not grant release authority. Responses include
    `release_gate`, `release_ready`, and `artifact_disposition`;
    `candidate_selection.selected_index` is diagnostic and
    `candidate_selection.release_selected_index` is the publication choice.
  - If processed candidates exist but none pass `generation_release_gate_v1`,
    the job is terminal `failed_quality_gate` with `failure_status:
    "generation_release_gate_failed"`, `retry_hint:
    "inspect_generation_evidence"`, and diagnostic URLs only. Character/T2I
    ZIPs and engine export URLs are absent.
  - If every candidate fails in the Provider stage before any candidate enters
    local processing, the job status remains terminal as `failed_model_error`
    for existing pollers, with `failure_status: "failed_all_candidates"`,
    `provider_call_budget`, and `candidate_selection` included for diagnosis.
    Local finishing, sheet processing, packaging, or writing failures remain
    `failed_post_processing`.
  - If a provider rejects the route as prohibited by provider policy or terms,
    the job still returns terminal `failed_model_error`, but
    `failure_status` is `provider_route_blocked` and `retry_hint` is
    `switch_provider_preset`. Candidate generation stops after the first
    blocked provider call instead of spending the remaining candidate budget.
  - The release gate does not increase candidate count, change fallback, retry a
    Provider, or spend additional quota.
- `POST /api/process-sheet`
  - Provider-free upload processing.
  - Routes uploaded source through `processSheetBuffer()`.

### Scene Pack

- `POST /api/process-scene-tiles`
  - Provider-free uploaded tile source processing.
  - Accepts optional `styleSnap`, `edgeCondition`, and
    `rawTilePolicy` / `gatePolicy.raw_tile_quality` options.
  - Raw tile policy defaults to `warn`; pass `strict` when upload processing is
    being used as release evidence.
  - Routes through `buildScenePackFromTileSheet()`.
- `POST /api/generate-scene-tiles`
  - Live provider call.
  - Requires `confirm_live_generation: true` or `yes: true`.
  - Uses server-side provider credentials.
  - Accepts the same scene options as upload processing, including raw tile
    policy, plus `candidateCount` / `candidate_count` for multi-candidate
    generation. Candidate count defaults to one and is capped at eight. The
    default raw tile policy remains `warn` for direct generation; benchmark live
    gates use `strict`.
  - Routes provider output through `generateSceneTilePack()` and scene pack
    artifact writing.

### 2.5D Tileset

- `POST /api/build-two-point-five-d-tileset`
  - Provider-free by default when given `material_source_base64`, or fully
    procedural when no material source is supplied.
  - Guarded live provider source generation is available through
    `material_source_prompt` / `materialSourcePrompt`.
  - Live source generation requires `confirm_live_generation: true` or
    `yes: true` and routes the provider image through local normalization,
    material extraction, deterministic atlas composition, validation, Tiled
    export, LDtk export, package audit, and import validation.
- `POST /api/two-point-five-d-material-source-benchmark`
  - Browser/API wrapper for the 2.5D material-source benchmark runner.
  - Passing `dryRunPlan: true` writes and returns a real
    `material_source_benchmark_plan.json` artifact without provider calls.
  - Live benchmark execution requires `confirm_live_generation: true` or
    `yes: true` plus an explicit `maxProviderCalls` / `max_provider_calls`
    budget. Requests without either guard are rejected before provider calls.
  - Live jobs return through `/api/jobs/:id` with provider-call budget,
    selected usable rate, failure taxonomy, and links to
    `material_source_benchmark_plan.json`, `material_source_benchmark.json`,
    and `material_source_benchmark.md`.
  - Provider outputs remain raw material sources; final tileset structure is
    still owned by local deterministic code.

### Project Pack

- `POST /api/project-pack`
  - Provider-free composition of existing generated character and scene job ids.
  - Loads child artifact directories from `generated/<job-id>/`.
  - Writes `project_manifest.json`, `project_validation.json`, and
    `project_pack.zip`.
  - Accepts optional `strictStyleContract: true` or `stylePolicy: "strict"` to
    fail the project pack when shared-style validation emits warnings.

### Motion Source

All Motion Source routes are provider-free. They do not read Provider
credentials, call an image/video Provider, or spend quota. FFmpeg and rembg are
optional user-installed local tools resolved only from server configuration or
`PATH`; no binary, model, weight, plugin, or third-party asset is bundled.

- `POST /api/motion-source/uploads?source_name=<name>&operation_id=<id>`
  - Accepts the browser File as a raw request body, not Base64 JSON.
  - Streams into one private server-owned spool file while computing byte length
    and `sha256:<hex>` source identity.
  - Returns `upload_id`, `operation_id`, `source_identity`, `source_name`,
    `media_kind`, `byte_length`, and
    `session_scope: "current_server_process"`.
  - Enforces actual streamed byte limits of 200 MiB for video, 64 MiB for GIF or
    frame-sequence ZIP, and 32 MiB for one raster image. Declared
    `Content-Length` is only an early check.
  - The current process is capped at 16 live uploads/active writes, 512 MiB of
    live plus reserved upload capacity, and 1024 upload-operation records.
    Motion job bindings have a separate 1024-operation cap. Capacity exhaustion
    is a controlled 507 response.
  - Sniffed format must agree with the accepted extension/MIME family. Overflow,
    abort, or write failure removes only the explicit partial spool file.
- `DELETE /api/motion-source/uploads/:uploadId`
  - Marks only the named upload for release and returns `{ released, pending }`.
    Active/queued worker references or non-terminal Motion operations defer the
    physical unlink. Repeating release is harmless.
  - Release restores live upload-count/byte capacity but retains the
    upload-operation record needed to verify exact replay.
- `DELETE /api/motion-source/upload-operations/:operationId`
  - Records release intent even when an upload is pending and no descriptor has
    reached the browser. Upload commit consumes the intent and immediately
    requests release.
  - This pending-release ledger is capped at 1024 current-process entries. The
    browser makes at most four attempts, each with a 3-second deadline covering
    fetch and response parsing; unlink failures separately receive bounded
    server retries after 250, 1000, and 4000 ms.
- `POST /api/analyze-motion-source`
- `POST /api/preview-motion-frames`
- `POST /api/build-motion-strip`
  - New requests identify media by `source_upload_id` plus the expected
    `source_identity`; they do not resend source bytes.
  - Every request includes a client-generated `operation_id`. The server binds
    that id to operation type, upload id, canonical source identity, and options
    hash for the current process. Only that exact tuple returns the original
    job; conflicting reuse is rejected.
  - A bound operation remains replayable after its upload file is released.
    Released bytes cannot start a different operation.
  - Job and artifact responses echo `source_identity`, `operation_id`, and
    `options_hash`. The browser separately binds rendering to its local
    `source_epoch`, so a late old-source result cannot update a new File.
  - Selection authority is explicit as `selection_mode: "auto" | "manual"`.
    Auto omits `selected_frame_indexes`; Manual requires a non-empty, ordered,
    duplicate-free, in-range integer list.
  - Optional `options.motion_selection` is canonicalized before operation
    hashing. Omitted, `false`, `null`, or explicit
    `motion_selection_v1_compat` are the same v1 behavior. Explicit
    `motion_selection_recipe_v2` accepts only `loop_expectation:
    "auto" | "loop" | "once"` and `temporal_matte:
    "disabled" | "evidence_only"`.
  - Unknown Motion Selection recipes/options fail before operation claim.
    Camel/snake aliases are removed after canonicalization, so equivalent
    requests recover the same current-process job.
  - Motion Selection v2 preserves raw frame provenance, uses bounded
    analysis-only registration and complete-link global clustering, applies a
    static gate before lag periodicity, and emits a versioned selection report.
    Manual authority bypasses all automatic v2 stages.
  - A v2 target shortfall keeps diagnostic artifacts and marks the Motion report
    `warning`; it never duplicates frames. Apply/export count contracts remain
    unchanged.
  - Temporal matte v2 is evidence-only: it cannot change alpha, selected
    indexes, strip bytes, job gating, or external-tool usage.
  - Optional `options.pixel_grid_refinement` is canonicalized before operation
    hashing. Legacy `true` or an object without `recipe` remains
    `pixel_grid_v1_compat`; new browser requests use an explicit
    `pixel_grid_v2_balanced`, `pixel_grid_v2_detail_safe`, or
    `pixel_grid_v2_oklab` recipe.
  - Pixel Grid remains disabled by default. Unknown recipe/option keys fail
    before queueing. v2 runs sequence consensus on selected cleaned
    source-coordinate frames before grid-aware normalization, uses the Motion
    job `AbortSignal`, and adds no Provider call. Recipe-only v2 requests use
    the canonical 32-pixel maximum cell size.
  - Pixel Grid work ceilings cannot be raised by request data. A refinement
    ceiling returns `passthrough_refinement_budget`; normalization that cannot
    preserve an integer cell, phase, and bottom baseline returns
    `passthrough_normalization_incompatible` and rebuilds from cleaned source
    frames.
  - Explicit `pixel_grid_refinement: false` or `null` canonicalizes to the same
    omitted option used by the browser, so exact replay and `options_hash` do
    not split behaviorally identical disabled requests.
  - Migration-only requests without `selection_mode` infer Manual from a
    non-empty list and Auto otherwise. Explicit Auto plus indexes is a controlled
    client error, not an inference case.
- `POST /api/apply-motion-strip`
- `POST /api/analyze-motion-source-set`
- `POST /api/apply-motion-source-set`
  - Preserve the existing provider-free reviewed strip/set contracts.
  - Motion JSON bodies are bounded at 16 MiB. Legacy Base64 source requests are
    accepted only below that boundary and return
    `use_motion_source_upload` when raw upload is required.
  - A legacy Base64 operation uses an internal upload released after worker
    completion. Exact replay resends identical bytes/options; the server verifies
    and discards those bytes before returning the original job.
- `POST /api/motion-source/jobs/:jobId/cancel`
  - Idempotent and scoped to Motion jobs.
  - Queued cancellation prevents decode/spawn. In-process ZIP/GIF/image/Sharp
    work observes AbortSignal cooperatively at explicit checkpoints and cannot
    preempt one library call already in progress.
  - On POSIX, active FFmpeg/rembg cancellation terminates one detached process
    group with verified TERM/KILL escalation. On Windows, guarded external-tool
    execution fails closed before spawn as `external_tool_monitor_failed`.
  - Cancellation remains terminal `failed_post_processing` with
    `failure_status: "cancelled"`,
    `motion_source_lifecycle: "cancelled"`, and
    `retry_hint: "resume_with_new_operation"`.

Browser/API requests must reject `inputPath`, `videoOutputDir`, `ffmpegPath`,
`rembgPath`, and equivalent local-path/tool-path fields as
`client_path_not_allowed`. CLI commands may retain explicit local paths under
the local operator's shell authority.

Motion upload descriptors, operation idempotency, and Resume are scoped to the
current server process. A restart expires them and requires source
re-selection/re-upload; v1 does not claim persistent operation recovery.

Decode budgets are 256 ZIP entries, 256 MiB total uncompressed ZIP payload, 240
GIF pages/decoded frames, 16,777,216 pixels per decoded frame, 256 MiB aggregate
decoded RGBA before sampling, and 64 extracted/64 sampled frames. ZIP EOCD and
central-directory preflight rejects Zip64, multi-disk, malformed, and declared
budget overrun inputs before JSZip. Actual entry inflation is separately
chunk-counted and paused at the same byte ceiling, so forged declarations cannot
bypass it. Browser/API FFmpeg and rembg work shares a
dedicated queue with concurrency `1` and these process-tree limits:

| Tool boundary | RSS ceiling | Wall-clock ceiling |
| --- | ---: | ---: |
| FFmpeg extraction | 1536 MiB | 120 seconds |
| One rembg frame | 1536 MiB | 45 seconds |
| Total rembg stage | 1536 MiB | 180 seconds |

On POSIX, the supervisor samples the whole process tree at least once per second,
owns the process group, performs and verifies bounded SIGTERM/SIGKILL
termination, captures bounded diagnostic tails, and never automatically
retries. Windows fails closed before spawn until equivalent supervision exists.
FFmpeg records aspect-ratio-preserving `bounded_scale_v1` parameters derived
from planned frames/pixel budgets, capped at 4096, plus extracted output byte
totals; output PNGs are limited to 80 MiB each and 320 MiB total. Stable
boundary errors include `decode_budget_exceeded`, `external_tool_timeout`,
`external_tool_rss_limit`, `external_tool_cancelled`,
`external_tool_spawn_failed`, `external_tool_failed`,
`external_tool_monitor_failed`, `client_path_not_allowed`, and
`use_motion_source_upload`.

### Editor Workspace

- `GET /api/editor/health`
  - Provider-free health check for the parallel editor API namespace.
- `POST /api/editor/projects`
  - Creates or saves an `editor_project_v0` document through the editor project
    store.
  - Writes under `workspace/projects/<project-id>/`.
  - Does not call providers or mutate generated job directories.
- `GET /api/editor/projects/:projectId`
  - Loads `project.json`; passing `?autosave=true` loads `autosave.json`.
- `PUT /api/editor/projects/:projectId`
  - Formal project save.
  - Requires `expectedRevision` / `expected_revision`.
  - Validates before writing, increments project `revision`, writes atomically,
    and preserves the previous formal save as `project.backup.json`.
- `POST /api/editor/projects/:projectId/autosave`
  - Autosaves a valid project to `autosave.json`.
  - Does not increment the formal project revision and does not replace
    `project.json`.
- `POST /api/editor/projects/:projectId/import-job`
  - Imports one explicit generated job id as a managed immutable asset
    revision.
  - Requires `expectedRevision` / `expected_revision`.
  - Initial kinds are `character_pack` and `scene_pack`.
  - Copies known artifact filenames only from the requested
    `generated/<job-id>/` directory into
    `workspace/projects/<project-id>/assets/<asset-id>/<revision-id>/`.
  - Failed-quality assets are allowed but default to `production_status:
    "blocked"`; warning and unknown assets default to `review_required`.
  - Does not scan all generated jobs and does not mutate the source generated
    job directory.
  - Rejects process-recorded `editor_character_reprocess` and
    `editor_character_frame_repair` jobs with
    `specialized_accept_required`, even when a generated context file is
    missing or modified. The two fixed context markers remain a second defense
    for imports whose process job record is no longer available.
- `POST /api/editor/projects/:projectId/assets/:assetId/reprocess`
  - Builds one provider-free Character Workbench Preview from an existing
    managed `character_pack` revision.
  - Accepts exactly `expectedRevision`, `expectedAssetRevisionId`, and a full
    `processing_recipe_v0` candidate. Aliases, extra keys, client filesystem
    paths, embedded images, provider keys, prompts, scripts, modules, arbitrary
    options, and a client-owned implementation revision are rejected before a
    job is created.
  - The server reloads the formal project, checks both revision identities,
    and captures the managed input once. It prefers the active revision's
    dedicated `source` artifact. Only when `source` is absent does it use the
    required `sheet` artifact as the explicit `normalized_sheet_fallback`,
    whose authoritative source layout is always `topdown_rpg_v0`.
  - For managed source input, source-layout authority is the first compatible
    registered value from: the active revision's valid exact Workbench Recipe,
    `debug_report.source_layout.id`, then
    `animations.source_layout.id`. Malformed or missing optional evidence is
    diagnosed and skipped; unsafe recorded paths always block. `asset.profile`
    is never substituted for source-layout evidence.
  - Asset name, description, registered profile, derived-revision source,
    creation time, and allowlisted generation provenance are server-owned. A
    managed asset name must be a non-empty string before the job is enqueued.
    Prompt text, provider configuration, raw paths, raw responses, tokens, and
    candidate payloads are neither accepted nor copied.
  - A `dual_matte` Recipe is valid only when the active revision has a
    dedicated `artifacts.black_matte` record. The resolver captures a real
    `Buffer`; arbitrary artifact-value matches and reference strings are not
    processing inputs.
  - The server stamps one startup-resolved `implementation_revision`, computes
    the full `recipe_hash` and revision-neutral `draft_settings_hash`, and
    enqueues the captured bytes on the process-wide Character Pack queue.
    Success is `202` with the standard job summary, both hashes, the canonical
    Recipe echo, and authority diagnostics.
- `POST /api/editor/projects/:projectId/assets/:assetId/reprocess/:jobId/accept`
  - Accepts exactly `expectedRevision`, `expectedAssetRevisionId`, the full
    `expectedRecipeHash`, and `warningConfirmed`. A
    `draft_settings_hash` cannot authorize acceptance.
  - Runs entirely inside the shared project-id mutation lock. After acquiring
    the lock it reloads the project and rechecks project, asset, parent,
    process-recorded job type/status, exact Recipe/context identities, current
    managed input and black-matte digests, source layout, metadata timestamp,
    quality, and every sealed generated artifact. Captured metadata must be a
    plain JSON object whose `created_at` exactly equals both the job timestamp
    and context submission timestamp.
  - Required generated evidence is resolved only under the reprocess service's
    real generated root. Every file is compared with its sealed size and
    SHA-256, captured once, then copied with exclusive/no-overwrite semantics.
    Later replacement of a generated path cannot change the captured bytes.
  - Strict `pass` evidence has no warnings or blocking errors and imports a
    normal `ready` child revision. Strict `warning` has no blocking errors and
    requires explicit confirmation bound to this job and full Recipe hash,
    then imports as `review_required`. Contradictory quality evidence, `fail`,
    `unknown`, incomplete evidence, and any non-`done` job never modify the
    project.
  - The accepted revision is the exact Preview job; processing is not rerun.
    It retains `processing_recipe_ref` and managed `reprocess_context`
    provenance and becomes active only after a revision-checked formal save.
    A failed copy or save leaves project JSON unchanged. Any exclusively
    reserved orphan directory is preserved for explicit recovery and is never
    reused or automatically deleted.
  - Two Accept requests at the same formal revision serialize: one may return
    `200`; the other returns a revision conflict without mixing source-job
    bytes.
- `POST /api/editor/projects/:projectId/assets/:assetId/frame-repair/plan`
  - Provider-free planning route; returns `200` and spends zero provider calls.
  - Accepts exactly `expectedRevision`, `expectedAssetRevisionId`, `clipId`,
    `clipFramePosition`, `sheetFrameIndex`, a normalized `instruction`, up to
    64 rectangular `maskEdits`, `providerPresetId`, and
    `imageConfig: { image_size }` where the size is `1K` or `2K`.
  - Reloads the formal managed Character Pack, derives the canonical mask and
    ordered project-owned references, resolves only a server-side provider
    preset, and returns the canonical Plan, full Plan hash, `can_run`, and
    diagnostics. No image bytes, paths, provider keys, prompts, or provider
    response are accepted or returned.
- `POST /api/editor/projects/:projectId/assets/:assetId/frame-repair`
  - Live route; returns `202` for the existing process-wide job queue.
  - Accepts the exact Plan fields plus `operationId`, `expectedPlanHash`,
    `confirmLiveGeneration: true`, and `maxProviderCalls: 1`. Any other budget
    or missing confirmation is rejected before enqueue.
  - Re-resolves all managed authority and the exact runtime provider preset,
    rejects a stale Plan, and allows exactly one provider request producing
    exactly one candidate. Normalization, masked composite, package validation,
    quality evidence, and two-level artifact sealing remain local operations.
- `GET /api/editor/projects/:projectId/assets/:assetId/frame-repair/operations/:operationId`
  - Provider-free recovery/poll route; returns `200` for the operation winner
    or controlled `404 operation_not_found`.
  - Performs no Plan/live POST, enqueue, directory scan, or provider call.
    Durable recovery is keyed only by project, asset, and operation identity.
- `POST /api/editor/projects/:projectId/assets/:assetId/frame-repair/:jobId/accept`
  - Accepts exactly `expectedRevision`, `expectedAssetRevisionId`, the full
    `expectedPlanHash`, and `warningConfirmed`; success returns `200`.
  - Inside the shared project mutation lock, revalidates the durable operation
    winner, completed one-call job accounting, outer and inner sealed
    manifests, Plan/Context/package/quality identities, current managed parent,
    non-target and outside-mask pixels, mask reference digest, and the
    recomputed difference image.
  - `fail` and `unknown` never import. `warning` requires confirmation bound to
    this exact job and Plan. A passing child is `ready`; a confirmed warning is
    `review_required`.
  - Copies only the approved sealed managed artifact subset. Raw provider output
    and the prompt remain generated evidence and are not retained in the child.
    The immutable child has `processing_recipe_ref: null` and becomes active
    only in the successfully saved project clone. Copy/save failures preserve
    the orphan revision directory and never reuse or automatically delete it.
- `POST /api/editor/projects/:sourceProjectId/frame-repair-quality-gates/setup`
  - Provider-free Quality Gate Setup; success returns `201`.
  - Accepts one exact source-project revision, six explicit owned Character Pack
    asset/revision identities, one previously unused target project id/name, and
    explicit ownership confirmation.
  - Creates two deterministic repository controls and one isolated eight-asset
    target project through the validated Editor store. This is the only new
    Quality Gate route allowed to create or mutate project state. It never
    writes the source project, reuses a target collision, or cleans up an
    unpublished orphan after a failed publication.
- `POST /api/editor/projects/:projectId/frame-repair-quality-gates/plan`
  - Provider-free, write-free validation of one exact eight-case plan; success
    returns `200`.
  - Re-resolves the Setup manifest, managed project authority, fixed difficulty
    distribution, one preset/image size, and the eight-call ceiling. It can
    report an unavailable preset without dispatching a provider request.
- `POST /api/editor/projects/:projectId/frame-repair-quality-gates`
  - Provider-free session Start; success returns `201`.
  - Recomputes and verifies the canonical plan hash, requires explicit session
    confirmation, and exclusively seals the plan and blind-order evidence. It
    does not mutate the Editor project or enqueue Frame Repair work.
- `GET /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId`
  - Provider-free session recovery and safe-view route; success returns `200`.
  - Reads only exact evidence names from the sealed plan and the eight exact
    durable operation ids. It never enumerates operation or artifact roots and
    never starts, retries, or recovers an operation implicitly.
- `POST /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId/cases/:caseId/review`
  - Provider-free review sealing; success returns `200`.
  - Binds one blind and functional verdict to the exact completed operation,
    job, sealed candidate evidence, case hash, and server-derived hard gates.
    It does not accept browser-trusted hashes or quality metrics.
- `POST /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId/cases/:caseId/outcome`
  - Provider-free terminal outcome sealing or explicit unknown-outcome pause;
    success returns `200`.
  - Accepted outcomes verify the child revision already created by the ordinary
    specialized Frame Repair Accept route. This route records evidence only and
    performs no additional project mutation, Generate, retry, or Accept.
- `POST /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId/finalize`
  - Provider-free aggregate finalization; success returns `200`.
  - Produces the immutable three-state report, Markdown, bounded contact sheet,
    and artifact manifest without changing the project or dispatching work.
- Frame Repair Quality Gate HTTP boundary
  - Every Quality Gate POST body is capped at 128 KiB before JSON parsing;
    oversize input returns controlled `413 request_too_large`. The GET route has
    no request body.
  - Successful responses are coordinator-owned browser-safe projections. Error
    responses expose only `{ error, reason, details? }`; optional details are
    filtered controlled scalars/lists/records and never include credentials,
    paths, Buffers, base64, headers, stacks, causes, environment data, or raw
    provider messages.
  - All seven routes are provider-free. The ordinary Frame Repair Plan,
    explicit one-call Generate, scoped operation recovery, job polling, and
    specialized Accept contracts remain the sole repair authorities and retain
    their existing routes, status codes, envelopes, and behavior.
- Frame Repair operation ledger boundary
  - The server constructs one private ledger under the configured Editor
    workspace root. The ledger module alone derives
    `.operations/frame-repair`; neither route callers nor generated-directory
    configuration can supply or redirect this path.
  - Records use a digest filename derived from project, asset, and operation
    identity. They contain no instruction, prompt, mask, image, provider key,
    runtime preset, raw request, project JSON, or generated filesystem path and
    are never exposed through the artifact endpoint or static file service.
- `POST /api/editor/projects/:projectId/export-pack`
  - Exports the current formal `editor_project_v0` save as
    `editor_project_pack_v1`.
  - Requires `expectedRevision` / `expected_revision`.
  - Writes only under `workspace/projects/<project-id>/exports/<export-id>/`.
  - Includes `project.json`, editor validation, asset references, scene
    documents, `engine_handoff_manifest_v1`, Godot/LDtk preview handoff JSON,
    static consumer validation, manual import evidence/checklist files, existing
    managed asset files, and supported engine payloads only when those payloads
    already exist as managed asset artifacts.
  - Returns `review_status` so callers can distinguish `pass` / `warning`,
    `preview_metadata_only`, and `unsupported_items_present` without parsing the
    full ZIP.
  - Does not call providers, mutate asset revisions, or replace existing
    `/api/project-pack` behavior.

Character Workbench route errors use controlled JSON codes. Invalid envelopes,
Recipes, identities, paths, managed metadata/source, profiles, and source-layout
authority return `400`; missing project/asset/revision/job/artifact returns
`404`; project/asset/stale conflicts return `409`; quality, warning-confirmation,
and sealed-integrity failures return `422`; an unwired local coordinator returns
stable `503 reprocess_unavailable`. Existing endpoint response shapes and
statuses remain unchanged.

Frame Repair uses the same controlled JSON envelope. Invalid request/Plan/mask,
frame-position, and managed-input values return `400`; missing operation/
project/asset/revision/artifact returns `404`; stale Plan, project/asset
revision, job, operation, and other exact identity conflicts return `409`;
quality, warning-confirmation, and sealed-integrity failures return `422`;
provider unavailability/configuration and an unwired coordinator return `503`
(`frame_repair_unavailable` for the latter).
Provider-free Plan preflight is the exception to the error form: an unavailable
preset may return `200` with `can_run: false` and a `provider_unavailable`
diagnostic. A thrown `provider_unavailable` from live execution remains `503`.

### Shared

- `GET /api/jobs/:id`
  - Returns local job state and artifact URLs.
  - For Motion Source, this is also the same-process Resume route for an exact
    job. Poll abort changes only browser observation; it does not cancel or
    enqueue server work.
  - A browser polling deadline reports `poll_timeout` with the job id. Resume
    continues polling that id and never creates a replacement operation.
- `GET /api/gemini-state`
  - Returns provider availability, active preset id, provider type, model, and
    image config without exposing secrets.
  - Supports a simple local default provider via `CHARACTER_IMAGE_PROVIDER`
    (`openrouter` or `gemini`) plus provider-specific keys/models, or advanced
    `CHARACTER_PROVIDER_PRESETS` entries that reference key env var names.
  - If the default provider is omitted and only `GEMINI_API_KEY` is configured,
    the server reports native Gemini as the default provider.
  - Invalid provider config returns `status: "configuration_error"` with a
    non-secret error message.
- `POST /api/provider-config`
  - Accepts a local browser-session provider config:
    `provider`, `model`, and `apiKey`, plus optional `baseUrl`, `imageSize`, and
    `aspectRatio`.
  - Stores the config only in the running local Node server process. It does not
    write `.env` or any other local config file.
  - Returns the same public provider-state shape as `/api/gemini-state` under
    `provider_state`, with `runtime_configured: true` when the session override
    is active.
  - Passing `{ "clear": true }` removes the browser-session override and falls
    back to the server environment config.
  - Responses must not include the submitted raw API key.
- `GET /api/benchmark-gallery`
  - Returns local character benchmark gallery metadata.
- `POST /api/build-frame-gif`
  - Builds a GIF from provided frame images.

## Live Generation Guard

Character text-to-image generation always runs under a provider call budget.
The default cap equals the planned candidate count, so fallback attempts cannot
silently add extra provider calls unless the caller explicitly raises
`maxProviderCalls`.

Scene live generation is intentionally guarded. API callers must pass an
explicit confirmation field before a provider request can be enqueued. This
mirrors the CLI `--yes` guard and prevents accidental quota spend from browser
or automation controls. Each scene tile candidate consumes one provider request,
so callers should keep `candidateCount` explicit when collecting release
evidence.

## UI Contract

The browser scene tab exposes live scene generation through the local API. The
control must:

- make the quota-spending nature visible,
- pass `confirm_live_generation: true` only after user intent is explicit,
- poll `/api/jobs/:id`,
- render real artifact URLs returned by the server,
- keep provider keys out of the browser.

The browser Motion Source tab uses the local API under these additional rules:

- upload source media as raw File bytes and retain the returned source
  descriptor;
- default Preview -> Build to Auto and send no manual indexes until the user
  edits selection/order;
- expose explicit Auto/Manual selection and Restore Auto;
- display source name, byte size, digest prefix, and current selection mode;
- bind rendered artifacts to source identity, operation id, job id, and local
  source epoch;
- distinguish stopping observation from cancelling server work;
- expose Cancel only for the current browser-owned cancellable Motion job and
  Resume only when the exact current-session job/identity remains available;
- clear derived preview/manual state when the selected source changes;
- request release by the prior upload operation id, including the race where a
  descriptor has not yet arrived, and treat `pending: true` as deferred cleanup
  rather than immediate unlink failure.

## Current Product Boundary

The browser currently exposes scene tile preview, uploaded tile processing,
live scene tile generation, style/edge correction controls, and project-pack
composition. Live scene generation remains local-first and quota-confirmed; it
does not create remote storage, hosted queues, or public quality claims.

Motion Source remains a local, provider-free source-to-strip workflow. Motion
Selection v2 registration, global duplicate clustering, periodic temporal-phase
analysis, and evidence-only temporal matte are local deterministic operations.
This boundary still does not include semantic phase recognition, temporal alpha
repair, or the Guided Motion Source UI/HUD. The current safety work also does
not bundle or download FFmpeg, rembg, Python, model weights, or other external
tools.
