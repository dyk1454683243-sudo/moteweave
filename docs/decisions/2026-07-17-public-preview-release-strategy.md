# Decision: Public Preview Release Strategy

Date: 2026-07-17

Status: Accepted

## Context

The private repository contains a long implementation history, historical
binary assets whose public redistribution evidence is incomplete, divergent
feature branches, and local-development evidence that should not become public
by accident. The current website is public, but it does not provide a public
source or download route.

The project needs a reproducible Preview path without claiming npm, desktop,
hosted-service, cross-platform media-tool, or live Provider production
readiness.

## Decision

The first public release will be `v0.5.0-preview.1` in a new GitHub repository
created from an approved, history-free source snapshot.

- The current private repository remains the engineering source of truth during
  Preview.
- The public repository is a reviewed release mirror. Product work is not
  developed directly in that mirror.
- `package.json` remains `"private": true`.
- The Release contains GitHub source archives only.
- npm packages, installers, bundled dependencies, FFmpeg, rembg, model weights,
  Provider responses, and generated user artifacts are excluded.
- Release verification is provider-free.
- Repository visibility remains private until IP, privacy, metadata, install,
  CI, and clean-clone gates pass and the project lead explicitly approves the
  visibility change.

## Brand Gate

The project lead approved `MoteWeave` with the public slug `moteweave`. The
display name, repository URL, package slug, Pages project, and homepage are
recorded in `docs/decisions/2026-07-17-public-brand-selection.md`.

Brand approval closes only the naming gate. The public repository, final
Release, and final-brand Pages project remain blocked until the remaining
release checks pass and the project lead separately approves public visibility.

## Website Strategy

The current `gametool.pages.dev` Direct Upload project stays online without a
source/download CTA during preparation.

After the public repository exists:

1. create a new Pages project using the approved brand slug and Git
   integration;
2. deploy and verify the final-brand site;
3. add real repository and prerelease links;
4. after explicit approval, change the old site to a temporary notice or `302`
   transition;
5. do not delete the old Pages project as part of this release.

## Consequences

- The private implementation history is not exposed.
- Each public release needs a deterministic export and audit step.
- Public contributions are not promised during the first Preview.
- The Preview is installable from source but is not a packaged consumer
  application.
- Final publication waits for the independent brand-selection decision.
