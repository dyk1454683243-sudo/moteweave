# GitHub Release Readiness

Use this runbook before exporting a public snapshot, changing repository
visibility, creating a release tag, or adding a public website CTA.

Normative plans:

- `docs/superpowers/plans/2026-07-17-public-preview-release-readiness.md` for
  the initial public snapshot;
- `docs/superpowers/plans/2026-07-17-public-preview-2-release-readiness.md` for
  the current update.

## 1. Human Approval Gates

Stop unless all applicable approvals are recorded:

- final display name and package/repository/Pages slug
  (`MoteWeave` / `moteweave` is recorded in
  `docs/decisions/2026-07-17-public-brand-selection.md`);
- creation of a new GitHub repository, when applicable;
- changing a validated repository from private to public, when applicable;
- creating the final prerelease;
- deploying the final-brand website or changing its Release CTA;
- transitioning the old site, when applicable.

The implementation agent must not select the final brand or make a repository
public on the user's behalf without explicit approval.

## 2. Private Baseline

- Work only from the dedicated release worktree and branch.
- Confirm the intended feature heads are ancestors of the release commit.
- Run `git status --short`.
- Do not stage unrelated untracked files from another worktree.
- Never rewrite or publish the private repository history.
- Never write to the independent Frame Repair implementation worktree.

## 3. Release Exclusions

The public snapshot must not contain:

- `.env`, Provider keys, tokens, private responses, or local credentials;
- `generated/`, `output/`, `workspace/`, `node_modules/`, `.npm-cache/`, or
  `.worktrees/`;
- root-worktree `.superpowers/` or untracked duplicate `* 2.*` files;
- local input media, user projects, benchmark outputs, model weights, FFmpeg,
  rembg, plugins, installers, or dependency bundles;
- real usernames, home-directory paths, downloads, desktop paths, or private
  worktree paths;
- a binary template, fixture, website image, or bundled asset without recorded
  provenance and redistribution status;
- the private `.git` directory or any private-history object.

Do not bulk-delete local files to satisfy this list. The deterministic exporter
must copy only approved tracked files into a new empty destination.

## 4. Metadata And Documentation

Confirm these agree:

- approved display name and slug;
- `package.json` and `package-lock.json`;
- the version declared by `configs/public-release.json`;
- README install instructions and supported Node range;
- CHANGELOG and release notes;
- `LICENSE` and `ATTRIBUTIONS.md`;
- website title, canonical URL, OG metadata, repository URL, and Release CTA.

Keep `package.json` private. Do not add npm publishing or an application bundle
to this release.

## 5. Provider-Free Verification

Only the designated test owner runs commands. Use the checked-in resource
guard, serial execution, and finite limits.

Run in order:

1. affected focused tests;
2. `npm run release:check`;
3. `npm run site:check`;
4. `npm test`;
5. `npm run smoke:local`.

No Provider secret may be configured for these checks. Do not run live
generation.

In a fresh exported snapshot, run `npm run release:check` before installing
dependencies so the ledger verifies the exact export. Then run `npm ci`,
`npm test`, and `npm run smoke:local`. `node_modules/` remains excluded from the
ledger and public commit. Record pass counts, duration, peak process-tree RSS,
and peak process count.

## 6. Snapshot Export

- Use `npm run release:export -- <new-empty-directory>`.
- The destination must not be the private repository, any registered worktree,
  or an existing non-empty directory.
- The exporter must fail rather than delete or overwrite.
- Compare the exported file ledger with the versioned snapshot manifest.
- Run the release checker inside the export.
- Initialize a new Git repository in the export. Do not copy `.git`.

## 7. GitHub Review

- Restore authorized GitHub access.
- For an initial release, create the new repository as private and push only
  the clean snapshot history.
- For an update to the existing public mirror, copy only the deterministic
  exported snapshot delta onto a dedicated public branch and open a pull
  request. Never merge private history into the public repository.
- Enable read-only-default CI with Node 22/24 serial jobs.
- Verify branch protection and CI.
- Clone the candidate public branch into a separate clean directory and repeat
  the install/release/full/smoke checks.
- Inspect GitHub's source archives before public visibility.

Any failure leaves initial repository visibility or the existing public
`main` unchanged.

## 8. Public Visibility And Prerelease

After explicit approval:

1. for an initial release, change repository visibility to public;
2. verify anonymous access to the accepted public candidate commit;
3. create tag `v<release_version>` from that exact candidate commit;
4. create and verify the GitHub prerelease using source archives only;
5. for an update, merge the pull request only after the new Release URL resolves,
   and verify that protected `main` has the same tree as the tagged candidate;
6. verify the repository, issues URL, tag, release notes, and checksums/ledger.

Do not upload an installer, packaged `node_modules`, Sharp/libvips bundle,
FFmpeg, rembg, model, plugin, or generated sample pack.

## 9. Website Cutover

- Keep a new Release CTA out of production until that public prerelease exists.
- Create a new final-brand Git-integrated Cloudflare Pages project only for the
  initial cutover; later updates reuse the existing Git-integrated project.
- Deploy and verify repository/Release links, canonical URL, OG image, responsive
  layout, and capability boundaries.
- Treat a branch-preview deployment as pre-merge evidence only. Close the
  cutover only after production is deployed from protected `main`.
- Because production deploys from `main`, create and verify an approved update's
  tag/prerelease before merging the exact tagged tree; never expose a production
  CTA whose Release URL does not yet resolve.
- Record the final production deployment id and source commit in the normative
  release plan.
- After explicit approval, update the old site to a temporary notice or `302`
  transition.
- Verify that `/` and at least one nested legacy path return HTTP `302` with the
  expected path-preserving `Location`, and that the new site does not redirect
  back.
- Do not delete the old Pages project in this release.

## 10. Claim Boundaries

- The Preview is local source software, not hosted SaaS.
- Provider use is optional, user-configured, and potentially billable.
- FFmpeg and rembg are optional user-installed tools.
- Windows external-tool execution remains fail-closed until separately
  implemented and verified.
- Recorded scene and live-generation evidence remains limited to its documented
  sample size. Do not claim broad production readiness.
