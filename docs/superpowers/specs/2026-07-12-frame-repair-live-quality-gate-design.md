# Frame Repair Live Quality Gate v1 Design

**Date:** 2026-07-12

**Status:** Implemented; Tasks 1–11 and provider-free closeout verified; live-provider quality remains unverified pending a separately authorized pilot

**Owner:** Project lead

**Target surface:** Editor Workspace `/editor`

**Maximum later live budget:** 8 provider calls

## 1. Decision Summary

Build a guided, evidence-first quality gate around the existing Targeted Frame
Repair v1 product path. The gate uses six user-owned real Character Pack samples
and two repository-generated control samples, locks one exact configured,
capability-eligible provider preset for the session, and walks each case through the existing provider-free
Plan, single-call Generate, Recover/Review, and specialized Accept or Reject
flow.

The quality gate is a thin orchestration and evidence layer. It must not add a
batch generation endpoint, retry loop, provider fallback, new repair algorithm,
or project-format field. It validates the actual browser workflow while keeping
the existing one-call operation ledger, sealed artifacts, pixel-integrity gate,
and immutable child-revision acceptance as the authority.

The selected review layout is **focused review plus an eight-case progress
strip**. The active case receives the largest possible nearest-neighbor canvas;
automated evidence stays in a side rail; all eight case states remain visible in
a compact bottom strip; the final aggregate report is a separate summary view.

Approval of this design and the maximum budget is not authorization to make
provider calls. Implementation, automated tests, smoke checks, and browser
verification remain provider-free. A later live session requires a separate
explicit confirmation naming the exact preset, the eight-call ceiling, and the
ownership of the six real samples. Every Generate action also retains the
existing one-call confirmation.

## 2. Source Of Truth And Existing Boundaries

This design extends, but does not replace, the following shipped contracts:

- `docs/protocols/editor-frame-repair-v1.md`
- `docs/runbooks/targeted-frame-repair-v1.md`
- `docs/superpowers/specs/2026-07-11-targeted-frame-repair-v1-design.md`
- `docs/superpowers/specs/2026-07-12-frame-repair-safe-provider-diagnostics-design.md`
- `src/editor-project/frameRepairCoordinator.js`
- `src/editor-project/frameRepairOperationLedger.js`
- `src/editor-project/frameRepairService.js`
- `src/ui/editor/frameRepairController.js`
- `src/ui/editor/frameRepairLifecycle.js`
- `src/ui/editor/frameRepairPanel.js`

The implementation must obey:

- `AGENTS.md`
- `docs/guardrails/ui-implementation-guardrails.md`
- `docs/guardrails/editor-workspace-guardrails.md`
- `docs/roadmap/technology-reference-roadmap.md`

The ordinary Frame Repair entry remains available and unchanged. The quality
gate is a secondary operator mode inside the existing Repair Workbench. The old
application at `/` remains available.

## 3. Problem Statement

Targeted Frame Repair v1 has deterministic safety, evidence, UI, recovery, and
acceptance coverage, but real first-call visual quality is not established. One
separately authorized pilot consumed one call and returned no candidate. The
later safe-diagnostics block made future provider failures observable without
leaking remote text, but it did not provide visual-quality evidence.

The product therefore cannot yet make a broad production-readiness claim for
live frame repair. Adding more repair controls before measuring the current
path would increase surface area without proving that the core operation
improves real frames.

## 4. Goals

1. Measure real first-call repair quality through the actual Editor workflow.
2. Preserve one-call, no-retry, no-fallback behavior for every case.
3. Verify browser Review and specialized Accept against real completed jobs.
4. Make automated safety facts and human visual judgment independently visible.
5. Produce reproducible JSON, Markdown, and image evidence with explicit
   denominators and failure taxonomy.
6. Stop early when provider availability, integrity, accounting, resource, or
   project-mutation evidence becomes unsafe or inconclusive.
7. Keep the six source packs and the user's working projects unchanged by
   running the gate in a dedicated isolated Editor project.

## 5. Non-Goals

- Batch provider generation or a provider-call queue owned by the quality gate.
- Automatic retries, refunds, fallback providers, model switching, or candidate
  blending.
- Multi-provider or cross-model comparison in v1.
- Prompt optimization during a running session.
- Automatic visual pass/fail judgment or automatic Accept.
- New freehand mask tools, full pixel editing, layer decomposition, or skeletal
  output.
- Mobile pixel-quality approval.
- Changes to Character Pack processing, provider adapters, exporters, project
  schema, existing Job status values, or public generation endpoints.
- Use of assets from previously analyzed third-party archives.
- Production-readiness claims beyond the exact eight-case evidence set.

## 6. Approved Session Constraints

### 6.1 Sample composition

The locked session contains exactly eight cases:

| Case group | Count | Ownership | Difficulty | Intended coverage |
| --- | ---: | --- | --- | --- |
| Deterministic controls | 2 | Repository-generated | Basic | Outline/alpha edge and small-component defects |
| Real common defects | 4 | User-owned | Medium | Shape, detail, anchor/baseline, and facing consistency |
| Real demanding defects | 2 | User-owned | Hard | Semantic reconstruction or neighboring-frame continuity |

The six real inputs require an explicit local ownership attestation before the
session plan can be sealed. The implementation must copy their managed bytes
into an isolated benchmark project through controlled import paths. It must not
mutate the source projects or discover inputs by scanning `generated/` or
`output/`.

For v1, all six real assets come from one explicitly selected source Editor
project. Each source asset and active revision is named in the Setup request;
there is no workspace/project enumeration. A user who needs assets from several
projects first imports them into one source project through existing explicit
workflows.

The two control assets must be produced deterministically by repository-owned
code and passed through the real Character Pack validation/import path. They are
not canned UI data and must never stand in for the six real samples.

### 6.2 Locked case definition

Every case is fixed before the session begins:

- case id and display order;
- isolated project id, distinct asset id, parent asset revision id, clip id, clip position,
  and sheet frame index;
- canonical rectangle-mask edits and resulting mask hash;
- normalized repair instruction and its hash;
- difficulty and defect category;
- expected improvement criteria;
- source ownership class and source SHA-256;
- initial isolated-project revision and expected parent asset revision;
- exact provider preset and image-size configuration;
- one-call maximum.

Changing any of these facts creates a new provider-free session plan and a new
session id. It never mutates a sealed plan.

Each case targets a different imported asset. The initial project revision is
sealed once, while the current project revision may advance only through prior
successful session Accept operations. Before every later case, the coordinator
must prove an unbroken chain from the initial revision through those exact
accepted outcome records. The current derived revision is passed to the existing
Frame Repair request; it is not guessed by incrementing a number.

### 6.3 Provider constraint

One exact provider preset is used for all eight cases. A zero-call preflight may
read only the existing safe public provider-state/capability surface. It must
verify that the preset is configured and supports the required image/reference
contract. It must not probe generation, inspect credentials, or infer health
from private runtime data.

If the selected preset is unavailable at preflight, the session does not start
and consumes zero calls. The running session never switches presets.

## 7. Architecture

### 7.1 Isolated quality-gate project

The gate operates on a dedicated Editor project containing immutable copies of
the six user-owned packs and the two deterministic controls. Successful Accept
operations create child revisions only in this isolated project. Reject,
provider failure, recovery, and finalization do not mutate it.

Provider-free setup creates the isolated project through the existing project
validator/store and imports each explicitly selected managed asset through a
controlled server authority. UI code cannot copy files or write project JSON
directly. The setup records the eight source hashes and then seals exactly one
case per distinct imported asset.

The capture set is exactly the five core Character Pack documents plus an
optional declared processing recipe. A source revision may also contain other
repository-known managed Character Pack authorities produced by normal import,
reprocess, or Frame Repair flows; Setup validates their keys and safe paths but
does not read, hash, copy, or expose those extra artifacts. Unknown extra
authority is rejected.

Setup is the only new quality-gate operation allowed to create project state.
It accepts exactly six distinct source asset/revision identities from the
current source project, requires a true ownership confirmation and exact source
project revision, generates the two deterministic control packs locally, and
creates one previously nonexistent target project. It never writes the source
project. Target-project id collision, source revision drift, unsafe artifact,
copy/hash failure, or invalid control output stops Setup before target
`project.json` is published. Reserved orphan artifact files remain untouched for
manual inspection; they are never reused or automatically deleted.

Setup also writes one immutable
`<generatedDir>/frame-repair-quality-gates/setup_<target-project-id>/setup_manifest.json`
with exclusive-create semantics. It contains only the exact source project,
source/target asset and revision ids, ownership confirmation, source/target
artifact sizes and SHA-256 values, deterministic control identities, target
project revision, and protocol version. It contains no filesystem path, binary,
provider field, repair instruction, mask, remote text, or credential. Later
session planning reads this exact derived file; it never discovers Setup state
by directory scanning or browser memory.

Quality-gate metadata is not stored in project JSON. The isolated project uses
the existing project validator/store and revision semantics without adding a
new project field.

### 7.2 Canonical session planner

A pure planner validates the eight case definitions, ownership facts, provider
preset, project authority, difficulty distribution, and call ceiling. It emits
a canonical frozen plan and deterministic `session_plan_hash`.

Planning is provider-free and write-free. A separate start operation re-resolves
all managed authority and writes the exact plan once with exclusive-create
semantics.

### 7.3 Quality-gate coordinator

The coordinator owns only session evidence and state derivation. It can:

- validate and start a provider-free session;
- load the exact review/outcome records named by the session plan;
- associate one existing Frame Repair operation/job with its declared case;
- seal at most one reviewer verdict and one terminal outcome per case;
- compute pause/stop conditions;
- finalize aggregate evidence once;
- return a browser-safe view model and explicit artifact URLs.

It cannot enqueue provider work. Generate continues to use the existing Frame
Repair live endpoint and operation ledger.

### 7.4 Append-only evidence writer

Evidence lives under
`<generatedDir>/frame-repair-quality-gates/<sanitized-session-id>/`. The fixed
names are `session_plan.json`, `blind_order.json`,
`case_<sanitized-case-id>_review.json`,
`case_<sanitized-case-id>_outcome.json`, `frame_repair_quality_gate.json`,
`frame_repair_quality_gate.md`, `frame_repair_quality_gate_contact_sheet.png`,
and `artifact_manifest.json`. The implementation may use the existing
controlled artifact URL mechanism, but must never scan artifact roots to
discover sessions or cases.

The writer creates only predetermined filenames from the sealed plan. Each file
uses exclusive creation, size limits, exact schema validation, and SHA-256
verification. Existing files are never overwritten or automatically deleted.

Expected evidence classes are:

- immutable session plan;
- one immutable review record for each candidate that reaches human review;
- one immutable outcome record for each terminal case;
- deterministic blind-review mapping evidence;
- final aggregate JSON;
- final Markdown summary;
- final comparison contact sheet;
- an artifact manifest containing exact size and SHA-256 for every published
  evidence file except the manifest itself.

The protocol identifiers are:

- `frame_repair_quality_gate_setup_v1`
- `frame_repair_quality_gate_plan_v1`
- `frame_repair_quality_gate_blind_order_v1`
- `frame_repair_quality_gate_review_v1`
- `frame_repair_quality_gate_outcome_v1`
- `frame_repair_quality_gate_report_v1`
- `frame_repair_quality_gate_artifact_manifest_v1`

Session progress is derived from the exact plan and exact review/outcome
filenames. A mutable aggregate state file is not authoritative.

### 7.5 Browser controller and view

The browser controller prepares the selected case, delegates Plan/Generate/
Recover/Accept to the shipped Frame Repair lifecycle, loads sealed evidence,
manages blind-review state, and submits immutable review/outcome records. It does not
construct provider requests, write project JSON, or derive trusted hashes.

The view renders only real managed/artifact data. Missing evidence produces an
explicit blocked or unavailable state; it never fabricates a preview or metric.

## 8. Proposed Provider-Free API Surface

All new endpoints live under `/api/editor/*`, use thin route delegation, and
are provider-free:

| Method and route | Purpose | Provider calls | Project mutation |
| --- | --- | ---: | --- |
| `POST /api/editor/projects/:sourceProjectId/frame-repair-quality-gates/setup` | Copy six explicit managed assets, create two deterministic controls, and exclusively create the isolated target project | 0 | Creates the new target project only |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates/plan` | Validate and return a canonical session plan | 0 | No |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates` | Re-resolve authority and seal a new session plan | 0 | No |
| `GET /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId` | Return safe session/case state and artifact URLs | 0 | No |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId/cases/:caseId/review` | Seal one idempotent human verdict before Accept/Reject | 0 | No |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId/cases/:caseId/outcome` | Seal one idempotent terminal provider-blocked/accepted/rejected outcome | 0 | No additional mutation |
| `POST /api/editor/projects/:projectId/frame-repair-quality-gates/:sessionId/finalize` | Produce final aggregate evidence | 0 | No |

The existing Frame Repair Plan, live Generate, operation recovery, job polling,
and specialized Accept routes remain the only authorities for repair work. No
new endpoint accepts a batch of provider requests.

The exact Setup request contains only `expectedRevision`, `targetProjectId`,
`targetProjectName`, `ownershipConfirmed: true`, and six `sourceAssets` entries.
Each entry has `caseId`, `assetId`, and `expectedAssetRevisionId`; ids must be
distinct, safe, and bound to a current Character Pack revision. It contains no
path, binary, job payload, provider field, instruction, mask, base64, or secret.
The response returns the newly validated isolated project and deterministic
source-to-target asset mapping plus the setup-manifest SHA-256. Repair
instructions, masks, difficulties, and expected improvements belong to the
later provider-free session Plan.

A review record requires a hydrated candidate, complete hard-gate evidence, the
blind preference, and the revealed functional verdict. An accepted or rejected
outcome requires that exact sealed review. A provider-blocked,
outcome-unknown, or quality-blocked outcome has no human review and must bind to
the exact durable operation/quality evidence that caused the terminal state.

If specialized Accept succeeds but outcome recording is interrupted, the
browser must recover the already accepted child revision and retry only the
provider-free, idempotent outcome operation. The already sealed human review is
reused. It must never repeat Generate or Accept.

## 9. Session And Case State

### 9.1 Session state

The safe browser-facing session states are:

- `planned`
- `ready`
- `running`
- `paused`
- `reviewing`
- `finalized`

`paused` includes a controlled `blocking_reason`. It never authorizes a new
call. `finalized` is terminal and immutable.

### 9.2 Case state

Each planned case derives one of:

- `pending`
- `plan_ready`
- `awaiting_confirmation`
- `processing`
- `outcome_unknown`
- `provider_blocked`
- `candidate_ready`
- `quality_blocked`
- `awaiting_review`
- `awaiting_decision`
- `accepted`
- `rejected`

These quality-gate states do not replace or extend the global Job status enum.
They are a projection of the existing Frame Repair lifecycle plus sealed case
evidence.

### 9.3 Per-case flow

```text
fixed case
  -> zero-call Plan
  -> explicit single-call confirmation
  -> existing Generate operation
  -> Recover original operation when required
  -> candidate hydration or controlled provider-blocked outcome record
  -> automated hard gates
  -> blind visual review
  -> reveal Before/After
  -> usability/new-blocker verdict
  -> immutable review record
  -> specialized Accept or explicit Reject
  -> immutable outcome record
```

The next case unlocks only after the current case has a terminal record. A
paused or finalized session keeps every remaining case locked.

## 10. Call Accounting And Stop Rules

### 10.1 Call accounting

| Action | Calls |
| --- | ---: |
| Provider preflight | 0 |
| Session Plan or start | 0 |
| Per-case Frame Repair Plan | 0 |
| Per-case Generate | At most 1 |
| Recover, Review, Accept, Reject, record, finalize | 0 |
| Whole session | At most 8 |

The aggregate report derives calls from the exact durable Frame Repair operation
record referenced by each attempted case outcome. Pending cases contribute zero
calls and never receive a fabricated operation. Browser counters are
display-only.

### 10.2 Immediate safety pause

Pause the entire session immediately when any of these occurs:

- one case records more than one call or the session exceeds eight calls;
- decoded pixels outside the canonical mask change;
- any quality-gate request writes a source project, or the isolated project
  diverges from the exact chain of prior session Accept results;
- an unrelated isolated-project asset/revision changes;
- sealed artifact, Plan hash, operation identity, or revision integrity fails;
- the original operation has an unknown outcome and has not been recovered;
- resource supervision reports memory pressure, timeout, continuous growth, or
  an unresponsive process;
- evidence storage encounters path traversal, symlink, collision, short write,
  size mismatch, digest mismatch, or unexpected schema data.

There is no automatic resume. The user may inspect/export evidence and recover
the original operation through the existing read-only recovery path.

### 10.3 Provider-conservation pause

Pause after two consecutive calls produce no reviewable candidate. This avoids
spending the remaining budget on a route that is currently unavailable or
incompatible. The result is normally `evidence_insufficient` with a controlled
provider-blocking reason unless an independent hard-gate failure requires a
quality-gate failure.

## 11. Automated Hard Gates

A candidate cannot enter human review unless all required automated evidence is
complete. The gate includes:

- exact Plan/operation/job/case identity;
- exactly one provider call for a live reviewable candidate; zero is valid only
  for a pre-dispatch/provider-blocked terminal record;
- sealed artifact manifest integrity;
- decoded non-target and target-outside-mask RGBA equality;
- candidate and composited frame availability;
- Character Pack validator status and blocking errors;
- before/candidate/after bbox, foot anchor, baseline, and visible-pixel facts;
- transparent-edge/halo counts;
- significant-component evidence;
- neighboring-frame continuity evidence;
- current isolated-project revision chain and expected parent asset revision;
- absence of unrelated project/history/selection mutation.

Warnings may proceed to human review only when the existing quality contract
marks them non-blocking. Unknown or incomplete quality remains blocked.

## 12. Human Review Rubric

### 12.1 Blind preference pass

The first pass presents deterministic A/B ordering without Before/After labels.
The reviewer records:

- `prefer_a`
- `prefer_b`
- `no_material_difference`

The ordering is derived deterministically from session id and case id, recorded
in evidence, and revealed only after this choice. This reduces presentation
bias; it is not a security boundary.

### 12.2 Revealed functional pass

After reveal, the reviewer records:

- improvement: `improved`, `same`, or `worse`;
- usability: `usable`, `review_required`, or `blocked`;
- new blocking defect: boolean;
- controlled reason codes;
- optional NFC-normalized local note capped at 500 Unicode code points.

The optional note is evidence only. It is never included in a provider request.

### 12.3 Successful candidate definition

A completed candidate counts toward the quality numerator only when:

1. all automated hard gates pass;
2. improvement is `improved`;
3. usability is `usable` or `review_required`;
4. no new blocking defect is present.

Human review is authoritative for visual improvement. Automated metrics remain
visible evidence but do not silently override the reviewer.

## 13. Aggregate Decision Contract

The report always publishes:

- total planned cases: 8;
- provider calls used and remaining;
- completed candidates;
- provider-blocked/no-candidate cases;
- reviewed successful candidates;
- numerator, denominator, and improvement rate;
- hard-gate failure count and controlled reasons;
- results by difficulty and defect category;
- accepted, rejected, and unresolved counts;
- exact provider preset and session plan hash.

The final result is exactly one of:

### `passed`

- no hard-gate failure;
- all 8 cases have immutable terminal outcomes;
- at least 6 of 8 cases produce completed reviewable candidates;
- successful-candidate rate is at least 70% of completed candidates;
- the integer numerator is at least
  `ceil(0.70 * completed_candidates)`;
- calls used are at most 8.

### `quality_failed`

Either:

- a safety/integrity/accounting hard gate fails, with
  `failure_domain: safety`; or
- all 8 cases have terminal outcomes, at least 6 candidates complete, and fewer
  than 70% meet the successful candidate definition, with
  `failure_domain: visual_quality`.

### `evidence_insufficient`

- no safety hard gate failed; and
- fewer than 6 reviewable candidates completed, or the session ended without
  terminal outcomes for all 8 cases.

The report records a controlled cause such as provider unavailable, quota,
route, service, output, transport outcome unknown, or user-stopped after the
provider-conservation pause. `provider_blocked` is a cause, not a fourth final
status.

## 14. UI Design

### 14.1 Entry and capability truth

Quality Gate appears as a secondary mode from the existing Frame Repair
Workbench. Its provider-free setup surface can create/select the isolated
project and prepare a plan. Run controls remain disabled until that plan is
valid and sealed. Ordinary Frame Repair remains the primary flow.

If inputs, ownership confirmation, provider preflight, or the isolated project
are incomplete, the entry is disabled with an explicit reason. Future batch,
retry, model-comparison, or automatic-scoring features are not displayed as
active controls.

The Setup surface lists only Character Pack assets already present in the
currently loaded source project. It requires exactly six distinct selections,
shows the target id/name and ownership statement, and makes the target-project
creation mutation explicit. After Setup succeeds, the Editor adopts the returned
isolated project and all subsequent quality-gate setup is scoped to that target.

### 14.2 Selected desktop layout

The approved layout has four regions:

1. **Session bar:** case index, locked preset, calls used/maximum, difficulty,
   and hard-gate state.
2. **Focused canvas:** large deterministic A/B comparison with nearest-neighbor
   zoom, Split, Difference, Onion, canonical mask, and neighboring frames.
3. **Evidence rail:** expected improvement, automated facts, integrity,
   validator/continuity evidence, and safe local provider diagnostic copy.
4. **Eight-case progress strip:** compact terminal and in-progress states with
   the active case clearly marked.

The review action bar remains fixed within the quality-gate workspace. It first
collects blind preference and then the revealed usability/new-defect verdict.
The case cannot be sealed until required fields are complete.

### 14.3 Accept and Reject

Human scoring does not automatically Accept. `Accept revision` invokes the
existing specialized Frame Repair Accept contract against the isolated project.
`Reject candidate` seals a terminal rejected outcome without project mutation.

Programmatic clicks on disabled controls are ignored. Rapid duplicate Accept,
review, outcome, or finalize requests return the already persisted winner when
identity matches and conflict when it does not.

### 14.4 Progress strip states

Every item exposes text/icon state in addition to color:

- pending;
- processing;
- candidate ready;
- accepted/pass;
- rejected;
- provider blocked;
- paused/unknown.

Clicking a completed item opens its existing evidence. It never regenerates or
replays a call.

### 14.5 Final summary

The summary is a separate view containing:

- the exact final three-state result;
- numerator, denominator, and rate;
- calls used;
- difficulty/category breakdown;
- hard-gate and provider taxonomy;
- eight-case contact sheet;
- controlled artifact links.

A case without a candidate appears as a text-and-status cell in the contact
sheet. The report never fabricates an image for a blocked or incomplete case.

The page avoids comparative product or replacement claims. It describes only
the measured local session.

### 14.6 Responsive behavior

- Desktop receives the full focused review layout.
- Narrow desktop/tablet stacks the evidence rail below the canvas while keeping
  the progress strip horizontally scrollable and bounded.
- Mobile displays session progress, safe diagnostics, and the final report, but
  final pixel-quality verdict controls are disabled with the reason that desktop
  inspection is required.
- No content may sit behind fixed app chrome; the main review region must use
  bounded height and explicit overflow rather than creating a large empty page.

### 14.7 Accessibility

- One visible focus target per actionable control.
- Roving tab focus for the eight-case strip.
- Keyboard navigation must not conflict with form inputs or Canvas zoom.
- A single polite `aria-live` region announces case and processing transitions;
  metrics do not repeatedly announce during rendering.
- Disabled controls expose their reason through associated text.
- Status never relies on color alone.
- Blind A/B reveal updates labels and focus without replacing the focused
  control unexpectedly.

## 15. UI-To-Runtime Binding Contract

| UI action | Runtime binding | Provider calls | Project mutation |
| --- | --- | ---: | --- |
| Create isolated project | Specialized provider-free Setup | 0 | New target project only |
| Validate Session | New provider-free planner | 0 | No |
| Start Session | Seal canonical plan | 0 | No |
| Review AI Call | Existing Frame Repair Plan route | 0 | No |
| Generate one candidate | Existing Frame Repair live route and operation ledger | At most 1 | No |
| Recover original operation | Existing scoped operation GET | 0 | No |
| A/B, Split, Difference, Onion, zoom | Already hydrated local artifacts | 0 | No |
| Submit visual verdict | Seal provider-free review record | 0 | No |
| Accept revision | Existing specialized Frame Repair Accept | 0 | Isolated project only |
| Accept/Reject outcome | Seal provider-free terminal outcome record | 0 | No additional mutation |
| Finalize report | New provider-free aggregate writer | 0 | No |

No Frame Repair provider, mask, candidate, composite, package, or Accept
parameter is silently changed by the quality-gate layer.

## 16. Error And Recovery Behavior

- Known provider failures use only the shipped controlled reason/retry-hint
  taxonomy and fixed local UI copy.
- Unknown provider/transport outcomes pause the session and expose only Recover
  original operation.
- No failure text, response body, header, key, stack, absolute path, or raw
  provider payload enters public session JSON or the DOM.
- Stale project/asset revision stops the case before Generate.
- Setup source revision drift, duplicate source assets, existing target project,
  or incomplete managed Character Pack artifacts stop before target project
  publication.
- Missing/tampered artifacts block review and finalization.
- A completed Accept followed by an outcome-record interruption is recovered
  from the sealed review, exact project revision, and job evidence; only the
  provider-free outcome operation may repeat.
- Finalization is idempotent for the same evidence manifest and conflicts on a
  different manifest.
- Closing, refreshing, switching projects, or reopening the browser never
  enqueues work.

## 17. Storage And Security Requirements

- Sanitize all project, session, case, operation, job, asset, and revision ids.
- Reject absolute paths, traversal, backslashes where disallowed, symlinks,
  unexpected directories, and unexpected record keys.
- Read only exact managed artifacts declared by the sealed plan.
- Cap request bodies, notes, evidence JSON, image dimensions, decoded pixels,
  and final contact-sheet work.
- Capture bytes once before hashing/writing and verify size plus SHA-256 after
  exclusive writes.
- Never embed image bytes/base64 in project JSON or public session records.
- Keep provider keys server-side and out of logs, browser state, local
  preferences, artifacts, and reports.
- Never overwrite or automatically delete an existing session or case record.
- Never overwrite an existing target project or reuse an orphaned Setup
  directory.
- Use original repository code and assets only; no third-party archive code or
  art is copied into the gate.
- Add no runtime dependency. If implementation later proves a dependency is
  necessary, stop for separate approval and attribution review.

## 18. Performance And Resource Boundaries

- The Canvas animation/render loop performs no fetch, decode, hash, artifact
  enumeration, or DOM layout reads.
- Images are decoded outside rendering and cached by immutable artifact URL.
- Nearest-neighbor rendering is used for pixel inspection.
- Only the active case keeps full-resolution comparison surfaces mounted.
- Contact-sheet creation is bounded to eight cases and runs outside the browser
  draw loop.
- Tests, smoke, browser automation, servers, and builds use the checked-in
  process-tree resource supervisor.
- Focused tests use at most 1024 MiB V8 old-space, 1536 MiB process-tree RSS,
  serial execution, and 60 seconds unless a documented smaller baseline applies.
- The full suite runs at most once under its existing 4096 MiB RSS ceiling. Any
  memory growth, timeout, or pressure warning stops verification and is not
  automatically retried.
- Tracked local servers are stopped by exact session/PID when verification
  ends.

## 19. Testing Strategy

Implementation follows test-driven development and remains provider-free until
the separately authorized pilot.

### 19.1 Pure/core tests

- canonical plan and hash determinism;
- exact 6-real/2-control and 2-basic/4-medium/2-hard distribution;
- ownership, provider preset, call ceiling, id, path, schema, and size rejection;
- state derivation and stop rules;
- aggregate numerator/denominator and final three-state calculation;
- blind-order determinism and review-score mapping;
- frozen outputs and accessor/hostile-input handling.

### 19.2 Evidence and coordinator tests

- Setup accepts only six distinct current Character Pack assets with explicit
  ownership, clones exact bytes, builds two valid controls, and creates one new
  isolated project;
- Setup rejects source revision drift, duplicate assets, cross-project paths,
  symlinks, target collisions, short writes, digest mismatch, and invalid
  controls without changing the source project or publishing target JSON;
- exclusive plan/case/final writes and digest verification;
- exact-path reads with no artifact-root scanning;
- operation/job/case/Plan identity binding;
- zero/one-call aggregation;
- provider-blocked and outcome-unknown behavior;
- Accept-success/outcome-interruption recovery;
- no retry, fallback, second Generate, or duplicate Accept;
- no source-project mutation and isolated-project-only Accept;
- finalization idempotency and conflict behavior.

### 19.3 API and UI tests

- setup/plan/start/load/review/outcome/finalize envelopes and status codes;
- no new endpoint can dispatch provider work;
- empty, loading, blocked, paused, processing, candidate, review, accepted,
  rejected, evidence-insufficient, quality-failed, and passed states;
- focused canvas, evidence rail, and eight-case progress strip;
- blind A/B then reveal flow;
- disabled/programmatic event rejection;
- one polite live region, focus restoration, and roving strip navigation;
- mobile report-only truth and desktop-only verdict reason;
- no raw error reflection, `innerHTML`, base64, provider secrets, or active future
  controls.

### 19.4 Browser and smoke verification

- 1440 x 900 full deterministic injected-provider flow;
- 390 x 844 progress/report-only flow;
- no console errors or warnings;
- no hidden overflow or app-chrome overlap;
- no network call during Canvas-only interactions;
- one deterministic successful Accept and one Reject in the isolated project;
- source projects, project history, and unrelated selections remain unchanged;
- local smoke passes and the exact server is stopped.

### 19.5 Static audits

- no changes under provider adapters, Character Pack pipeline, exporters,
  package files, or attribution unless separately authorized;
- no second provider dispatch site;
- no error-message/body/header/key/path reflection in quality-gate evidence/UI;
- no direct project JSON write from UI;
- no artifact-root scans;
- no generated fixture or local screenshot staged.

## 20. Separately Authorized Live Pilot

The live pilot begins only after implementation and all zero-call checks pass.
Before the first call, the user must explicitly confirm:

1. the exact provider preset selected by the safe preflight;
2. the maximum total budget of eight calls;
3. ownership of the six real Character Pack samples;
4. the sealed eight-case plan and expected improvement criteria.

The pilot proceeds sequentially. Every case uses the existing explicit
single-call confirmation. There is no unattended run. Evidence is sealed after
each terminal case, and every stop rule is enforced before another case can be
confirmed.

If the gate passes, the report supports promoting the exact tested live path
from Experimental/opt-in for that evidence boundary. It does not establish
arbitrary-character, arbitrary-provider, or broad production quality. If it
fails or is inconclusive, the taxonomy determines the smallest next repair:
provider access, output contract, a specific visual defect category, or browser
acceptance evidence.

## 21. Implementation Sequence Boundary

The later implementation plan should keep these units separate and verified:

1. protocol, canonical planner, and pure aggregate decision;
2. append-only evidence writer and quality-gate coordinator;
3. provider-free Editor API delegation;
4. browser lifecycle/controller with existing Frame Repair delegation;
5. approved focused-review UI and responsive states;
6. zero-call focused/full/smoke/security verification;
7. separately authorized eight-call live pilot and report review.

Do not combine the live pilot with implementation. Do not advance to provider
calls merely because automated verification succeeds.

## 22. Design-To-Implementation Contract

This document is the UI and behavior source of truth for the quality-gate
feature. Later implementation must record any deviation in the closeout:

- visual/layout deviation;
- copy or status deviation;
- interaction deviation;
- capability-truth deviation;
- API/data-binding deviation;
- responsive/accessibility deviation.

Every approved visible control must bind to the real behavior described in the
UI-to-runtime table. An unavailable capability must be hidden, disabled with a
reason, or marked for later work; it must not appear active.

## 23. Acceptance Checklist

- [ ] Exactly six user-owned real cases and two repository-generated controls
      are locked before start.
- [ ] Setup reads six explicit assets from one source project, never mutates it,
      and exclusively creates one new isolated target project.
- [ ] Difficulty is exactly two basic, four medium, and two hard cases.
- [ ] One exact configured preset is locked after a zero-call preflight.
- [ ] Every case uses the existing Plan/Generate/Recover/Review/Accept path.
- [ ] No quality-gate endpoint can dispatch provider work.
- [ ] Every Generate consumes at most one call; the session consumes at most
      eight.
- [ ] Two consecutive no-candidate outcomes pause the session.
- [ ] Any integrity, accounting, unexpected mutation, or resource breach pauses
      the session immediately.
- [ ] Automated hard gates complete before human review.
- [ ] Blind A/B preference precedes Before/After reveal.
- [ ] The user's visual verdict is authoritative and stored with controlled
      evidence.
- [ ] Success requires at least six completed candidates and at least 70%
      successful completed candidates.
- [ ] The final status is exactly `passed`, `quality_failed`, or
      `evidence_insufficient`, with explicit denominator and cause/domain.
- [ ] Accept mutates only the isolated project's exact asset revision.
- [ ] Reject, provider failure, recovery, close, and finalize do not mutate the
      project.
- [ ] Ordinary Frame Repair and the old application remain available.
- [ ] Desktop provides focused review plus an eight-case progress strip; mobile
      is truthful report-only for final visual verdicts.
- [ ] Evidence is append-only, exact-path, size/digest verified, and contains no
      credentials or raw provider error content.
- [ ] Automated verification makes zero real provider calls.
- [ ] A later live pilot requires a second explicit authorization before any
      call is made.
