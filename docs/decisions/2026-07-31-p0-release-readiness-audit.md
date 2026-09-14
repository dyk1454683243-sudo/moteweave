# P0 Release-readiness Audit

## Status

Metadata audit and repository test gate passed on 2026-07-31.

This record closes the bounded P0 release-readiness audit. It does not publish a
release, create a tag, change the package version, or expand any product-quality
claim.

## Baseline And Scope

- Main baseline: `07d04ae`.
- Audit branch: `codex/release-readiness-2026-07-31`.
- Audited release files:
  - `package.json`;
  - `package-lock.json`;
  - `README.md`;
  - `CHANGELOG.md`;
  - `docs/runbooks/github-release-readiness.md`.

`package.json` and the root package entries in `package-lock.json` agree on
package name `ai-character-pack-tool`, version `0.4.0`, and MIT license. No
version bump was selected or authorized. Post-0.4.0 changes remain under
`Unreleased`.

## Corrections

- Updated README release wording to distinguish the current package version
  from unreleased main-line work.
- Documented fixed-region template-safe generation calibration and
  `character_prompt_contract_v1_16`.
- Replaced the obsolete broad “map editor workflows” non-goal with the actual
  remaining scene/editor boundaries.
- Added the single-call `1K` character-calibration claim boundary.
- Corrected the changelog contract version from v1.6 to v1.16 and recorded the
  template-calibration, climb support-prop exclusion, generation calibration,
  and downstream double-staging fixes.
- Replaced the release runbook's stale scratch-file snapshot with a
  status-driven check and added the character-calibration claim boundary.

No dependency, public format, or bundled asset was added. Existing direct
dependencies remain attributed in `ATTRIBUTIONS.md`: `sharp` under Apache-2.0,
and `jszip` plus `gifenc` under MIT.

## Verification

The first guarded test attempt established that this fresh worktree had no
installed dependencies: tests that imported `sharp`, `jszip`, or `gifenc`
failed with `ERR_MODULE_NOT_FOUND`. No timeout, memory breach, or code-specific
failure was observed.

Dependencies declared by the existing lock file were then installed under the
full resource guard. The installation completed in 1.575 seconds with
206,704 KiB peak process-tree RSS and left `package-lock.json` unchanged after
discarding a key-order-only rewrite.

The single permitted full-suite rerun used:

- serial Node.js test execution;
- 2,048 MiB V8 old-space ceiling;
- 4,096 MiB complete process-tree RSS ceiling;
- 900-second wall-clock timeout;
- 500 ms process-tree polling.

Result:

- `1,584 / 1,584` tests passed;
- zero failures, skips, cancellations, or todos;
- 131.854 seconds guard elapsed time;
- 841,840 KiB peak process-tree RSS;
- 7 peak processes;
- no live Provider or model call.

## Remaining Release Boundary

The repository metadata and test gate are ready for review, but no GitHub
release or tag has been authorized or created. Before any future publication,
review the exact staged files and release notes again against the then-current
HEAD and worktree status.
