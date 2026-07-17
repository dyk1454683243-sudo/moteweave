# Decision: Project Rename Plan

Date: 2026-05-25

Status: Superseded by `2026-07-17-public-brand-selection.md`

## Context

The repository previously used temporary names containing `frameronin` and `Ronin`. Those names should not ship publicly because they may create confusion with an existing sprite-tool product.

## Decision

Use `AI Character Pack Tool` as the neutral temporary name while selecting a distinctive final v1.0 name.

The temporary neutral name is now present in the package name, README title, browser title, and default provider app labels. The final public product name remains undecided and should be selected before v1.0 or any broad public launch.

This temporary-name decision was superseded on 2026-07-17 when the project lead
approved `MoteWeave` / `moteweave` for the source Preview. See
`docs/decisions/2026-07-17-public-brand-selection.md`.

## Rename Scope

When the final name is selected, update:

- README title and product copy
- `package.json` package name
- `package-lock.json`
- `index.html` title, metadata, and visible brand
- default provider app names
- generated metadata identifiers
- documentation references that describe current project branding
- release notes and screenshots

Historical decision notes may mention compatibility targets or prior research when neutral and factual.

## Candidate Direction

The final name should:

- avoid competitor marks and confusingly similar terms
- be searchable
- be available as a GitHub or npm name if publishing is planned
- imply character packs, sprite assets, or game-ready output without overclaiming

Shortlist candidates should be recorded after availability checks.

## Trigger

Choose the final name before any of:

- v1.0 release
- public commercial release
- first public domain registration
- first broad user announcement
