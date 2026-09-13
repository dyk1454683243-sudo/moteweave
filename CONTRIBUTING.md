# Contributing And Maintainer Notes

This public repository is a source-only MoteWeave Preview. The private
engineering repository remains the source of truth for product work. This
mirror exists so the Preview can be cloned, inspected, and run locally.

Public contributions are not promised. Issues and pull requests may be closed
without a product change when they invent features, rewrite private history, or
treat this snapshot as the development tree.

## What This Preview Is

- Local-first source you can run with `npm ci` and `npm start`
- A static public site at https://moteweave.pages.dev/ that does not accept
  uploads or call a Provider
- Current published version: `0.5.0-preview.3`

## What This Preview Is Not

- A hosted character-generation service
- An npm-published package or installer
- A place to develop unpublished experiments
- A replacement claim against other pixel-art or sprite tools

## Run Locally

Prerequisites: Node.js 22 or 24. Node.js 24 LTS is recommended.

```bash
git clone https://github.com/dyk1454683243-sudo/moteweave.git
cd moteweave
npm ci
npm start
```

Open the URL printed by `npm start`. Provider keys are optional. The default
upload, processing, preview, export, tests, and local smoke paths do not need
a Provider key.

## Verification

Do not run raw `node --test`. Use the checked-in resource guard:

```bash
npm run test:focused -- test/path/to/file.test.js
npm run release:check
npm run site:check
```

Run `npm test`, `npm run smoke:local`, and `npm run first-user:local` only after
the affected focused tests are already green.

## Triage For Humans And AI Tools

1. Read `AGENTS.md` before editing code or UI.
2. Read `docs/guardrails/ui-implementation-guardrails.md` before touching
   `src/ui/` or `index.html`.
3. Read `docs/guardrails/editor-workspace-guardrails.md` before Editor
   Workspace work.
4. Prefer fixing broken public docs, install or run steps, or verified local
   bit-rot.
5. Do not invent features, pad activity, or claim ecosystem importance.
6. Do not copy competitor source or use restricted branding names listed in
   `AGENTS.md`.
7. Keep `package.json` `"private": true` and this Preview source-only.
8. After tracked-file changes, keep `PUBLIC_SNAPSHOT.json` consistent with
   `npm run release:check`. This repository is a snapshot mirror.

For publication steps, use `docs/runbooks/github-release-readiness.md`.
