# Generation Release Gate v1 Implementation Plan

**Status:** Completed and provider-free focused-verified on 2026-07-16

**Goal:** Make existing local generation evidence authoritative so only
release-ready Production Sheet and Quality Character candidates are published,
while blocked runs keep diagnostic evidence and preserve Provider/failure
taxonomy.

**Architecture:** Add one pure, versioned release-gate module shared by runtime
candidate evaluation and offline review. Generation evaluates every processed
candidate, keeps diagnostic ranking separate from release selection, and passes
an explicit artifact disposition to gate-aware writers. The server projects the
result into existing job evidence plus terminal `failed_quality_gate`; the
browser renders diagnostics without enabling exports.

**Tech stack:** Node.js ES modules, `node:test`, existing Sharp/image helpers,
plain browser modules, and the checked-in process-tree resource supervisor.

The task checklists below retain the approved execution sequence and are marked
complete. Completion evidence is recorded in the implementation record at the
end of this document.

---

## Normative Source And Boundaries

- Approved design:
  `docs/superpowers/specs/2026-07-16-generation-release-gate-v1-design.md`.
- Master plan:
  `docs/superpowers/plans/2026-07-16-character-production-quality-master-plan.md`.
- Do not change prompt contracts, Provider adapters, templates, candidate count,
  fallback, retry, Provider budget, quality-closure algorithms, validators, or
  `/api/process-sheet` policy.
- Do not call a live Provider. All test generation uses injected stubs/local
  fixtures.
- Use the `design-to-implementation-contract` skill before the Character Pack UI
  behavior edit. The approved design is the UI behavior source of truth; record
  any deviation before implementing it.
- Preserve the exclusive Frame Repair worktree and all unrelated untracked
  duplicate files.

## Resource, Test, And Git Safety

- The primary agent is the only test/build owner.
- Run focused tests only through
  `npm run test:focused -- <explicit test files>`.
- Keep focused execution serial under 1024 MiB V8, 1536 MiB process-tree RSS,
  and 60 seconds as enforced by the checked-in supervisor.
- Do not run the full suite during A. The master plan reserves one full-suite
  run for final B verification unless a later explicit decision changes this.
- On timeout, memory growth, pressure, or a limit breach, stop and fix the
  smallest reproducer before any rerun.
- Before committing, run `git status --short`, stage only A files, and preserve
  unrelated user files.

## Fixed Public Semantics

- Gate mode: `generation_release_gate_v1`.
- Strict policy: `strict_live_generation_v1`.
- Release success: `done`, `release_ready: true`,
  `artifact_disposition: "release"`.
- Structural block after successful processing: `failed_quality_gate`,
  `failure_status: "generation_release_gate_failed"`,
  `artifact_disposition: "diagnostic_only"`, no release ZIP/export URL.
- Provider failure remains `failed_model_error`.
- Processing/writer exception remains `failed_post_processing`.
- Existing `selected_index` is the best diagnostic candidate.
- New `release_selected_index` is the release authority.

## File Responsibility Map

| File | Responsibility |
| --- | --- |
| `src/character-pack/generationReleaseGate.js` | Versioned shared thresholds, Production applicability/evidence evaluator, Quality Character hard/soft evaluator, stable reasons |
| `src/character-pack/textToImageGeneration.js` | Evaluate all processed candidates, diagnostic/release selection, report propagation |
| `src/character-pack/benchmark/t2iGoldenReview.js` | Reuse shared thresholds/reason classification without changing report purpose |
| `src/character-pack/processSheet.js` | Serialize combined validation blockers consistently |
| `src/character-pack/artifactManifest.js` | Build release or diagnostic-only Character manifests |
| `src/character-pack/artifactWriter.js` | Gate-aware status/disposition and artifact writing |
| `src/character-pack/textToImageArtifacts.js` | Gate-aware Quality Character diagnostic/release manifests |
| `src/character-pack/jobStore.js` | Expose the repository-standard `FAILED_QUALITY_GATE` constant |
| `server.js` | Project gate/disposition/status evidence into Character jobs |
| `src/ui/characterPack/api.js` | Treat `failed_quality_gate` as terminal |
| `src/ui/characterPack/renderers.js` | Render diagnostic/release selection and prevent blocked exports |

## Task 1: Add The Pure Versioned Gate

**Files:**

- Create: `src/character-pack/generationReleaseGate.js`
- Create: `test/character-pack/generationReleaseGate.test.js`

- [x] Write failing tests for a Production Sheet pass, validation warning,
      validation blocker, applicable source-quality warning/fail, missing
      required source evidence, quality-closure false/missing, and topdown
      source-quality not-applicable.
- [x] Write table-driven Quality Character tests for every threshold at equality
      and just outside the boundary, an empty image/metric set, missing hard
      metrics, and soft warning-only evidence.
- [x] Implement immutable exported policy/threshold constants and pure evaluators
      that return the exact design contract.
- [x] Deduplicate and deterministically order reason codes.
- [x] Run:
      `npm run test:focused -- test/character-pack/generationReleaseGate.test.js`
- [x] Inspect the diff and commit only if this task is a coherent stopping point;
      otherwise continue to Task 2 without staging.

## Task 2: Separate Diagnostic Ranking From Release Selection

**Files:**

- Modify: `src/character-pack/textToImageGeneration.js`
- Modify: `test/character-pack/textToImageGeneration.test.js`
- Modify: `src/character-pack/benchmark/t2iGoldenReview.js`
- Modify: `test/character-pack/t2iGoldenReview.test.js`

- [x] Update existing stubs so Production candidates contain realistic
      validation, source-quality applicability, and quality-closure evidence.
- [x] Add a failing test where a higher score is blocked and a lower score is
      release-ready; assert that `selected_index` and `release_selected_index`
      intentionally differ.
- [x] Add all-blocked tests for both modes. Assert a diagnostic candidate exists,
      release selection is null, the run returns diagnostic evidence rather than
      throwing a fake Provider failure, and no extra Provider call occurs.
- [x] Add mixed Provider-error/quality-block cases. Only an all-unprocessed run
      should use existing Provider terminal taxonomy.
- [x] Integrate the gate into both candidate records and selection reports.
- [x] Make Quality Character score status derive from the gate instead of fixed
      `pass`; make final report status/disposition gate-aware.
- [x] Refactor the offline golden reviewer to use the shared thresholds/reasons
      while preserving its aggregate usable/warning purpose and historical
      report shape where possible.
- [x] Run:
      `npm run test:focused -- test/character-pack/generationReleaseGate.test.js test/character-pack/textToImageGeneration.test.js test/character-pack/t2iGoldenReview.test.js`

## Task 3: Make Artifacts And Metadata Gate-Aware

**Files:**

- Modify: `src/character-pack/processSheet.js`
- Modify: `src/character-pack/artifactManifest.js`
- Modify: `src/character-pack/artifactWriter.js`
- Modify: `src/character-pack/textToImageArtifacts.js`
- Modify: `test/character-pack/processSheet.test.js`
- Modify: `test/character-pack/artifactManifest.test.js`
- Modify: `test/character-pack/artifactWriter.test.js`
- Create: `test/character-pack/textToImageArtifacts.test.js`

- [x] Add a regression test proving source-quality blockers appear in both the
      combined validation report and serialized metadata.
- [x] Add manifest tests for `release` and `diagnostic_only` dispositions.
      Diagnostic manifests retain source/result/gate/debug/prompt/generation and
      existing candidate evidence but omit Character ZIP, Quality Character ZIP,
      engine packs, and corresponding URLs.
- [x] Add writer tests proving pass -> `done`, block ->
      `failed_quality_gate`, stable reason/retry/disposition, and writer
      exceptions -> `failed_post_processing` through the caller.
- [x] Implement disposition-aware manifests/writers without deleting any file
      or rewriting historical artifacts.
- [x] Ensure gate reports are persisted next to the diagnostic evidence and
      selected generation metadata agrees with candidate selection.
- [x] Run:
      `npm run test:focused -- test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js test/character-pack/artifactWriter.test.js test/character-pack/textToImageArtifacts.test.js`

## Task 4: Align Job, Server, CLI, And Browser Semantics

**Files:**

- Modify: `src/character-pack/jobStore.js`
- Modify: `server.js`
- Modify: `src/ui/characterPack/api.js`
- Modify: `src/ui/characterPack/renderers.js`
- Modify: `test/serverOpenRouter.test.js`
- Modify: `test/uiCharacterPackStructure.test.js`
- Modify: `scripts/character-pack-cli.mjs` only if a failing focused test proves
  the evidence loop currently aborts on the new terminal result
- Modify: `test/character-pack/cli.test.js` only when the CLI change is required

- [x] Add `FAILED_QUALITY_GATE` to the shared status constants and the Character
      browser terminal set.
- [x] Add server tests for Production and Quality Character gate failures,
      complete top-level evidence, no release URLs, Provider all-fail remaining
      `failed_model_error`, and processing failure remaining
      `failed_post_processing`.
- [x] Replace any invalid Quality Character success fixture with a valid compact
      single-character fixture; do not weaken the hard gate to preserve a test.
- [x] Project `release_gate`, `release_ready`, `artifact_disposition`,
      `failure_status`, candidate selection, quality spec, and Provider budget
      consistently into the job.
- [x] Update browser diagnostics to show diagnostic versus release selection and
      a truthful non-releasable state. Ensure export buttons remain disabled
      even if a stale/historical URL exists on a blocked job object.
- [x] Prove source/UI structure includes the new terminal state, labels, and no
      unimplemented repair action.
- [x] If CLI evidence collection fails on the new non-exception terminal result,
      add the smallest compatibility change and focused regression test.
- [x] Run:
      `npm run test:focused -- test/serverOpenRouter.test.js test/uiCharacterPackStructure.test.js`
- [x] If modified, separately run:
      `npm run test:focused -- test/character-pack/cli.test.js`

## Task 5: Update Normative Protocols And Verify A

**Files:**

- Modify: `docs/protocols/text-to-image-generation.md`
- Modify: `docs/protocols/character-pack-artifacts.md`
- Modify: `docs/protocols/local-api-boundaries.md`
- Modify: `docs/runbooks/character-pack-cli.md`
- Modify: `docs/roadmap/technology-reference-roadmap.md`
- Modify: `docs/roadmap/p0-p2-technical-upgrade-plan.md`

- [x] Document ranking versus eligibility, both selected indexes, exact gate
      policy, threshold claim boundary, job/failure/disposition taxonomy, and
      diagnostic-only artifact URLs.
- [x] State explicitly that Provider budgets/retries and provider-free upload
      behavior are unchanged.
- [x] Run the complete focused A set once:
      `npm run test:focused -- test/character-pack/generationReleaseGate.test.js test/character-pack/textToImageGeneration.test.js test/character-pack/t2iGoldenReview.test.js test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js test/character-pack/artifactWriter.test.js test/character-pack/textToImageArtifacts.test.js test/serverOpenRouter.test.js test/uiCharacterPackStructure.test.js`
- [x] Run `git status --short`; review every modified path and confirm no
      unrelated/untracked path is staged.
- [x] Commit the verified A unit with a conventional message such as
      `fix: enforce generation release eligibility`.
- [x] Record the commit hash and focused test result before beginning B.

## A Completion Checklist

- [x] Both modes attach `generation_release_gate_v1` to every processed candidate.
- [x] Publication selects only a release-ready candidate.
- [x] All-blocked runs retain diagnostics and expose no release download.
- [x] Provider and processing failure taxonomies remain distinct.
- [x] Runtime and offline review share versioned thresholds/reasons.
- [x] Character browser treats the quality failure as terminal and disables
      exports.
- [x] Focused tests pass through the resource guard with zero Provider calls.
- [x] A is committed independently before any B implementation edit.

## Implementation Record

Implemented on 2026-07-16 without live Provider calls. The delivered boundary
includes the versioned gate, separate diagnostic/release selection, canonical
fail-closed artifact disposition, exclusive job artifact directories, distinct
Provider versus local processing taxonomy, CLI/benchmark evidence alignment,
the `failed_quality_gate` terminal state, and blocked-export UI behavior.

Guarded verification:

- Combined A regression: 146 tests exercised; 145 passed and one newly added
  CLI assertion exposed only an incorrect raw-versus-rounded score expectation.
- After correcting that assertion, the full CLI file passed 61/61.
- After the final gate-evidence and mixed-failure hardening, the gate and
  generation files passed 25/25.
- After independent review hardened canonical UI evidence, benchmark selection
  integrity, API wording, and status styling, the affected A set passed 52/52.
- Peak process-tree RSS in the combined run was 681600 KiB, below the focused
  1536 MiB ceiling; all runs completed inside the 60-second limit.
- The later B closure full suite covered A and passed `1357 / 1357` tests in
  `135.864s`, with `831568 KiB` peak process-tree RSS and no resource breach.

The independent A implementation commit is `371e7c5`. The later documentation
closure can record that hash without changing the independent A code unit.
