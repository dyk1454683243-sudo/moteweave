# Character Production Quality Master Plan

**Date:** 2026-07-16  
**Status:** A-E implemented, guarded-verified, and independently committed
**Owner:** Project lead  
**Baseline:** `ac0abee3ad33d3279c4b59e3db2781e7e61cb7e7` on `codex/frame-repair-live-quality-gate`

## 1. Decision Summary

This plan turns the useful parts of the externally supplied suggestion page into
five original, repository-owned work blocks. The page is advisory evidence only.
No external code, UI, algorithm implementation, prompt, or asset is copied.
Product names, public identifiers, and compatibility language continue to obey
`AGENTS.md`.

Execute A before B. A and B have separate product contracts and implementation
plans because they change protected pipeline, validator, API, and UI behavior.
C, D, and E were subsequently authorized and completed in sequence. Each has
its own design/implementation lineage and independent implementation commit.

The central product decision is to enforce evidence the repository already
produces before inventing new evaluators or a larger guided workflow.

## 2. Evidence Baseline

### 2.1 Verified facts

- Production-sheet candidates are ranked, but the current selection path accepts
  the highest-scoring candidate whenever a processed result exists. A candidate
  with blocking evidence can therefore win selection.
- Character Pack processing already emits validation, source-quality, and
  `quality_closure.release_ready` evidence.
- Quality Character candidates currently report `pass` after any successful
  local finishing operation, even when existing composition metrics cross the
  repository's offline-review hard thresholds.
- Motion Source preview marks all preview frames selected, the browser sends the
  resulting indexes, and the builder interprets any non-empty index list as
  manual selection. The default browser flow therefore bypasses the automatic
  selector.
- Motion Source currently moves browser files through ArrayBuffer, binary
  string, Base64, JSON serialization, unbounded server body buffering, and a
  second Base64 decode. The displayed 200 MiB video limit is not a process-tree
  memory boundary.
- Motion jobs have no source digest/epoch binding, no cancellable poller, and no
  server-side cancellation authority.
- FFmpeg and rembg are invoked without a process-tree RSS ceiling, wall-clock
  deadline, AbortSignal, or exact process-group termination.
- Pixel Grid Refinement already has cell-size detection, phase/offset,
  autocorrelation fallback, alpha-weighted block voting, shared palette, and a
  passthrough mode.
- Motion selection currently compares near-duplicates with the previous
  distinct frame and loop quality with only the first/last frame.

### 2.2 Reasonable inferences

- Enforcing existing generation evidence will reduce false release claims more
  reliably than adding a second scoring system.
- Explicit Motion selection authority must land before registration or periodic
  selection improvements; otherwise better automatic selection remains bypassed
  by the default UI path.
- A staged binary upload and stable source descriptor are prerequisites for
  meaningful cancellation and bounded external-tool execution.
- Pixel Grid and Motion Selection v2 should remain deterministic and
  provider-free before any guided UI claims those capabilities.

### 2.3 Still requires verification

- The pass rate of the strict generation release policy across the repository's
  owned golden inputs. Automated implementation tests remain provider-free; a
  later live gate needs separate Provider-call approval.
- Real peak RSS for representative 200 MiB videos, hostile GIF/ZIP inputs,
  FFmpeg, and rembg. B starts with conservative ceilings and does not raise them
  without explicit approval.
- Registration, global temporal clustering, periodicity, sequence grid
  consensus, and harmonic rejection quality on owned benchmark samples.
- Any semantic image gate. It remains evidence-only until an owned benchmark
  proves that it is safe enough to block release.

## 3. Execution Board

| Block | Priority | Goal | Existing capability | Real gap | Dependencies | Rough engineering time | Authorization |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| A. Generation Release Gate | P0 | Only publish a generation candidate when existing structural evidence is release-ready | Candidate ranking, validation, source-quality, quality closure, offline Quality Character review | Ranking is not release eligibility; Quality Character has no runtime hard gate; blocked artifacts still look publishable | None | 3-5 days | Implemented and focused-verified |
| B. Motion Source Correctness & Safety | P0 | Restore automatic selection authority and bound input/job/tool resources | Preview/build flow, deterministic selector, Job store, optional FFmpeg/rembg | Default UI forces manual mode; Base64 body amplification; stale jobs; no cancellation; unbounded tools/decode | A only for execution order, not code | 6-10 days | Implemented and guarded-verified |
| C. Pixel Grid v2 | P1 | Improve multi-frame pixel-grid consistency without weakening passthrough | Per-frame cell/phase detection, fallback, block vote, shared palette | Sequence consensus, harmonic rejection, detail protection, optional OKLab, outline-last convergence, versioned recipe/UI | A; owned benchmark | 5-8 days | Complete; implementation commit `0a6353a` |
| D. Motion Selection v2 | P1 | Select globally distinct, registered, periodic action phases | Deterministic sampling, local duplicate filtering, first/last loop score | Pre-score registration, global clustering, periodicity, action phase, optional temporal matte | B; owned motion benchmark | 6-9 days | Complete; implementation commit `f6a6a03` |
| E. Guided Motion Source UI/HUD | P2 | Guide users through truthful source, selection, cleanup, and export states | Parallel Motion Source tab and real artifact rendering | Step guidance, explicit evidence HUD, recovery/cancel UX, capability messaging | B and D; C for grid HUD | 4-7 days | Complete; implementation commit `493f609` |

The estimates include focused tests and documentation but exclude live Provider
calls, benchmark sample acquisition, and any approved increase above current
resource ceilings.

## 4. Dependency Order

```text
A Generation Release Gate
|- C Pixel Grid v2

B Motion Source Correctness & Safety
|- D Motion Selection v2
`- E Guided Motion Source UI/HUD

D Motion Selection v2 -> E Guided Motion Source UI/HUD
C Pixel Grid v2       -> E Pixel/Grid evidence HUD
```

The approved work was executed in this order:

1. Land this master plan plus the independent A and B contracts/plans. `Done`
2. Implement A with provider-free focused tests. `Done`
3. Commit A as one verified unit. `Done: 371e7c5`
4. Implement B1, B2, and B3 in that order. `Done`
5. Verify B through focused tests, guarded full-suite reruns only after concrete
   defects were identified and fixed, and the guarded local smoke after the UI
   path was complete. `Done`
6. Commit B as a separate verified unit. `Done in the independent B closure
   commit that contains this status update`
7. Implement, guarded-verify, and independently commit C. `Done: 0a6353a`
8. Implement, guarded-verify, and independently commit D. `Done: f6a6a03`
9. Implement, visually/guarded-verify, and independently commit E.
   `Done: 493f609`

## 5. Block Boundaries

### 5.1 A - Generation Release Gate

In scope:

- A versioned `generation_release_gate_v1` evaluator.
- Strict release eligibility for live Production Sheet candidates using the
  existing validation, applicable source-quality, and quality-closure evidence.
- A deterministic Quality Character hard gate derived from existing owned
  offline-review thresholds.
- Candidate reports that distinguish the best diagnostic candidate from the
  release-selected candidate.
- `failed_quality_gate` terminal semantics and diagnostic-only artifacts without
  ZIP or engine-export download authority.
- Consistent CLI/API/UI/job evidence and provider-free tests.

Not in scope:

- Prompt changes, new semantic validation, new repair algorithms, Pixel Grid v2,
  extra Provider calls, fallback changes, adaptive candidates, or automatic
  retry.
- Changing `/api/process-sheet`; A applies to live text-to-image generation.

Exit condition: a blocked candidate cannot become a release artifact in either
generation mode, a lower-scoring eligible candidate can win release, diagnostic
evidence remains inspectable, and Provider failures retain their current
taxonomy.

### 5.2 B - Motion Source Correctness & Safety

In scope:

- B1: explicit `auto | manual` selection authority with a legacy migration rule.
- B2: browser-to-server binary upload, bounded legacy JSON, stable source
  identity, stale-result rejection, cancellable/resumable polling, queued/active
  cancellation, and decode budgets.
- B3: a single-concurrency media boundary with process-tree RSS, timeout,
  AbortSignal, bounded stderr, and exact process-group termination for FFmpeg
  and rembg.
- Removal of browser authority over local input/output/tool paths.

Not in scope:

- Registration, global near-duplicate clustering, periodic loop detection,
  action-phase inference, or temporal matte; those belong to D.
- A guided redesign, onboarding flow, or expanded HUD; those belong to E.
- Bundling FFmpeg, rembg, model weights, or third-party assets.

Exit condition: default Preview -> Build uses the automatic selector; manual
selection is explicit; the new UI no longer Base64-encodes Motion files; late
jobs cannot overwrite a different source; cancellation reaches active tools;
and tool/decode resource breaches fail once with stable evidence and no retry.

### 5.3 C - Pixel Grid v2

Start only after A is complete and an owned multi-frame benchmark is fixed.
Preserve v1 passthrough. Add sequence cell/phase consensus, reject harmonic
aliases before refinement, protect high-detail regions, make OKLab opt-in, apply
outline-last consistently, and record a versioned recipe. Do not expose controls
until they map to implemented behavior.

### 5.4 D - Motion Selection v2

Start only after B proves the automatic path is authoritative and bounded.
Register frames before scoring, cluster duplicates across the full sequence,
estimate periodicity, select action phases, and evaluate optional temporal matte
as a separate experiment. Keep every rejection and phase decision explainable.

### 5.5 E - Guided Motion Source UI/HUD

Start only after B and D. Reuse real artifacts and state; never show future
cleanup, selection, or semantic capabilities as active. The UI design becomes
the source of truth only after a separately approved design contract records
desktop/mobile layout, states, keyboard behavior, and every known deviation.

## 6. Deferred Experiments

- Semantic Gate: evidence-only experiment first. It may become blocking only
  after an owned benchmark establishes precision, recall, and failure review.
- Adaptive candidates: no automatic extra spend. Any later design must include
  an explicit Provider-call budget, idempotent recovery, and a visible user
  decision before increasing cost.
- Per-action high-quality mode: defer until D proves action-phase selection.
- Default OKLab refinement: defer until C's owned benchmark proves the mutation
  trade-off; begin as an opt-in recipe path.

## 7. Safety And Ownership

- Only the primary agent/test owner may run a test, build, server, browser, or
  media process. Every command uses the checked-in resource guard.
- Focused tests remain serial with the repository's 1024 MiB V8, 1536 MiB
  process-tree RSS, and 60-second defaults unless a documented media case uses
  a lower-than-4096 MiB explicit budget.
- Run the full suite only after focused B verification. A failed full run may be
  rerun only after its concrete lifecycle, fixture, assertion, or integration
  defect is identified and fixed. Stop after a timeout, pressure event,
  unexplained growth, or resource breach.
- No automated test calls a live Provider. Live evidence requires a separate
  named preset, maximum call budget, and explicit approval.
- Do not scan `output/`, `generated/`, or unrelated artifact directories.
- Preserve the existing untracked `* 2.js`, `* 2.md`, and `.superpowers/`
  paths. Do not write to the exclusive
  `.worktrees/frame-repair-live-quality-gate-implementation` worktree.
- Each protected pipeline, validator, prompt, API, or UI behavior change must
  stay within its approved block contract. Record deviations before
  implementation.

## 8. Status Ledger

| Milestone | State | Evidence |
| --- | --- | --- |
| Read-only feasibility audit | Complete | Repository evidence reviewed on 2026-07-16 |
| A-E master plan | Complete | Planning commit `eb15108` plus this closure update |
| A design and implementation plan | Complete | Linked A design/plan |
| A implementation | Complete on 2026-07-16 | Commit `371e7c5`; versioned gate, diagnostic/release selection, gate-aware writers/API/CLI/UI, guarded focused tests |
| B design and implementation plan | Complete | Linked B design/plan |
| B implementation | Complete on 2026-07-16 | B1-B3 implementation, provider-free focused tests, full suite, self-hosted smoke, and independent B closure commit |
| C implementation | Complete on 2026-07-16 | Pixel Grid v2 commit `0a6353a`; independent closure `cfa74b8` |
| D implementation | Complete on 2026-07-16 | Motion Selection v2 commit `f6a6a03`; independent closure `36b6397` |
| E design | Complete on 2026-07-16 | Guided Motion Source contract commit `18c117b` |
| E implementation | Complete on 2026-07-16 | Guided/Advanced workflow, evidence HUD, fail-closed artifact lineage, responsive/i18n/a11y verification; commit `493f609` |

Guarded B verification completed on 2026-07-16. The final full run passed all
`1357 / 1357` tests in `135.864s`, with `831568 KiB` peak process-tree RSS and
`5` peak processes. `npm run smoke:local` passed in `3.741s`, with `708432 KiB`
peak process-tree RSS and `3` peak processes. The smoke wrapper cleared direct
Provider-key variables, made no Provider call, and left no tracked smoke/server
process. No timeout, memory-pressure event, or resource breach occurred.

Final A-E closure verification on 2026-07-16 passed `1431 / 1431` tests in
`151.804s`; the guard elapsed `151.862s`, with `846,256 KiB` peak
process-tree RSS and `6` peak processes. The final Chrome matrix passed in
`11.734s`, with `1,630,048 KiB` peak RSS and `11` peak processes, covering
Guided/Advanced switching, 1440/1024/800/390 layouts, real provider-free
Preview/Build/Apply, stale bindings, missing/unreadable JSON and image
artifacts, same-store and cross-store error isolation, failed-retry
preservation, and edited-strip authority. Two independent read-only reviews
reported no remaining Blocker/High. The final independent local smoke passed
in `3.867s`, with `735,920 KiB` peak RSS and `3` peak processes. No Provider
was called.

## 9. Completion Rules

- A is complete only when both generation modes use the release gate, all
  blocked results are terminal and diagnostic-only, focused tests pass, and A
  has its own commit.
- B is complete only when B1-B3 are implemented, focused tests and the guarded
  full suite pass, the self-hosted local smoke passes under the repository
  rules, no tracked smoke/server/external-tool process is left running, and B
  has its own commit.
- C is complete only with versioned opt-in recipes, deterministic sequence
  evidence, guarded tests, and its independent commit; those conditions are
  satisfied by `0a6353a`.
- D is complete only with explicit v2 authority, bounded registration and
  clustering/periodicity evidence, guarded tests, and its independent commit;
  those conditions are satisfied by `f6a6a03`.
- E is complete only when Guided is real, Advanced remains functional,
  artifact lineage fails closed, responsive/a11y/i18n/browser verification
  passes, and E has its own commit; those conditions are satisfied by
  `493f609`.
- A passing automated suite is implementation evidence, not a claim of live
  Provider quality, semantic correctness, or universal media compatibility.
