# Phase B2: Server Domain Route Dispatch Split

**Date:** 2026-07-30
**Status:** Implemented and merged in PR #22 on 2026-07-30
**Baseline:** `d001fc99aea1427771dc894d0801c5b123c035f4` (PR #21 merge)
**Scope:** Split only HTTP method/path matching and dispatch ownership out of
`server.js` into small domain route modules. Keep every handler body, service,
queue, endpoint contract, and runtime side effect unchanged.

## Goal

Make the local API dispatch table readable by domain without turning this pass
into a backend rewrite. `server.js` remains the composition root and continues
to construct every service, queue, store, coordinator, and handler dependency.
New route modules decide only whether a request matches an existing route and,
when matched, call the injected existing handler exactly once with the same
arguments.

This phase is successful only when all current requests produce the same
status, headers, JSON or streamed body, side effects, handler ordering, and
static fallback as the baseline.

## Why This Is The Smallest Safe Split

`server.js` currently contains both the application composition root and one
linear API dispatch block. Its handler implementations close over sensitive
runtime state: Provider configuration, job queues, Motion upload/lifecycle
stores, generated directories, and Editor coordinators. Moving those handler
bodies at the same time as route matching would create a large dependency
injection refactor and increase contract risk.

Phase B2 therefore extracts only route matching. Handler extraction, service
relocation, a server rewrite, and backend architecture changes are deferred.
The resulting seam can support later independently approved work, but this
phase does not pre-authorize it.

## Hard Scope Boundary

Allowed implementation work:

- Add pure domain route dispatch modules under `src/server/routes/`.
- Add one focused route-dispatch test.
- Modify only the final API dispatch composition in `server.js` plus the new
  route-module imports and injected handler table.
- Update an existing server-wiring assertion only if the same dependency is
  still visibly constructed and injected but its source-text location changes.
  Any such update must remain in the exact server-wiring test that owns the
  assertion.

Prohibited implementation work:

- Do not change a handler body, helper body, service, queue, store, coordinator,
  pipeline, Provider, exporter, validator, protocol, job state, or artifact
  writer.
- Do not move domain handler implementations out of `server.js`.
- Do not change `src/editor-project/*`, `src/motion-source/*`,
  `src/character-pack/*`, `src/scene-pack/*`, `src/project-pack/*`, or
  `src/two-point-five-d/*`.
- Do not change `src/ui/*`, `index.html`, `editor.html`, `src/v8.css`, or any
  visible copy or interaction.
- Do not add middleware, a web framework, TypeScript, a bundler, a dependency,
  a generalized router, a compatibility alias, a feature flag, or new logging.
- Do not add, remove, rename, normalize, redirect, or reorder endpoints.
- Do not change body parsing, upload streaming, response serialization,
  authentication assumptions, Provider confirmation, budgets, polling,
  cancellation, cleanup, static serving, or error handling.
- Do not run a browser, Provider, model, live generation, or external-network
  workflow. Guarded loopback integration tests remain allowed.

If implementation requires any prohibited change, stop and request a new,
explicitly approved plan instead of extending Phase B2.

## Route Module Contract

Add one small router function per domain. A router receives:

```text
{ req, res, url, handlers }
```

Each router must:

1. Inspect only `req.method`, `url.pathname`, and the exact baseline regular
   expressions needed to extract an existing dynamic id.
2. Return `false` without mutating `req`, `res`, `url`, or application state
   when no route matches.
3. On a match, call exactly one injected handler with the same positional
   arguments used by the baseline, await it, and return `true`.
4. Let handler errors propagate exactly as they do today. Do not catch,
   translate, retry, log, or wrap them.
5. Never read a body, send a response, access environment variables, import a
   pipeline, or own runtime state.

The aggregate router invokes domain routers in an explicit fixed order and
returns `false` only when no API route matched. `server.js` then calls the
existing `serveStatic(req, res)` fallback exactly as before.

## Planned Files

Add:

- `src/server/routes/editor.js`
- `src/server/routes/shared.js`
- `src/server/routes/character.js`
- `src/server/routes/motion.js`
- `src/server/routes/scene.js`
- `src/server/routes/project.js`
- `src/server/routes/index.js`
- `test/serverRouteDispatch.test.js`

Modify:

- `server.js`

Existing server-wiring tests are expected to remain unchanged because
`server.js` must continue constructing and visibly injecting the same
dependencies. If one source-structure assertion needs relocation, the
path-limited diff must explain why, and no behavioral assertion may be
weakened.

No other file is in scope.

## Exact Route Ownership

### Editor router

- Prefix match: `/api/editor/*`
- Existing owner called:
  `handleEditorProjectApi(req, res, existingEditorDependencies)`
- Preserve the Editor route as the first API domain check.
- The existing Editor dependency object remains constructed in `server.js`;
  the router receives one injected closure and never gains workspace or
  generated-path authority.

### Shared router

- Prefix match: `GET` with `url.pathname.startsWith('/api/jobs/')`
- Preserve the current last-path-segment job id extraction without adding new
  segment-count or empty-id validation.
- Preserve `{ status: "not_found" }` with HTTP 200 when `getJob(id)` has no
  result.
- The router receives a handler closure; it does not import or access the job
  store.

### Character router

- `GET /api/gemini-state`
- `GET /api/benchmark-gallery`
- `POST /api/provider-config`
- `POST /api/repair-character-action`
- `POST /api/process-sheet`
- `POST /api/generate-character`
- `POST /api/build-frame-gif`

For `/api/gemini-state`, keep `loadLocalEnv()` immediately before
`publicProviderState()` inside the injected server-owned handler closure.
Provider keys, runtime Provider state, candidate budgets, release gates, and
job creation remain outside the router.

### Motion router

- `GET /api/motion-source-tool-status`
- `POST /api/motion-source/uploads`
- `DELETE /api/motion-source/upload-operations/:operationId`
- `DELETE /api/motion-source/uploads/:uploadId`
- `POST /api/motion-source/jobs/:jobId/cancel`
- `POST /api/analyze-motion-source`
- `POST /api/preview-motion-frames`
- `POST /api/build-motion-strip`
- `POST /api/apply-motion-strip`
- `POST /api/analyze-motion-source-set`
- `POST /api/apply-motion-source-set`

Preserve the exact baseline regular expressions and id extraction:

- upload operation id: final path segment;
- upload id: final path segment;
- cancelled job id: penultimate path segment.

The upload request continues to receive the existing parsed `url` object. No
router may read upload bytes, claim an operation, touch lifecycle state, or
release a file.

### Scene router

- `POST /api/process-scene-tiles`
- `POST /api/generate-scene-tiles`
- `POST /api/build-two-point-five-d-tileset`
- `POST /api/two-point-five-d-material-source-benchmark`

Scene and 2.5D remain separate pipeline domains behind one small route owner
only for this dispatch phase. No live-generation confirmation, Provider-call
budget, candidate count, raw-tile policy, or artifact behavior changes.

### Project router

- `POST /api/project-pack`

Project Pack continues to compose existing generated artifacts and must not
gain generation or UI ownership.

### Static fallback

The aggregate API router does not own `/`, `/index.html`, `/editor`,
`/editor.html`, `/src/*`, or `/generated/*`. `server.js` continues to call the
existing `serveStatic(req, res)` only after every API router returns `false`.
The loopback listener, path containment checks, realpath validation, content
types, symlink rejection, and allowlist remain untouched.

## Contract Preservation Checklist

Implementation must demonstrate all of the following:

- Exact HTTP methods and path strings are unchanged.
- Exact prefix and regular-expression matches are unchanged.
- Dynamic ids are extracted from the same path segments.
- Every matched request calls exactly one existing handler.
- Every unmatched request reaches the same static/404 path.
- Handler positional arguments and the parsed `URL` object are unchanged.
- `await` behavior is preserved for async handlers and benchmark gallery
  generation.
- No request body is read earlier or more than once.
- No response is sent by both a router and a handler.
- No handler is invoked during router construction.
- Editor remains first and static serving remains last.
- `loadLocalEnv()` timing for `/api/gemini-state` is unchanged.
- Provider configuration remains process-local and secrets remain server-side.
- Character and Scene Provider confirmations and call budgets are unchanged.
- Character release-gate and terminal job semantics are unchanged.
- Motion remains provider-free; upload, operation-id, source identity,
  selection, polling, cancellation, and cleanup contracts are unchanged.
- Shared `/api/jobs/:id` response behavior is unchanged.
- Editor workspace/generated roots, coordinators, revision checks, and
  specialized acceptance routes are unchanged.
- Project Pack, 2.5D, and frame-GIF inputs and artifacts are unchanged.
- Static allowlist and loopback-only listener are unchanged.
- No UI, protocol, dependency, package metadata, or generated artifact changes.

## Phase 1 — Add Pure Domain Dispatchers

Add the seven route modules and `test/serverRouteDispatch.test.js`. Do not wire
them into `server.js` yet.

The focused test uses handler spies only to verify dispatch ownership; it does
not replace the existing real-server integration tests. Cover:

- every exact method/path pair in the ownership table;
- wrong-method and near-match rejection;
- all three Motion dynamic-id extractions;
- Editor prefix ownership;
- one-and-only-one handler call per match;
- no handler call for an unmatched path;
- aggregate ordering and `false` fallthrough.

Completion gate:

- Only the new route modules and new focused test are changed.
- Route modules import no pipeline, Provider, store, filesystem, environment,
  HTTP listener, or UI module.
- `npm run test:focused -- test/serverRouteDispatch.test.js` passes under the
  checked-in focused resource supervisor.
- `git diff --check` passes.

Commit boundary:

```text
refactor: add domain API route dispatchers
```

## Phase 2 — Wire The Existing Handlers

Modify only the API dispatch portion of `server.js`:

1. Import the aggregate router.
2. Construct injected closures around the existing handlers and exact
   server-owned dependencies.
3. Replace the linear API `if` block with one aggregate-router call.
4. Keep `serveStatic(req, res)`, `http.createServer`, and `server.listen`
   behavior unchanged.

Do not move or edit handler/helper bodies. Do not reorder initialization.

Completion gate:

- The final path-limited diff contains only the planned files.
- Every baseline endpoint appears exactly once in the new domain tables.
- `server.js` still constructs the same two queues and all existing services,
  stores, ledgers, and coordinators exactly once.
- Existing static server-wiring assertions remain intact; any unavoidable
  source-location adjustment preserves or strengthens the original assertion.
- The guarded focused command passes:

```bash
npm run test:focused -- \
  test/serverRouteDispatch.test.js \
  test/serverOpenRouter.test.js \
  test/character-pack/characterActionRepairApi.test.js \
  test/motion-source/api.test.js \
  test/editor-project/editorProjectApi.test.js
```

- `git diff --check` passes.

Commit boundary:

```text
refactor: delegate local API routing by domain
```

## Phase 3 — Final Contract Gate

Run one final protected-boundary review before any merge:

1. Compare the baseline and new route ownership tables path by path.
2. Review the complete path-limited `server.js` diff and confirm that no
   handler/helper body changed.
3. Run the guarded full `npm test` suite exactly once, serially.
4. Do not run a build, browser smoke, Provider, model, live generation, or
   external-network workflow; none is required for a route-only Node server
   refactor. Existing guarded loopback integration tests remain required.
5. Obtain an independent read-only review because `server.js` is a protected
   contract file.

Completion gate:

- Focused tests pass under the 1024 MiB V8 / 1536 MiB process-tree RSS /
  60-second ceiling.
- The one full suite passes under the 2048 MiB V8 / 4096 MiB process-tree RSS
  ceiling and configured finite timeout.
- Independent review records zero endpoint, payload, lifecycle, Provider,
  Editor, static-serving, or job-state changes.
- Worktree is clean after the final commit.

No Phase 3 commit is needed unless an approved test-only correction is required.
Allow at most one minimal repair-and-verification loop. A handler or contract
defect requires stopping for human approval, not an in-scope repair.

## Rollback

The two implementation commits are independently reversible.

- If runtime wiring fails, revert only
  `refactor: delegate local API routing by domain`; the unused pure route
  modules have no runtime effect.
- If the route contract itself is wrong, revert the wiring commit first, then
  revert `refactor: add domain API route dispatchers`.
- Use ordinary `git revert` commits. Do not use `git reset --hard`, delete
  worktrees, or bulk-delete files.
- Verify the restored baseline with the smallest previously failing focused
  test before considering any larger suite.

## Residual Risks

- Source-text wiring tests may encode the current inline dispatch layout even
  when runtime behavior is unchanged. Preserve the underlying assertion and
  adjust only the exact source location if necessary.
- Grouping routes by domain can accidentally alter precedence. Editor-first,
  static-last ordering plus complete dispatch tests are mandatory.
- An injected closure can accidentally capture a computed value too early.
  Provider state and local environment loading must remain request-time work.
- A router could accidentally send a response and then fall through. The
  boolean matched contract and one-call tests must prevent double handling.
- Existing integration tests cover real local server behavior, but only the
  final full suite gives repository-wide confidence for this protected file.

## Explicit Approval Gate

Stop after this plan is reviewed and committed. Do not implement Phase 1,
modify `server.js`, or create runtime route modules until the human user
explicitly approves this named Phase B2 plan.

## Implementation Closure

**Completed:** 2026-07-30
**Pull request:** #22, `refactor: split local API routing by domain`
**Merge commit:** `ceec539b3459b645e11dbdd097097527832c1a22`

Implementation remained inside the approved dispatch-only boundary:

- `b781cc4` — add the approved Phase B2 plan;
- `0a7bafa` — add pure domain route dispatchers;
- `ec5c358` — delegate the existing local API routing by domain;
- `9abc6a9` — lock aggregate route order after independent review.

Final verification evidence:

- focused route coverage passed `28 / 28`;
- the guarded focused integration gate passed `54 / 54` in `16.46s`, with
  `621,296 KiB` peak process-tree RSS;
- the guarded full suite passed `1,573 / 1,573` in `128.34s`, with
  `849,216 KiB` peak process-tree RSS;
- the post-review route-order check passed `29 / 29`;
- `git diff --check` passed;
- the final independent read-only review recorded no P0-P3 findings.

No browser, build, Provider, model, live generation, external-network,
endpoint, payload, lifecycle, pipeline, exporter, validator, Editor, or static
serving behavior was changed or required for this route-dispatch-only phase.

## Scoped Improvement Pass Closure

The complete approved pass is represented by:

- Phase A — UI and repository-safety pass: PR #20, merge
  `e3d3ce8ca8a25913f381ac34a7a0eade83b692ba`;
- Phase B1 — shared Motion Source options model: PR #21, merge
  `d001fc99aea1427771dc894d0801c5b123c035f4`;
- Phase B2 — server domain route dispatch split: PR #22, merge
  `ceec539b3459b645e11dbdd097097527832c1a22`.

Phase A navigation was manually confirmed, including every item in More.
Phase B1 received the real local Analyze, Preview, and Build acceptance recorded
above. Phase B2 required no manual browser gate and passed the complete
repository suite. The scoped pass is therefore closed without implying that
roadmap candidates, deferred experiments, or the separately authorized Frame
Repair live-provider pilot are complete.
