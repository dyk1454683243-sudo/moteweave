# Public overlay

`moteweave` is the public snapshot of the private Game-tool line. `release:export`
copies the private tree and overwrites this checkout. A few paths exist only
on the public side, or carry public edits on top of an exported file. Those
paths are listed in [`configs/public-overlay.json`](../../configs/public-overlay.json).

Game-tool maintainers may instead mirror the same paths upstream. An export
then already contains them, and this restore step is a no-op.

## Sync

1. In the private Game-tool checkout, run `release:export` into an empty
   directory that is outside both repositories.
2. Copy that export over this `moteweave` checkout.
3. Restore every path in `configs/public-overlay.json` from the previous
   public `main`:

```bash
git fetch origin
git checkout origin/main -- CONTRIBUTING.md .github/ISSUE_TEMPLATE .github/workflows/public-release.yml README.md CHANGELOG.md configs/public-snapshot-manifest.json configs/public-overlay.json configs/public-asset-provenance.json ATTRIBUTIONS.md docs/releases/public-overlay.md scripts/capture-website-assets.mjs test/website/publicSite.test.js website
```

4. Bump the published version the same way the export already does
   (`configs/public-release.json`, `package.json`, `package-lock.json`,
   `README.md`, `CHANGELOG.md`, and `website/index.html`).
5. Regenerate `PUBLIC_SNAPSHOT.json` by running the ledger writer in
   `scripts/public-release.mjs` (`exportPublicSnapshot`) against this tree.
   Keep `source_commit` and `release_version` at the values for that
   publication. Do not edit `scripts/public-release.mjs` to do this.
6. Run `npm run release:check`. It must report zero issues on a clean tree
   with provider credentials unset.

## Do not replace these files blindly

`git checkout origin/main -- <path>` is the default restore. Some paths also
receive product changes from the private export. After the checkout, put the
exported product text back and keep only the public overlay:

- `CHANGELOG.md` — keep the exported release headings. The overlay is the
  `Unreleased` note.
- `README.md` — keep exported product status. The overlay is the public
  contributor introduction and the Quick Start (`npm ci`, Node.js 22 or 24).
- `configs/public-snapshot-manifest.json` — keep exported include and exclude
  rules. The overlay adds `CONTRIBUTING.md` to `include_paths`.
- `configs/public-asset-provenance.json` and `ATTRIBUTIONS.md` — keep exported
  asset records. The overlay adds the `website/assets/` images and names
  `scripts/capture-website-assets.mjs` and
  `scripts/create-character-pack-fixture.mjs`.

`configs/` is already an `include_paths` prefix, so
`configs/public-overlay.json` does not need its own manifest line.
`CONTRIBUTING.md` does, because it sits at the repository root.
