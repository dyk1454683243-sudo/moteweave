# Studio QA Migration — Phase 5

**Status:** Completed and verified on 2026-08-12
**Branch:** `codex/qa-studio`
**Code baseline:** `3e1ac1da2ef99c0acbf70aa0a183ea1ba88e6c15`
**Design source:** Figma `Game-tool` (`ro8w6TKkpd969zW2V5bmkx`), Section
`955:4572`

## Outcome

Add the remaining standalone QA checklist to the maintained Studio as the
internal `#qa` route. The migration preserves the exact real capability: five
operator-controlled checkboxes whose state exists only for the current page
session. It does not create an automatic validator, Job reader, release gate,
export action, persistence layer, or Provider call.

The explicit `/legacy` route remains available. This phase does not retire,
redirect, delete, or narrow any legacy module and does not enter or extend
Project.

## Figma Contract

The QA Section was created after a read-only audit confirmed that the accepted
seven-item rail had no QA destination. It extends the shared Studio rail with
`检查` after Project and before the flexible spacer / bottom Settings item.

| State | Figma node | Product binding |
|---|---|---|
| Default | `955:4573` | Zero of five native checkboxes selected |
| In Progress | `957:4580` | Any count from one through four; the board samples four of five |
| Complete | `957:4754` | All five checkboxes selected; manual completion only |

All three boards are 1920×1080 Current frames. Their order, names, rail
position, screenshots, and key-state prototype links were verified. The
prototype connects Default to the sampled In Progress board, In Progress to
Complete through the final unchecked item, and Complete back to In Progress
through that same item.

The design explicitly states the capability boundary in every state:

- no Job or Quality Report is read;
- checking or unchecking QA items triggers no API, Provider call, automatic
  decision, or hidden retry; existing Studio boot-time status GETs remain owned
  by their original modules;
- reload clears the checklist;
- completing the checklist does not change release, export, or Project state;
- real generation and quality evidence remains authoritative in its owning
  Studio module.

## Read-Only Legacy Capability Audit

### QA data flow

`index.html` contains the complete legacy QA implementation: five anonymous
native checkbox inputs inside `#qa`. `src/ui/promptTabs.js` only activates the
generic legacy tab. There is no QA-specific controller, fetch, endpoint, Job,
artifact, persistence store, aggregate status, or release mutation. Reloading
the document resets every checkbox.

The Studio implementation may derive a visible count and the three Figma
presentation states from the five current DOM values. That derivation remains
browser-local and in memory; it must not use `localStorage` or an API.

### Other real capabilities that still require `/legacy`

The legacy route cannot be retired after QA because maintained legacy controls
remain outside the accepted Studio flows:

| Legacy surface | Maintained authority | Why it remains legacy-only |
|---|---|---|
| Character advanced local processing | `characterPackTab.js`, `characterPack/controls.js`, `characterPack/templateCalibration.js`, `POST /api/process-sheet` | Fixed-region local import, browser-local template calibration, optional black-matte pairing, manual cut lines / re-slice, global anchors, per-frame nudge, animation locks, and additional cleanup / motion controls are intentionally not exposed by the locked Studio local profile |
| Flexible legacy Character generation | `characterPack/workflows.js`, `characterPack/api.js`, `POST /api/generate-character` | Layout, generation mode, character preset, image size, candidate count, seed, style / palette references, and other direct-call controls are broader than the accepted one-call Strict Studio contract |
| Alternative Provider session configuration | `providerConfig.js`, legacy Character Provider controls, `POST /api/provider-config` | Studio Settings exposes Gemini only by accepted decision; OpenRouter and compatible Base URL controls remain real in legacy |
| Historical benchmark gallery | `characterPack/benchmarkGalleryView.js`, `GET /api/benchmark-gallery` | The hidden-but-bound gallery and refresh flow have no accepted Studio destination |
| Local prompt helpers | `promptTabs.js`, `pixelPipeline.js` | Scene concept and Character preset helpers build deterministic local prompt text; the current Scene Studio is bound to the maintained Scene processing / generation pipeline instead |

Legacy Motion Source, Sprite Sheet, Scene, and Project workspaces also remain
reachable as explicit fallbacks. Their principal maintained flows now have
Studio destinations, but this phase does not claim complete legacy retirement
or remove those routes.

## Implementation Contract

1. Add `#qa` to the Studio route whitelist, titles, render dispatch, and boot
   lifecycle.
2. Add one shared rail item after Project and before the spacer / Settings
   destination. Existing destinations and route semantics remain unchanged.
3. Add a dedicated `qaView.js` that owns only five in-memory booleans and a
   derived presentation mapper:
   - `0` checked → Default;
   - `1–4` checked → In Progress;
   - `5` checked → Complete.
4. Render the Figma checklist, progress, boundary, status, and footer surfaces
   from the current checkbox values. Every checkbox remains independently
   reversible; there is no bulk pass, reset, export, or publish action.
5. Provide complete Chinese and English copy, accessible checkbox labels,
   live status/count announcements, visible keyboard focus, and the existing
   header language controls.
6. Add responsive CSS that preserves the 1920×1080 desktop geometry and turns
   the two-column board into a readable single column on narrow screens.
7. Keep `/legacy?tab=qa` reachable and unchanged. Do not redirect it to Studio
   until a later, separately accepted retirement phase.

## Verification Gates

- Focused guarded tests prove route and rail order, exact five-item capability,
  state derivation, language switching, no storage/API/Job/export behavior, and
  continued `/legacy?tab=qa` reachability.
- `git diff --check` passes and only Phase 5 files are staged.
- A guarded real browser verifies 1920×1080 and narrow layout, Chinese and
  English, keyboard focus, 0/5 → partial → 5/5 → partial transitions, no
  horizontal overflow, and no console or page errors.
- An independent read-only review finds no P0/P1/P2 issue in capability truth,
  accessibility, routing, responsive behavior, or legacy preservation.
- One semantic QA commit is created and published from `codex/qa-studio`.

## Completion Evidence

- Figma Current frames remain the source of truth: Default `955:4573`, sampled
  In Progress `957:4580`, and Complete `957:4754`. Their screenshots and
  prototype transitions were rechecked after the capability copy was scoped to
  the QA interaction itself.
- The maintained Studio now exposes the internal `#qa` route after Project and
  before the spacer / bottom Settings item. The legacy `#qa` panel and explicit
  `/legacy?tab=qa` path remain unchanged and reachable.
- Guarded focused QA / Settings verification passed `7/7`. The broader guarded
  Studio view regression passed `61/61` across Character, Action, Sequence,
  Tiles, Scene, Project, QA, and Settings.
- A real browser verified Default, four-of-five In Progress, Complete, Complete
  back to In Progress, and reload back to Default. It also verified Chinese and
  English visible copy / ARIA, visible keyboard focus, 1920×1080, and 390×844
  top and bottom layouts with zero console errors.
- Browser request inspection found only pre-existing Studio boot-time read-only
  status GETs. QA checkbox interactions issued no request and changed no Job,
  release, export, or Project state.
- Independent final read-only review returned PASS with no P0/P1/P2 after the
  language / ARIA and Rail-order regression gates were added.
