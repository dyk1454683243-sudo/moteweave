# Public Preview 2 Release Readiness

**Date:** 2026-07-17

**Status:** Complete; public preview, protected main, and production website verified

**Owner:** Project lead

**Release branch:** `codex/public-preview-2-release-readiness`

**Release version:** `0.5.0-preview.2`

## 1. Purpose

Publish the completed Generation Release Gate P0 fail-closed hardening as a new
reviewed MoteWeave source snapshot. The existing `v0.5.0-preview.1` tag,
prerelease, source archives, and snapshot ledger remain immutable.

The public repository remains a reviewed mirror rather than a development
branch. This release does not expose private Git history and does not call a
Provider.

## 2. Approved Scope

- Start from private release baseline `5de4be0`.
- Carry the private P0 hardening from `2fd9292`; the equivalent release-branch
  integration commit is `09ed8b6`.
- Preserve the MoteWeave brand, original release-safe templates and fixtures,
  privacy cleanup, deterministic exporter, CI, and website capability boundary.
- Change the configured release version to `0.5.0-preview.2` in package
  metadata, lockfile, README, changelog, website, tests, release config, and the
  deterministic website OG image/provenance record.
- Export a new deterministic snapshot and update the existing public mirror
  through a reviewed branch and pull request.
- Keep `package.json` private and publish GitHub-generated source archives only.

Out of scope:

- semantic release blocking or an evidence evaluator;
- adaptive candidates or additional Provider calls;
- prompt, model, Provider, template, or candidate-count changes;
- npm, installers, bundled dependencies, FFmpeg/rembg, model weights, hosted
  processing, accounts, billing, or automatic updates;
- redesigning the website or changing the legacy-site redirect.

## 3. Release Contract

- Missing or non-finite Quality Character hard metrics remain missing and fail
  closed; they are never coerced to a passing numeric value.
- Production closure evidence must use
  `character_frame_quality_closure_v1` and contain exactly one of each canonical
  gate: `background_halo`, `alignment_consistency`, `motion_consistency`, and
  `prop_side_consistency`.
- Candidate ranking remains separate from release eligibility.
- These structural checks do not claim identity, pose, anatomy, action, or art
  quality.
- Provider calls remain `0` throughout release verification.

The behavior contract and focused verification are recorded in
`docs/superpowers/plans/2026-07-17-generation-release-gate-p0-hardening.md`.

## 4. Execution Board

| Phase | Work | Exit condition | Status |
| --- | --- | --- | --- |
| 0. Contract | Record immutable-tag and preview.2 scope | This plan and the generic update runbook are committed | Complete |
| 1. Integration | Apply the reviewed P0 hardening to the release-safe MoteWeave baseline | Hardening tests and protocol remain intact; release-safe assets are unchanged | Complete: `09ed8b6` |
| 2. Metadata | Align config, package, lockfile, README, changelog, website, and tests | Every active preview version and Release CTA names preview.2 | Complete: `efbb996` |
| 3. Provider-free verification | Run focused, release, site, full-suite, and local smoke checks through the repository supervisor | All checks pass within resource ceilings with zero Provider calls | Complete locally |
| 4. Snapshot review | Export to a new empty directory, verify ledger, install and test a clean checkout, then prepare a public-mirror PR | Export and clean-checkout evidence pass; public main remains unchanged until approval | Complete: public PR `#4` reviewed and passed branch, PR, and tag CI |
| 5. Publication | After explicit approval, tag the verified public candidate, create the prerelease, then merge the exact tagged tree and verify Pages | Tag, prerelease, source archives, protected main tree, production website, canonical metadata, and CTA agree | Complete: `v0.5.0-preview.2` and production Pages verified |

## 5. Verification Order

Only the primary test owner runs tests, builds, servers, or browser workflows.
Use the checked-in resource supervisor and run serially:

1. `npm run test:focused -- test/character-pack/generationReleaseGate.test.js test/character-pack/textToImageGeneration.test.js test/character-pack/qualityClosureGate.test.js test/release/publicRelease.test.js test/website/publicSite.test.js test/website/websiteOg.test.js`
2. `npm run release:check`
3. `npm run site:check`
4. `npm test`
5. `npm run smoke:local`
6. `npm run release:export -- <new-empty-directory>`
7. In the untouched exported snapshot, run `npm run release:check` before
   installing dependencies, while its ledger can still prove the exact export.
8. Then run locked install, full tests, and provider-free local smoke. The
   intentionally excluded `node_modules/` directory must never enter the ledger
   or public commit.

GitHub CI remains the serial Node 22/24 matrix; Node 24 additionally runs local
smoke. No Provider secret is configured.

## 6. Publication Gates

Do not move or recreate `v0.5.0-preview.1`. Do not publish preview.2 unless:

- release metadata, website copy, Release URL, and changelog all agree;
- the deterministic export contains no private history, secret, personal path,
  forbidden artifact directory, unapproved binary, or untracked scratch file;
- focused, release, site, full-suite, smoke, and clean-checkout checks pass;
- the public-mirror pull request contains only the reviewed snapshot delta;
- the project lead explicitly approves tag, prerelease, merge, and production
  website update;
- the prerelease URL resolves before the tagged candidate tree is merged to the
  Pages production branch, preventing a temporary broken production CTA.

Any failed gate leaves the public repository, preview.1 tag, prerelease, and
production website unchanged.

## 7. Completion Record

Local release preparation completed provider-free on 2026-07-17:

- the combined Generation, release, and website focused set passed `45 / 45`
  in `893 ms`, at `53,520 KiB` peak process-tree RSS and `2` peak processes;
- the dedicated site/OG gate passed `8 / 8` in `243 ms`, at `576 KiB` peak RSS;
- source-mode and untouched/committed snapshot-mode release checks passed with
  `632` tracked files, `631` exported files, and zero issues;
- the final exported snapshot installed `25` locked packages with zero reported
  vulnerabilities in `3.047s`, at `223,344 KiB` peak RSS and `6` peak processes;
- the exported snapshot's guarded full suite passed `1,543 / 1,543` in
  `126.769s`, at `820,656 KiB` peak RSS and `5` peak processes;
- its provider-free local smoke passed in `3.439s`, at `749,760 KiB` peak RSS
  and `3` peak processes, and explicitly recorded `0` Provider calls;
- the candidate differs from current public `main@711793d` in `23` reviewed
  paths: P0 code/protocol/tests, release metadata/ledger/docs, and the versioned
  website/OG surface only.

Publication completed after explicit project-lead approval on 2026-07-17:

- public PR [#4](https://github.com/dyk1454683243-sudo/moteweave/pull/4)
  merged the reviewed candidate; its head was `21cd29e`, and protected
  `main@5a28665` has the identical tree `19ceaf4`;
- the unchanged `v0.5.0-preview.1` ref remains at `96078b5`; the new
  `v0.5.0-preview.2` ref points to the reviewed candidate `21cd29e`;
- the source-only GitHub
  [prerelease](https://github.com/dyk1454683243-sudo/moteweave/releases/tag/v0.5.0-preview.2)
  is live with no uploaded assets, and its generated tar/zip source archives
  resolve successfully;
- branch, pull-request, tag, and protected-main Node 22/24 matrices passed. The
  final protected-main run was `29562396703`; Node 24 also passed the
  provider-free local smoke;
- `https://moteweave.pages.dev/` returns HTTP `200`, advertises
  `v0.5.0-preview.2`, links to the live prerelease, and exposes the approved
  canonical/OG metadata and fail-closed security headers;
- `https://gametool.pages.dev/` still returns a path- and query-preserving HTTP
  `302` to the MoteWeave site;
- a credential-free shallow clone of public `main` passed snapshot-mode release
  checking with `632` tracked files, `631` exported files, and zero issues. Its
  guarded locked install added `25` packages in `1.978s` at `131,904 KiB` peak
  RSS, and its guarded local smoke passed in `4.431s` at `715,888 KiB` peak RSS
  and `3` peak processes with `0` Provider calls;
- the downloaded tag archive reports package `moteweave@0.5.0-preview.2`, keeps
  `private: true`, and contains the `631`-file ledger bound to private source
  commit `91bb57e`.

No Provider secret was configured or called, no private history entered the
public mirror, and no npm package, installer, third-party binary, or release
asset was published.

## 8. Release-Line Disposition

The unique current private release-engineering comparison baseline for Preview
3 is `codex/public-preview-2-release-readiness@7ff88c1`. This is the private
publication-record commit, not the public tag commit. The complete immutable
Preview 2 evidence mapping is:

- private publication record: `7ff88c1`;
- private snapshot source recorded by the ledger: `91bb57e`;
- public `v0.5.0-preview.2` tag candidate: `21cd29e`;
- protected public `main`: `5a28665`; and
- shared public candidate/main tree: `19ceaf4`.

`codex/public-preview-release-readiness@5de4be0` and
`<workspace>/.worktrees/public-preview-release-readiness` are closed to new
development, export, release verification, and publication. They remain
read-only historical Preview 1 evidence. Post-release documentation does not
move any accepted tag or redefine the evidence mapping above.
