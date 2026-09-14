# Studio Migration Status

**Status:** Phase 5 complete; independent final review passed
**Accepted baseline:** `origin/main` at `380e2240fd2535b09eec67f0ac7258815e581b4e`
**Design source:** Figma `Game-tool` Current frames (`ro8w6TKkpd969zW2V5bmkx`)

## Maintained Browser Surface

Studio is the sole maintained browser application. Its accepted rail order is
Character, Action, Sequence, Tiles, Scene, Project, QA, and Settings. Root and
legacy shell URLs are server redirects; they do not load a parallel DOM shell.

| Legacy tab | Studio destination |
|---|---|
| `character-pack` | `#character` |
| `motion-source` | `#action` |
| `sprite` | `#sequence` |
| `two-point-five-d` | `#tiles` |
| `prompts` | `?open=scene-prompt#scene` |
| `project-pack` | `#project` |
| `qa` | `#qa` |

Missing, empty, unknown, repeated, or illegal `tab` values always use the
fixed `#character` fallback. Query values never participate in destination URL
construction.

## Retained Product Contracts

- Character, Motion, Sprite, Scene, Project, Provider, Job, Editor, and
  benchmark server protocols are unchanged.
- Studio continues to reuse maintained Motion API/binding/options modules,
  Sprite API/core modules, Character calibration core, shared Provider/i18n/DOM
  helpers, and all backend/CLI benchmark modules.
- `src/v8.css` remains because Editor still imports it; it is not an
  old-shell-exclusive file.
- No real Provider call is part of retirement verification.

## Next Roadmap Boundary

Legacy retirement adds no new product capability. Future browser work starts
from the accepted Studio Current frames and must not recreate a parallel root
tab shell.
