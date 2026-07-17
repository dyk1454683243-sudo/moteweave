# Public Preview Release Readiness

**Date:** 2026-07-17
**Status:** Complete
**Owner:** Project lead
**Integration branch:** `codex/public-preview-release-readiness`
**Integrated baseline:** `6f4e0b4`

## 1. Decision Summary

Prepare the first public source preview as `v0.5.0-preview.1` in a new,
history-free GitHub repository. The current private repository remains the
engineering source of truth during Preview; the public repository is a reviewed
release mirror produced from an approved private release commit.

The Preview remains source-only:

- keep `"private": true` in `package.json`;
- do not publish to npm;
- do not attach an installer, application bundle, dependency tree, FFmpeg,
  rembg, model weight, Provider response, or other third-party binary;
- do not call a live Provider during release verification;
- keep semantic gates, adaptive Provider spending, hosted processing, accounts,
  billing, and desktop packaging deferred.

The project lead approved `MoteWeave` with the public slug `moteweave` on
2026-07-17. The public repository, source-only prerelease, final-brand website,
and reversible legacy-site transition each passed its separately approved
release gate.

## 2. Fixed Safety Boundaries

- Do not publish or rewrite the private Git history.
- Do not write to the existing exclusive
  `<workspace>/.worktrees/frame-repair-live-quality-gate-implementation`
  worktree.
- Do not include root-worktree `.superpowers/`, untracked `* 2.*` duplicates,
  `.env`, `generated/`, `output/`, `workspace/`, `node_modules/`, or other local
  artifacts.
- Delete only one explicit obsolete file at a time. Never delete directories or
  batch-delete files.
- Preserve existing public protocol ids such as `topdown_rpg_v0` and
  `fixed_region_motion_v0`; a product rename must not break artifact
  compatibility.
- Any fixed-region template, prompt-contract, protected pipeline, validator, or
  UI contract change requires its own recorded behavior boundary and focused
  verification.

## 3. Execution Board

| Phase | Goal | Dependencies | Exit condition | Status |
| --- | --- | --- | --- | --- |
| 0. Plan and release contract | Record the release topology and produce 3-5 checked brand candidates | None | Project lead approves display name, slug, repository name, and Pages project name | Complete: `MoteWeave` / `moteweave` |
| 1. Unique private baseline | Combine website/A-E work with Frame Repair Live Quality Gate | None | Both source heads are ancestors of one clean integration commit | Complete: `6f4e0b4` |
| 2. IP, asset, naming, and privacy closure | Replace unproven assets, neutralize sample naming, remove personal paths, complete provenance | Phase 1 | No active unproven binary, tracked named-IP sample, real local path, or unexplained attribution gap | Complete: `94c01dd` plus deterministic MoteWeave OG |
| 3. Release metadata and automation | Align version/install claims and add release checks, export, and CI | Phases 0-2 | Node 22/24 checks, complete tests, site check, and local smoke pass provider-free | Complete: Node 22/24 CI, site, full-suite, and Node 24 smoke gates pass provider-free |
| 4. Clean public snapshot | Create and validate a new private GitHub snapshot, then request visibility approval | Phase 3 | Anonymous clone/install/archive checks pass after public approval | Complete: public mirror, protected `main`, anonymous verification, tag, and source-only prerelease pass |
| 5. Website cutover | Deploy final-brand website from Git integration and add real source/Release CTA | Phase 4 | Website, repository, version, canonical URL, OG metadata, and legacy-site transition agree | Complete: production cutover from `34f44d4` passed; retained `gametool.pages.dev` provides a verified path-preserving `302` transition |

Public-release checkpoint on 2026-07-17:

- `dyk1454683243-sudo/moteweave` is a public, history-independent snapshot
  mirror with protected `main`;
- serial Node 22/24 CI passed release, site, complete-test, and Node 24
  provider-free smoke gates;
- authenticated and anonymous clean clones passed locked install, release
  checks, full tests, and provider-free local smoke;
- `v0.5.0-preview.1` is a source-only GitHub prerelease whose tag points to the
  verified public snapshot commit;
- PR #1 preview deployment `056576d9` at `146045c` passed before merge;
- production deployment `ce6769f3-2dd6-4134-8789-df5e1ec60593` at
  `https://moteweave.pages.dev/` was built from protected public `main` commit
  `34f44d472b2f56f12d2a2884243a51b47d5f8179`; its main-branch Node 22/24 CI,
  HTTP `200`, repository/Release CTA, canonical and OG metadata, security
  headers, desktop/mobile layout, and capability boundaries passed;
- the retained Direct Upload deployment
  `745c01cc-a256-450f-9497-34fc6263b4c9` at
  `https://gametool.pages.dev/` returns path-preserving HTTP `302` redirects to
  `https://moteweave.pages.dev/` for `/` and
  `/legacy/probe?source=cutover`, while the new site returns HTTP `200` without
  redirecting back;
- Provider calls remained `0`; all release-readiness phases are complete.

Estimated engineering time is 7-12 working days, excluding brand approval,
external legal advice, GitHub/Cloudflare access recovery, and later Provider
experiments.

## 4. Phase Requirements

### 4.1 Unique Private Baseline

Create `<workspace>/.worktrees/public-preview-release-readiness` from
`8263e85` and merge `8a5c6f8`.

Conflict authority:

- `8a5c6f8` owns Frame Repair quality-gate protocols, implementation, UI, and
  tests.
- `8263e85` owns Generation Release Gate, Motion Source safety/selection,
  Pixel Grid v2, Guided Motion Source UI, closure documentation, and website.
- Shared files must retain the union of both feature sets.

Completion evidence:

- merge commit `6f4e0b4`;
- both `8263e85` and `8a5c6f8` are ancestors of the merge;
- 18 merge-focused tests passed in `4.407s`, at `812176 KiB` peak
  process-tree RSS and `5` peak processes.

### 4.2 Original Assets And Neutral Samples

- Add a deterministic repository-owned generator for
  `templates/fixed_region_motion_template_v1.png`.
- Route canonical and legacy fixed-region layout ids to the new template while
  retaining protocol compatibility.
- Replace the tracked AI/template-derived fixed-region golden with a
  deterministic repository-owned fixture.
- Rename the programmatic `sample_hero` example, ids, paths, UI defaults, protocols,
  docs, and tests to `sample_hero` / `Sample Hero`.
- Rebuild `website/og.png` from a deterministic repository-owned SVG/Sharp
  source after the final brand is approved.
- Record file hashes, generation scripts, source rights, and redistribution
  status in `ATTRIBUTIONS.md` or a linked repository-owned asset ledger.

Real Provider quality after the template replacement remains unverified and is
not a release blocker for the provider-free source Preview. Any later live test
requires an explicit call budget and separate approval.

### 4.3 Personal Path And Portable Configuration Gate

- Remove real usernames and workstation paths from runtime defaults, scripts,
  docs, and public evidence.
- Replace Godot executable defaults with explicit configuration/PATH discovery.
- Require the optional user-supplied plugin ZIP through a CLI argument or
  environment setting; do not ship a local download-path default.
- Make the benchmark default use only tracked fixtures. Additional local input
  must be supplied explicitly.
- Use `<workspace>`, `<input-file>`, `${HOME}`, or clearly synthetic redaction
  paths in documentation and tests.
- Add a release checker that rejects macOS, Linux, and Windows user-home paths
  unless they are synthetic test values on a narrow allowlist.

### 4.4 Metadata, Installation, And Public Interfaces

After brand approval:

- use the approved package slug and version `0.5.0-preview.1` in
  `package.json` and `package-lock.json`;
- retain `"private": true`;
- add `repository`, `homepage`, `bugs`, and
  `engines.node: ">=22 <25"`;
- recommend Node 24 LTS while testing Node 22 and Node 24;
- document `git clone`, `npm ci`, `npm start`, the local URL, optional `.env`,
  Provider-cost boundaries, optional FFmpeg/rembg, and the current Windows
  external-tool fail-closed boundary;
- move `npm test` out of end-user Quick Start and into contributor verification;
- close `CHANGELOG.md` as `0.5.0-preview.1`, clearly described as a local
  source preview rather than hosted SaaS.

Add:

- `npm run release:check` for metadata, secrets, personal paths, prohibited
  tracked paths, restricted public names, asset provenance, and snapshot
  manifest checks;
- `npm run release:export -- <empty-directory>` for a deterministic tracked-file
  snapshot. It must reject a missing, existing non-empty, or unsafe target and
  must never clean or delete the target.

### 4.5 CI And Verification

Only the primary test owner runs local tests or builds. All commands use the
checked-in resource guard.

Required order:

1. affected focused tests;
2. `npm run release:check`;
3. `npm run site:check`;
4. `npm test`;
5. `npm run smoke:local`;
6. repeat `npm ci`, release check, full tests, and smoke from a fresh exported
   snapshot.

GitHub Actions:

- read-only default permissions;
- Node 22 and Node 24 matrix with `max-parallel: 1`;
- full tests on both versions;
- local smoke on Node 24;
- no Provider secrets and no live generation.

### 4.6 Public Repository And Website

- Restore authorized GitHub access before repository creation.
- Export from the approved private release commit into a new repository with no
  private history.
- Create the repository as private, push the initial snapshot, enable CI, and
  complete a clean-clone audit.
- Request explicit project-lead approval before changing visibility to public.
- Create only the GitHub-generated source archives for
  `v0.5.0-preview.1`; do not upload application or dependency bundles.
- Keep the current website online without a download CTA until the public
  Release exists.
- Because the current Pages project uses Direct Upload, create a new
  final-brand Git-integrated Pages project after the public repository exists.
- After verification and explicit approval, turn the old site into a temporary
  notice or `302` transition. Do not delete the old project.

## 5. Release Stop Conditions

Stop before public visibility if any of these remain:

- final brand or slug lacks project-lead approval;
- either integration head is missing from the release baseline;
- an active template, fixture, website asset, or binary lacks provenance;
- a real secret, username, private path, Provider response, output directory, or
  untracked scratch file appears in the snapshot;
- README, package metadata, lockfile, CHANGELOG, website, and release tag
  disagree;
- Node 22 or Node 24 full tests fail;
- local smoke leaks a server, browser, or external-tool process;
- GitHub authentication or Cloudflare project authority is unavailable.

Failure keeps the snapshot repository private and leaves the existing website
without a download link.

## 6. Deferred Work

- npm publication;
- Electron/Tauri or other desktop packaging;
- bundled FFmpeg/rembg/model weights;
- automatic updates;
- hosted uploads or processing;
- accounts, analytics, billing, or subscriptions;
- adaptive Provider candidate spending;
- semantic release blocking;
- custom-domain purchase;
- live template-quality experiments without a separately approved budget.
