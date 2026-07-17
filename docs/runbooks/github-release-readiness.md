# GitHub Release Readiness

Use this runbook before exporting a public snapshot, changing repository
visibility, creating a release tag, or adding a public website CTA.

Normative plan:
`docs/superpowers/plans/2026-07-17-public-preview-release-readiness.md`.

## 1. Human Approval Gates

Stop unless all applicable approvals are recorded:

- final display name and package/repository/Pages slug
  (`MoteWeave` / `moteweave` is recorded in
  `docs/decisions/2026-07-17-public-brand-selection.md`);
- creation of the new GitHub repository;
- changing the validated repository from private to public;
- creating the final prerelease;
- deploying the final-brand website and transitioning the old site.

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
- version `0.5.0-preview.1`;
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

Repeat `npm ci`, `npm run release:check`, `npm test`, and
`npm run smoke:local` in a fresh exported snapshot. Record pass counts,
duration, peak process-tree RSS, and peak process count.

## 6. Snapshot Export

- Use `npm run release:export -- <new-empty-directory>`.
- The destination must not be the private repository, any registered worktree,
  or an existing non-empty directory.
- The exporter must fail rather than delete or overwrite.
- Compare the exported file ledger with the versioned snapshot manifest.
- Run the release checker inside the export.
- Initialize a new Git repository in the export. Do not copy `.git`.

## 7. GitHub Private Review

- Restore authorized GitHub access.
- Create the new repository as private.
- Push only the clean snapshot history.
- Enable read-only-default CI with Node 22/24 serial jobs.
- Verify branch protection and CI.
- Clone the private repository into a separate clean directory and repeat the
  install/release/full/smoke checks.
- Inspect GitHub's source archives before public visibility.

Any failure leaves the repository private.

## 8. Public Visibility And Prerelease

After explicit approval:

1. change repository visibility to public;
2. verify anonymous clone and source archive access;
3. create tag `v0.5.0-preview.1`;
4. create a GitHub prerelease using source archives only;
5. verify the repository, issues URL, tag, release notes, and checksums/ledger.

Do not upload an installer, packaged `node_modules`, Sharp/libvips bundle,
FFmpeg, rembg, model, plugin, or generated sample pack.

## 9. Website Cutover

- Keep the existing site without a download CTA until the public prerelease
  exists.
- Create a new final-brand Git-integrated Cloudflare Pages project.
- Deploy and verify repository/Release links, canonical URL, OG image, responsive
  layout, and capability boundaries.
- After explicit approval, update the old site to a temporary notice or `302`
  transition.
- Do not delete the old Pages project in this release.

## 10. Claim Boundaries

- The Preview is local source software, not hosted SaaS.
- Provider use is optional, user-configured, and potentially billable.
- FFmpeg and rembg are optional user-installed tools.
- Windows external-tool execution remains fail-closed until separately
  implemented and verified.
- Recorded scene and live-generation evidence remains limited to its documented
  sample size. Do not claim broad production readiness.
