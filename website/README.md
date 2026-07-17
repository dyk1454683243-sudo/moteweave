# MoteWeave Public Site

This directory is an independent static public site. It does not share runtime
routes with the local MoteWeave application and must be deployed with
`website/` as the hosting root.

## Scope

- Static product introduction
- Programmatic browser-only sample demo
- Local workflow and capability-boundary documentation
- No uploads, API calls, authentication, billing, analytics, or cloud processing

The complete MoteWeave application continues to run locally through the
repository root:

```bash
npm ci
npm start
```

## Low-cost deployment

For Cloudflare Pages, use:

- Framework preset: `None`
- Build command: leave empty
- Build output directory: `website`

The `_headers` file supplies the static security policy. Do not change the
hosting root to the repository root: the public deployment must never include
`.env`, workspace data, generated artifacts, tests, or the local API server.

Before adding uploads, hosted processing, authentication, billing, analytics,
or Provider calls, define and approve a separate product and security contract.
