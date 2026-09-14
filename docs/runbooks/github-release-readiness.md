# GitHub Release Readiness

Use this checklist before publishing the repository or preparing a release tag.

## Required Checks

- Run `git status --short` and stage only coherent, reviewed files.
- Keep `.env`, `generated/`, `output/`, `node_modules/`, and `.npm-cache/` untracked. These are covered by `.gitignore`.
- Do not commit local prototype or temporary automation files unless the release explicitly needs them.
- Run `npm test` and record the result in the release note or PR.
- Confirm `README.md`, `CHANGELOG.md`, `package.json`, and `package-lock.json` agree on the current release state.
- Confirm `ATTRIBUTIONS.md` covers any dependency, public format, or bundled asset added since the previous release.

## Local Scratch Files

Local worktrees may contain ignored or untracked scratch data such as `.claude/`,
temporary prototypes, backups, or one-off patch scripts. Treat the current
`git status --short` output as authoritative instead of assuming a historical
scratch-file list is still present.

Do not bulk-delete these files. Before release, either:

- leave them untracked,
- move them manually outside the repository, or
- promote specific files through a reviewed task that explains why they belong
  in source control.

## Scene Quality Claim Boundary

v0.4 includes scene tile ingestion, guarded live generation, quality gates,
LDtk-compatible export, and project pack export. The recorded live scene gate is
a one-case release smoke. Do not describe scene generation as broadly
production-ready until a larger scene benchmark has been run and recorded.

## Character Calibration Claim Boundary

The fixed-region calibration path has one recorded single-call `1K` acceptance
on 2026-07-31. Treat it as a one-run acceptance result, not a sampled
provider-quality or broad production-readiness claim. See
`docs/decisions/2026-07-31-fixed-region-calibration-single-1k-acceptance.md`;
the recovered provider, run-directory identity, artifact paths, automatic gate,
and manual review are recorded there. The live run predates final `d458369`
edge-case hardening; that hardening is covered by the subsequent `131 / 131`
focused test gate, not by a second provider call.

## Public Source Snapshot

The mechanical public export lives in `scripts/public-release.mjs`.

```bash
npm run release:check
npm run release:export -- /absolute/empty/dir/outside/this-repo
```

`release:check` must pass on a clean worktree with Provider credentials
unset. The export copies only manifest-included tracked files from `HEAD`
and writes `PUBLIC_SNAPSHOT.json`. Do not copy `.env`, `generated/`,
`output/`, or `node_modules/` into the public tree.

The current public brand is MoteWeave. Private GitHub hosting may remain
`Game-tool`; the exported package name, website, and canonical URL use
`moteweave`.

After export, open or update the public `moteweave` pull request from the
exported tree. A later export may overwrite snapshot ledger files cleanly.
The current v0.5.0 export record is `docs/releases/public-v0.5.0-snapshot.md`.

## Secret Handling

Provider keys must stay in `.env` or the shell environment. Browser UI provider
selection must receive only non-secret provider ids, labels, models, and
availability flags.
