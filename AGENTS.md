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
