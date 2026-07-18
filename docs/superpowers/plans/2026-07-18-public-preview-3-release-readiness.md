# Public Preview 3 Release Readiness

**Date:** 2026-07-18

**Status:** In progress; private readiness approved, public publication not approved

**Owner:** Project lead

**Release branch:** `codex/public-preview-3-release-readiness`

**Release version:** `0.5.0-preview.3`

**Private comparison baseline:** `7ff88c16fa6c2d6c018260a44748454a3c14af5d`

**Accepted feature head:** `e8a4b938bd8d8e683aec8746aad76bb7cf4443ef`

**Exact private release commit/tree:** TBD after committed, clean verification

## 1. Purpose

Prepare a private, history-safe Preview 3 source candidate containing the
verified provider-free first-user improvements. This work may align private
release metadata, run provider-free verification, and export an audited clean
snapshot. It does not authorize a public-mirror branch, public pull request,
tag, prerelease, merge, or Pages deployment.

Preview 2 remains the accepted public release until every Preview 3 gate passes
and the project lead approves an exact commit and tree.

## 2. Frozen Scope

Preview 3 contains only the reviewed delta from the Preview 2 private
publication record to `e8a4b93`:

- canonical Character UI background, cleanup, stabilization, and fixed output
  size request bindings;
- removal of disconnected 1x-4x export controls in favor of the implemented
  `96/64/48/32/16` package sizes;
- a fail-closed Motion Apply reprocess/re-export action for Character, Godot,
  RPG Maker, and OCAD packages;
- mutually exclusive single/set Apply contexts and exact artifact/report
  bindings;
- a guarded provider-free first-user acceptance command covering import,
  Character processing, Motion Selection v2, Pixel Grid v2, Apply, and all four
  package families.

The Motion action is **reprocess and re-export**, not an exact pixel-preserving
repack. The UI and release notes must preserve that boundary.

Explicitly excluded:

- semantic-evidence Draft PR `#18` and all semantic corpus branches;
- Provider calls, adaptive candidates, or additional Provider budgets;
- exact repack, inherited lineage, embedded Apply evidence, or server-owned
  atomic recovery;
- protected Character pipeline, validator, exporter, Provider, prompt, or
  existing server endpoint contract changes;
- npm publication, installers, bundled dependencies or media tools, hosted
  processing, accounts, billing, analytics, and automatic updates.

## 3. Immutable Preview 2 Mapping

The sole comparison baseline for this release is the completed Preview 2
private publication record, not an older release worktree or public commit.
Keep these identities distinct:

- private publication record: `7ff88c1`;
- private snapshot source recorded by the ledger: `91bb57e`;
- public `v0.5.0-preview.2` tag candidate: `21cd29e`;
- protected public `main`: `5a28665`;
- shared public candidate/main tree: `19ceaf4`.

The Preview 1 and Preview 2 release worktrees are read-only historical
evidence. All Preview 3 work occurs in the dedicated branch and worktree named
above.

## 4. Candidate Lineage Contract

Verified before candidate assembly:

- `e8a4b93` has exactly one parent, `7ff88c1`;
- the comparison range `7ff88c1..e8a4b93` contains one commit and changes 24
  paths with `2026` insertions and `43` deletions;
- no protected `server.js` or `src/character-pack/*` contract file changed;
- no dependency, lockfile dependency graph, template, bundled binary, or
  third-party asset changed;
- semantic Draft PR head `f1ad929` and `e8a4b93` are not ancestors of each
  other and must remain separate;
- private `main` is divergent and must not be merged wholesale into Preview 3.

The final private release commit must retain `e8a4b93` as a required ancestor.
Documentation from `0ad856d` that locks the Preview 2 identities is transplanted
as release-line evidence; no unrelated branch content is merged.

## 5. Execution Board

| Phase | Work | Exit condition | Status |
| --- | --- | --- | --- |
| 0. Contract and history lock | Add this plan and preserve the Preview 2 identity mapping and old-worktree closure | Baseline, feature head, exclusions, and approval stop are explicit | Complete |
| 1. Private candidate assembly | Align `0.5.0-preview.3` metadata, release notes, website source, OG provenance, CI, and tests | Package/config/README/CHANGELOG/site/OG/tests agree and `e8a4b93` is required | Complete; focused candidate set `48/48` |
| 2. Provider-free source verification | Run focused, release, site, full, smoke, and first-user gates serially | Every gate passes within resource ceilings with Provider availability false and calls zero | Complete |
| 3. Clean snapshot | Export committed HEAD to a new empty private directory and verify its ledger before install | Snapshot check, locked install, full suite, smoke, and first-user acceptance pass | Pending |
| 4. Candidate freeze | Record exact private commit/tree, ledger, file counts, public delta, and independent review | One immutable private candidate is ready for an approval decision | Pending |
| 5. Public mirror review | After a new exact-candidate approval, copy only the deterministic snapshot delta to a public branch/PR | Public CI and anonymous checks pass; protected main remains unchanged | Not authorized |
| 6. Publication and website | After separate publication approval, tag, prerelease, merge, and update Pages | Tag/main tree, source archive, production CTA, canonical/OG, and legacy redirect agree | Not authorized |

## 6. Metadata And CI Contract

- Use `0.5.0-preview.3` in package metadata, lockfile, release config, README,
  CHANGELOG, website source, Release URL test, and deterministic OG image.
- Keep `package.json` private and Node support `>=22 <25`.
- Add `e8a4b93` to `configs/public-release.json.required_ancestors`.
- Keep the broad deterministic snapshot manifest unchanged unless a real
  export omission is proven.
- Continue the serial Node 22/24 GitHub Actions matrix with read-only default
  permissions and blank Provider configuration.
- Node 24 must run both `npm run smoke:local` and
  `npm run first-user:local`; neither command may call a Provider.

## 7. Local Verification Order

Only the primary test owner may run tests, builds, servers, or acceptance
workflows, one command at a time under the checked-in resource supervisor:

1. affected focused tests for release metadata, website/OG, Character option
   binding, Motion engine-pack export state, UI structure, acceptance wiring,
   and resource guards;
2. commit the coherent private candidate so release checking can require a
   clean source tree;
3. `npm run release:check`;
4. `npm run site:check`;
5. `npm test`;
6. `npm run smoke:local`;
7. `npm run first-user:local`.

Then export committed HEAD with
`npm run release:export -- <new-empty-directory>`. In the untouched export,
run `npm run release:check` before installing dependencies. After the ledger
passes, run a guarded locked install, full suite, local smoke, and first-user
acceptance. No Provider credential may be configured.

Any timeout, resource breach, unknown Provider state, non-loopback request,
dirty source, ledger mismatch, missing artifact, validation blocker, install
failure, or leaked process stops the release.

## 8. Approval Stop

Private readiness approval does not authorize publication. After Phase 4, stop
and present the project lead with:

- exact private release commit and tree;
- snapshot ledger source commit and file counts;
- exact delta against the accepted Preview 2 public tree;
- source and clean-snapshot verification metrics;
- independent IP/privacy/contract review results;
- confirmation that public Preview 2 and Pages remain unchanged.

Do not push any Preview 3 branch to the public mirror or open a public pull
request until the project lead approves that exact commit and tree. Tagging,
prerelease creation, merge, and Pages CTA deployment require a later explicit
publication approval after public CI and anonymous verification.

## 9. Verified Outcome

Private source verification completed on 2026-07-18:

| Evidence | Result |
| --- | --- |
| Candidate focused set | `48/48` passed in `3555 ms`, peak `191168 KiB`, `5` processes |
| Website and deterministic OG | `8/8` passed after versioned OG cache binding in `241 ms`, peak `576 KiB`, `1` process |
| Clean source release check | Passed for `0.5.0-preview.3` with `644` tracked files, `643` exported files, and zero issues |
| Full source suite | `1555/1555` passed in `132407 ms`, peak `834000 KiB`, `5` processes |
| Source local smoke | Passed in `3700 ms`, peak `709248 KiB`, `3` processes; reported zero Provider calls |
| Source first-user acceptance | Passed in `2882 ms`, peak `644144 KiB`, `3` processes; Provider unavailable, `0` calls, only cells `16–19` changed and remained changed, all four package families parsed |
| Independent static review | No remaining Blocker, High, or Medium finding; the versioned OG URL closed the only Medium cache risk |

The clean exported-snapshot results and exact candidate mapping remain pending
Phase 3 and Phase 4. Public Preview 2 and every public surface remain unchanged.
