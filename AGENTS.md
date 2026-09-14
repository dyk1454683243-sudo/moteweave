# AGENTS.md

This file defines mandatory rules for AI agents and human contributors working in this repository.

## Read Order Before Any Task

1. `AGENTS.md`
2. `docs/guardrails/ui-implementation-guardrails.md`, REQUIRED before any task that touches `src/ui/` or `index.html`
3. `docs/guardrails/editor-workspace-guardrails.md`, REQUIRED before any task that touches `src/editor-project/`, `src/ui/editor/`, `editor.html`, `src/editor-app.js`, `/api/editor/*`, or Editor Workspace protocols
4. `docs/roadmap/technology-reference-roadmap.md`, only when proposing, prioritizing, or scheduling features inspired by external tools
5. The relevant protocol or design document, when the task names one
6. The implementation plan, when the task names one
7. Only the existing files needed for the current task

Do not scan `output/`, `generated/`, or other artifact directories unless the task explicitly requires it.

## Repository-Native Workflow

- Do not require, invoke, install, or generate local `superpowers` skills or
  `.superpowers/` workflow state for this repository.
- Execute checked-in implementation plans directly under `AGENTS.md` and the
  applicable guardrails. Use standard Git and worktree commands only when the
  user or an approved plan authorizes them.
- `docs/superpowers/` is retained only as the historical location of tracked
  project plans and specifications. Its directory name does not authorize or
  require any external skill.

## Plan-Bound Execution

When the human user approves or names an implementation plan, that plan is the
scope boundary and completion contract.

- Execute only the approved phases and deliverables. Do not add a new contract,
  protocol version, experiment, research track, refactor, or product surface
  unless the plan explicitly requires it or the human user separately approves
  it.
- If an unexpected defect blocks the approved plan, make only the smallest
  necessary repair, verify it, and continue the approved plan. Do not turn the
  defect into a broader redesign.
- Do not perform self-directed competitive research, technology surveys, or
  speculative optimization while implementing a plan. Record non-blocking ideas
  as deferred and continue the approved work.
- Every phase must have an explicit completion gate. Once the gate passes, move
  to the next approved phase or finish the task. Do not stop while an approved
  phase remains, and do not keep extending a passing phase with additional
  hardening.
- Continue through bounded, minimal repair-and-verification work while evidence
  shows a safe in-scope path to completion. If the same blocker persists and no
  meaningful safe progress remains, report it as a genuine blocker instead of
  expanding the workflow indefinitely.

## Approved Workflow Fidelity And Evidence

These rules apply to every task type, including implementation, asset work,
generation, testing, migration, documentation, release, and operations. Once
the human user approves a workflow, method, protocol, or plan, its material
parts become the execution contract.

1. Treat the approved method as binding. Preserve the confirmed inputs,
   authorized scope, step order, tools, providers, models, parameters, external
   resource budget, expected outputs, and acceptance gates.
2. Do not substitute an allegedly equivalent method without approval. A
   similar, improved, simplified, manually recreated, synthetic, or newly
   invented approach is still a different method, even when it aims for the
   same result.
3. Obtain explicit approval before adding, removing, or replacing any contract
   element, including an input, reference, target, output, tool step,
   validation, or acceptance criterion. Describe the proposed change before
   performing it; do not treat silence as approval.
4. Recover routine, in-scope prerequisites such as declared dependencies,
   ordinary configuration, and repository-native runtime setup, then continue
   the approved method. If exact execution requires an unavailable capability,
   credential, authoritative artifact, external-state change, or compatible
   constraint and no safe authorized recovery path exists, stop after the
   smallest useful diagnosis and report the precise blocker. Do not approximate
   the method, expand scope, or consume unapproved external resources while
   trying alternatives.
5. Recover uncertain workflow details from authoritative evidence: maintained
   repository code, checked-in protocols, accepted records, and artifact
   metadata. Clearly separate verified facts from inference, and do not rely on
   memory or a chat summary when primary evidence is available.
6. Call a method productized only when it exists in maintained, tracked
   implementation; is reachable through the intended product workflow; has
   proportionate verification; and is documented well enough for another
   operator to use correctly. Chat instructions, temporary or ignored scripts,
   generated artifacts, and successful one-off outputs do not by themselves
   count as productization.
7. Before claiming work is complete, implemented, productized, verified, or
   accepted, map every user requirement and acceptance criterion to concrete,
   current evidence. State any skipped, partial, or unverified item explicitly.
   Only the human user may satisfy a gate that requires user acceptance.
8. Treat approved external-resource limits as immutable execution constraints.
   Do not add calls or attempts, retry, switch providers or models, use a
   fallback, or extend a budget without explicit approval. Provider-free local
   checks do not consume an approved external-call allowance.
9. Isolate failed, rejected, and unaccepted outputs. Do not reuse them as an
   input, reference, baseline, training material, or provenance source unless
   the human user explicitly promotes that exact output. Keep accepted sources
   and authorized-input provenance traceable throughout the task.

## Default Command Execution And Completion

Every clear user instruction establishes a goal that must be completed. No
special phrase such as "finish the goal," "keep going," or "do not stop" is
required. Determine the goal from the instruction's actual meaning, scope,
constraints, and acceptance criteria.

- Treat the instruction as continuing authorization for all routine, safe,
  in-scope work needed to complete it. This includes inspection, diagnosis,
  repository-native dependency or environment recovery, formal workflow
  execution, minimal repairs, guarded tests, artifact generation, verification,
  documentation, and delivery evidence when those steps are necessary.
- Do not ask the user to repeat approval for routine steps already implied by
  the requested outcome. Make ordinary technical choices autonomously and
  continue after recoverable errors.
- Progress updates, diagnoses, and intermediate failures are not completion.
  Do not hand an unfinished next step back to the user or end with a partial
  result while a safe in-scope path remains.
- The instruction type defines the authorization boundary. A request to build,
  change, generate, or complete authorizes the required in-scope mutations. A
  request only to explain, diagnose, review, or report authorizes read-only work
  and the requested response, not implementation. A request for a draft, prior
  review, or no writes establishes an explicit approval gate and prohibits
  mutation until that gate is cleared.
- Explicit user constraints, step ordering, review gates, stop instructions,
  provider or call budgets, and safety rules remain binding. Continuing
  authorization does not permit changing the goal, substituting an approved
  workflow, adding external calls, using prohibited tools, or performing
  out-of-scope destructive actions.
- Stop before completion only for a genuine blocker: missing required authority,
  credentials, or authoritative input; a mandatory unavailable external system;
  a platform-enforced approval; a material product, scope, security, legal, or
  destructive decision reserved for the user; an unavoidable resource or
  safety limit; or verified absence of the required formal capability. First
  exhaust safe, authorized, in-scope recovery paths, then report the blocker
  once with exact evidence and the condition needed to continue.
- Missing declared dependencies, ordinary configuration errors, test failures,
  diagnosable defects, and recoverable formal-workflow errors are not by
  themselves genuine blockers. Resolve them through the smallest approved
  repository-native path and continue.
- Deliver a final response only when the goal and its acceptance criteria are
  proven complete, a genuine blocker remains after safe recovery paths are
  exhausted, or the user explicitly requests a stop or review checkpoint.

## Execution Truth And Artifact Provenance

Preserve strict truth about whether the requested workflow actually ran and
where every presented artifact came from.

- Inspection is not execution. Reading code, confirming an implementation,
  locating inputs, reviewing historical successes, or preparing a request does
  not count as applying or running the requested technique.
- Do not claim or imply that a technique was applied, a workflow succeeded, or
  an artifact was generated until the formal entry actually ran and current-run
  evidence verifies the claim.
- Classify every displayed artifact as a current-run output, pre-existing input,
  repository template, or historical evidence. Current-run outputs must be
  traceable through their path and run identifier or manifest, with a hash when
  applicable.
- Never place an input, template, historical artifact, failed or rejected
  candidate, example, placeholder, or unrelated file where a reasonable user
  could mistake it for a current-run result.
- If an expected output does not exist, state `not generated`. Do not fill a
  requested result list or gallery with substitutes merely to make the response
  appear complete.
- If execution failed before the requested technique ran, lead with `not
  executed` or `failed before execution`. Do not use success-style wording,
  completion checklists, or media presentation that implies otherwise.
- Before reporting completion, verify that the formal entry ran, the requested
  stage executed, every claimed output exists and belongs to the current run,
  no input or historical artifact is represented as new output, and all call
  counts and execution statuses are accurate.
- Misleading result presentation is a correctness failure regardless of intent.
  Correct any wording, ordering, labels, or media that could make an unexecuted
  or failed workflow appear successful before delivery.
- When the user says stop, terminate active work immediately. Report any state
  change that completed before termination, and do not inspect, undo, delete,
  or continue modifying that state without separate authorization.

## Test And Build Resource Limits

These limits are mandatory for MoteWeave work after the 2026-07-11 runaway Node test incident.

- Do not run raw `node --test`, build, or browser-test commands. Use the checked-in `scripts/run-with-resource-guard.mjs` supervisor through `npm run test:focused -- <test files>`, `npm test`, `npm run smoke:local`, `npm run guard:focused -- <command>`, or `npm run guard:full -- <command>`.
- Focused Node.js tests: one runner, serial execution, V8 old-space at most 1024 MiB, process-tree RSS at most 1536 MiB, and a 60-second timeout unless the existing healthy baseline documents a longer duration.
- Full `npm test`, ordinary builds, and local smoke runs: one runner, serial execution, V8 old-space at most 2048 MiB, process-tree RSS at most 4096 MiB, and a finite timeout based on the healthy baseline.
- Only the primary agent or one explicitly designated test owner may run tests or builds. Review and implementation agents must not start overlapping test, build, server, or browser processes.
- Monitor the entire child-process tree at least once per second. On a limit breach, memory-pressure warning, swap surge, stalled output with memory growth, or failure to exit, terminate the exact process group and report it immediately.
- After any hang or resource breach, do not rerun the combined suite. First remove the faulty lifecycle, fixture, recursion, or assertion and prove that the smallest isolated test exits within its limits.
- Do not leave development servers or browser processes detached in the background. Track their session or PID and stop the exact process at the end of verification.
- If a legitimate MoteWeave workload needs a higher ceiling, stop and ask the human user before increasing it. Never weaken the guard merely to make a failing test complete.

## Session Output And Context Resource Safety

Keep repository inspection bounded at the command source so Git output, tool
buffers, and agent context cannot grow without a predictable limit.

- Never run `git log --all`, `git rev-list --all`,
  `git rev-list --objects --all`, repository-wide `--find-object`, or any
  equivalent unbounded history or object enumeration.
- Do not run potentially high-output Git or file-history queries in parallel.
  Every such command must limit paths, commit count, and output volume at the
  source. Tool-layer truncation is not a safety control.
- If a command unexpectedly runs longer than 15 seconds, its output grows
  abnormally, or Codex session-file or memory usage grows abnormally, terminate
  it immediately. Do not retry it. Record only the smallest useful handoff.
- If output buffering or context growth makes the current task unsafe, stop all
  project work in that task. Create a clean new task, hand off the exact
  uncommitted state, and archive the old task. Do not continue working in the
  swollen task or reload its large output.
- Never scan all Git history to trace an untracked copy. Use only current-file
  hashes, single-file diffs, and explicitly path-limited, commit-limited
  history queries.

## Native Execution And Delivery Checklist

Use this checklist instead of an external workflow skill.

1. Confirm the exact repository, branch, worktree, and `git status --short`
   before editing. Do not switch branches or repurpose another task's worktree
   without authorization.
2. Read the applicable guardrails, protocol or design, and named plan before
   changing files. Keep protected contracts unchanged unless explicitly
   approved.
3. Make the smallest coherent change that satisfies the current completion
   gate. Preserve real data and capability truth; do not substitute mocks for
   working product behavior.
4. Run only the smallest relevant guarded verification with one designated
   test owner. Use the checked-in resource supervisor and never overlap test,
   build, server, or browser processes.
5. Before committing, review `git status --short`, a path-limited diff, and
   `git diff --check`. Stage only files owned by the task.
6. Report changed or deleted files, verification results, skipped checks,
   residual risks, commit identity, and any exact uncommitted state.

Use standard Git worktree commands only when the user or an approved plan
authorizes an isolated worktree. Require an independent, read-only review for
high-risk UI, security, data-integrity, or protected-contract work. Keep
documentation-only and other low-risk changes proportional; do not add a heavy
review workflow without a concrete risk.

## File Deletion Safety

Never bulk-delete files or directories.

Do not use destructive recursive deletion commands, including:

- `rm -rf`
- `del /s`
- `rd /s`
- `rmdir /s`
- `Remove-Item -Recurse`

If deleting is necessary, delete only one explicit file path at a time.

Allowed example:

```powershell
Remove-Item "C:\path\to\file.txt"
```

Do not delete directories. Do not batch-delete files. Do not work around this rule with scripts, globs, loops, find/xargs, or generated deletion lists.

If bulk deletion seems necessary, stop and ask the human user to handle it manually.

## Commit Discipline

Commits should mark coherent, verified units of work. Do not auto-commit every small edit, but do commit at good stopping points when a task or fix is complete and verified, especially before switching topics or opening a new planning thread.

Before committing:

- Run `git status --short`.
- Stage only files that belong to the completed task.
- Do not stage unrelated dirty files or generated artifacts unless the task explicitly requires them.
- Prefer small semantic commits over one large mixed commit.
- Use clear conventional-style messages such as `fix: separate ocad row preview protocol` or `docs: add commit discipline rules`.
- In the final response, report the commit hash and any tests or checks that were run.

If verification cannot be run, say so before committing and mention the residual risk.

## IP And Naming Guardrails

This project builds an original AI character pack and sprite-sheet workflow while interoperating with public game asset formats. Avoid competitor confusion, source-code copying, and unlicensed asset redistribution.

When unsure, stop and ask the human user before making the change.

### Rule 1: Naming

Do not use competitor names, confusingly similar names, or replacement claims in:

- product names
- package names
- module, file, class, or function names
- public documentation titles
- README headlines, badges, screenshots, or marketing copy
- generated metadata identifiers

Avoid these terms as project branding or generated identifiers:

- `Ronin`
- `FrameRonin`
- `PixelLab`
- `Pixelab`
- `PXL`
- `Aseprite Plugin`
- `Aseprite Plus`
- `Spine Compatible`
- `Spine Pro`
- `Scenario Clone`
- `Scenario AI`
- `OCAD Pro`
- `Pro Template`

Descriptive compatibility language is allowed in body text when neutral and factual:

- Allowed: `exports Aseprite-compatible JSON`
- Allowed: `produces Godot, RPG Maker, and OCAD output formats`
- Allowed: `consumes npc.json-compatible metadata`
- Not allowed: `FrameRonin alternative`
- Not allowed: `PixelLab replacement`
- Not allowed: `100% Aseprite Plugin replacement`

### Rule 2: Source Code Copying

Do not copy source code verbatim from outside this repository unless the source has a permissive license and the use is documented in `ATTRIBUTIONS.md`.

Do not copy from:

- competitor web bundles
- closed-source commercial tools
- Aseprite source code
- Spine runtime code or binaries
- Godot plugins or other repositories unless their license allows the specific use

Allowed:

- Read public documentation to understand a file format
- Re-implement the same behavior with original code
- Use public data formats and schemas for interoperability
- Import dependencies with compatible open-source licenses

### Rule 3: Assets And Binaries

Do not bundle third-party executables, icons, template files, model weights, private API responses, or commercial art assets unless redistribution rights are explicit.

Allowed:

- Original templates created for this repository
- CC0 or public-domain assets with attribution where useful
- User-provided assets used only as local input
- NPM dependencies declared in `package.json`

### Rule 4: AI Training Data

If custom LoRA, fine-tuning, embedding, or model-training features are added, training data must be:

- original work
- explicitly licensed for that training use
- purchased with redistribution or model-training rights
- CC0 or public domain

Document training data sources in the model card or metadata. Do not scrape commercial pixel art repositories for training.

### Rule 5: Attribution

When adding a new third-party dependency, public schema, public file format, algorithm implementation, or bundled asset, update `ATTRIBUTIONS.md`.

Only list what is actually used. Do not imply endorsement, partnership, or copied implementation.

## Quick Decision Tree

Before making a change, ask:

1. Am I writing a product, package, file, class, function, or generated metadata name?
   - If it contains a restricted branding term, choose a neutral name.
2. Am I copying code from outside this repository?
   - If the license is not permissive and documented, re-implement from scratch.
3. Am I bundling a third-party asset, binary, template, or model?
   - If redistribution rights are not explicit, do not bundle it.
4. Am I writing user-facing copy that mentions another product?
   - Use neutral compatibility wording. Avoid replacement or comparison claims.

When a case is ambiguous, stop and ask the human user.
