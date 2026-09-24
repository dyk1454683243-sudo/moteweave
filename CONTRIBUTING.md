# Contributing

MoteWeave is a local-first pixel character and sprite workflow. The public site at [https://moteweave.pages.dev/](https://moteweave.pages.dev/) is a static introduction and a programmatic demo only. Full processing stays in the local app. Do not describe the website as accepting uploads, accounts, or provider calls.

## Read first

This file is a pointer. The rules live in:

- [`AGENTS.md`](AGENTS.md) — required workflow, test limits, and naming rules
- [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) — attribution and third-party boundaries
- the matching contract under [`docs/protocols/`](docs/protocols/)

## Setup

Node.js 22 or 24.

```bash
npm ci
npm test
npm start
```

`npm start` prints a local URL. Open that address in a browser.

## Tests

Use the checked-in resource guard. Do not run raw `node --test`.

```bash
npm run test:focused -- test/path/to/file.test.js
npm run guard:focused -- node path/to/script.mjs
```

Prefer provider-free checks (`npm test`, `npm run smoke:local`, and focused tests). Do not run `npm run smoke:openrouter` unless you intend to spend provider quota. Never paste API keys or `.env` contents into issues or commits.

## Issues

Look for open [`good first issue`](https://github.com/dyk1454683243-sudo/moteweave/issues?q=is%3Aissue+is%3Aopen+label%3A%22good%20first%20issue%22) items. Use the bug, docs, and feature templates when you file something new.
