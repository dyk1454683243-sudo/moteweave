# Decision: IP And Naming Policy

Date: 2026-05-25

Status: Active

## Context

This project operates near established pixel-art, sprite-sheet, AI character generation, and game-engine import tools. The project intentionally supports interoperability with public file formats, but it must avoid brand confusion, source-code copying, and unlicensed asset redistribution.

The repository previously used temporary names that included `frameronin` and `Ronin` in active project identifiers. Those names create avoidable confusion with another sprite-tool product and should not be used for this project brand, package name, generated metadata, or marketing copy.

This is a practical engineering policy, not legal advice.

## Decision

Adopt the guardrails in `AGENTS.md`.

Specifically:

1. Use a neutral temporary project name until a final v1.0 brand is selected.
2. Do not use competitor names or confusingly similar names as product names, package names, generated metadata identifiers, or marketing claims.
3. Re-implement behavior with original code. Do not copy competitor source code, bundled templates, private API output, or closed-source runtime binaries.
4. Use public file formats for interoperability when useful.
5. Track third-party dependencies, public schemas, and notable compatibility targets in `ATTRIBUTIONS.md`.
6. Require human review for ambiguous naming, attribution, source-code reuse, or asset redistribution cases.

## Allowed

- Reading public documentation for file formats.
- Producing Aseprite-compatible JSON export structures.
- Producing Godot, RPG Maker, OCAD-style, and browser atlas outputs.
- Re-implementing common sprite-sheet, slicing, palette, validation, and export behavior with original code.
- Using permissively licensed open-source dependencies when declared in `package.json` and reflected in `ATTRIBUTIONS.md`.

## Not Allowed

- Product names or package names that include competitor marks or confusingly similar branding.
- Claims such as `replacement`, `clone`, `alternative`, or `better than` against a named competitor.
- Copying competitor web bundle code, prompt templates, private API results, or proprietary template images.
- Bundling third-party executable files, runtime binaries, model weights, icons, or art assets without explicit redistribution rights.
- Training on scraped commercial pixel art or unlicensed asset repositories.

## Rename Policy

`AI Character Pack Tool` was the neutral temporary name. The project lead
approved `MoteWeave` / `moteweave` for the source Preview on 2026-07-17; see
`docs/decisions/2026-07-17-public-brand-selection.md`.

Before v1.0, a public commercial release, or any later rename, verify at minimum:

- package name availability
- domain availability, if a web release is planned
- GitHub or npm name availability, if publishing is planned
- no obvious conflict with direct competitors in the same product category

Potential names and final selection must be recorded in a separate decision.

## Enforcement

- AI agents and contributors must read `AGENTS.md` before changes.
- Pull requests or commits that violate naming and IP rules should be revised before release.
- `ATTRIBUTIONS.md` should be updated when new third-party dependencies, formats, schemas, or assets are introduced.
- The human user has final authority on ambiguous cases.

## Review Triggers

Review this policy when:

- the project is prepared for public release
- the project is commercialized
- a final brand name is chosen
- custom AI training or fine-tuning is added
- new third-party code, assets, or model weights are bundled
- a competitor or rights holder raises a concern
