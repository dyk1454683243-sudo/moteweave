# Public v0.5.0 Snapshot

**Status:** Private source exported; public mirror push needs `moteweave` write access

**Private source commit:** `348dc826791b74049e231cfe314e57481e027af9`

**Release version:** `0.5.0`

**Exported files:** `638` plus `PUBLIC_SNAPSHOT.json`

**Game-tool PR:** https://github.com/dyk1454683243-sudo/Game-tool/pull/50

## Verified private gates

From a clean `cursor/public-preview-export-restore-bbdb` worktree, with Provider
credentials unset:

```bash
npm run release:check
# status=pass; exported_files=638; issues=[]

npm run release:export -- /absolute/empty/dir/outside/this-repo
# source_commit=348dc826791b74049e231cfe314e57481e027af9
# files=638
```

The exported tree also passes `release:check` in snapshot mode.

## Apply the snapshot to moteweave

This environment can create branches on `moteweave` through GitHub, but cannot
`git push` objects there (token is scoped to `Game-tool`). The branch
`cursor/public-v0-5-0-snapshot-bbdb` was created from current public `main`
(`5fed640`) as the push target.

On a machine with write access to `dyk1454683243-sudo/moteweave`:

```bash
git clone https://github.com/dyk1454683243-sudo/moteweave.git
cd moteweave
git checkout -B cursor/public-v0-5-0-snapshot-bbdb origin/main
# Apply the mechanical export tree, then:
git add -A
git commit -m "feat: publish public v0.5.0 snapshot from Game-tool"
git push -u origin cursor/public-v0-5-0-snapshot-bbdb
```

Or rerun the export from the merged Game-tool commit and copy only that tree.
Do not hand-port files. `PUBLIC_SNAPSHOT.json` and the include list are allowed
to overwrite Preview 3 / PR `#6` ledger edits.

After push:

```bash
env -u OPENROUTER_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY -u CHARACTER_IMAGE_API_KEY npm run release:check
```

Open the public PR against `moteweave` `main`. Tag `v0.5.0` and Pages cutover
remain separate publication gates.

## Intentionally not in this snapshot

- Preview 3 first-user acceptance scripts and retired root `index.html` shell
- Gitignored named-IP golden JPEG `ocad_knight_walk.jpg`
- Private `.env`, `generated/`, `output/`, and `node_modules/`
