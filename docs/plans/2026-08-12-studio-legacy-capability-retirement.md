# Studio Remaining Legacy Capability Migration and Retirement

**Status:** Complete; independent final review passed on 2026-08-12

**Code baseline:** `origin/main` at `19c4029110166f877234cb31c8ccfc2f1853ba28`

**Branch:** `codex/retire-legacy-shell`

**Design source:** Figma `Game-tool` (`ro8w6TKkpd969zW2V5bmkx`)

## Outcome Contract

Move every remaining useful, maintained legacy capability into Studio, remove
browser UI that is inert or has no maintained product destination, and then
make every `/legacy` entry redirect through a fixed server-side whitelist.
The migration reuses maintained domain functions and existing APIs without
copying server pipelines, importing the legacy DOM controllers, or changing
the Process Sheet, Character generation, Provider, Job, or benchmark protocols.

No real Provider call is part of implementation or verification. The protected
generated directories and untracked `node_modules` remain untouched and
unstaged.

## Figma Current Contract

Archive boards remain reference-only. Existing Archive rows were moved to the
right to preserve a single Current row; their contents were not used as an
implementation source. The following 1920×1080 Current frames were added and
visually inspected from rendered Figma screenshots on 2026-08-12:

| Surface | State | Figma node | Capability binding |
|---|---|---|---|
| Character | Advanced local configuration | `971:4596` | Existing `POST /api/process-sheet`; current-input binding invalidates prior results |
| Character | Browser calibration | `971:4831` | Maintained fixed-region calibration pure functions; zero Provider calls |
| Character | Manual cut lines | `971:5066` | Browser-local cut-line state, structure validation, and current-input binding |
| Character | Compatibility configuration | `971:5301` | Existing direct `POST /api/generate-character`; candidate count is the Provider-call ceiling |
| Character | Compatibility running | `971:6230` | Observe and resume the same Job; never resubmit implicitly |
| Character | Diagnostic only | `971:7159` | `review_required` / `diagnostic_only`; no Accept, export, or Project candidate |
| Character | Compatibility release | `971:8101` | Release, quality, URL, and current-input gates all pass; Project eligibility is limited to complete production sheets |
| Character | Prompt helper | `971:9023` | Exact `buildCharacterPrompt({ preset, character, hasReferenceImage })` inputs |
| Scene | Prompt helper | `977:5069` | Exact `buildScenePrompt({ view, theme, composition, style })` inputs |
| Settings | Advanced Provider configuration | `978:5077` | OpenRouter or compatible Base URL in the current local service session |
| Settings | Advanced Provider active | `978:5218` | Key input cleared and never echoed or stored by the browser |
| Settings | Advanced Provider failure | `978:5359` | No Provider call or Job; the previous resolved Provider state is retained |

The Settings default Current frame `749:4446` was aligned first: Gemini remains
the primary card and the advanced Provider area is collapsed. Scene Current
frames were aligned first to advertise the real PNG, WebP, and JPEG local-source
formats. Action and Project Current frames already omitted legacy-workspace
links, so removing those links from HTML is a direct parity correction rather
than a new design.

Prototype evidence:

- Character advanced local entry `981:5125` opens configuration; calibration,
  cut-line, back, confirm, close, and run paths are connected. Run targets the
  existing local-processing Current frame `683:3795`.
- Compatibility run connects configuration to running, and running connects to
  the diagnostic-only and release states; diagnostic return reopens the same
  compatibility configuration.
- Character prompt entry `975:5104`, Scene prompt entry `977:5224`, both close
  actions, and the Scene-to-Character helper link are connected.
- Settings default opens the advanced configuration; save, edit, clear, retry,
  collapse, and close paths connect the three new Current states.

## Controlled Capability Ledger

| Legacy surface or control | Classification | Maintained truth | Approved disposition |
|---|---|---|---|
| `motion-source` tab | Already covered | Studio `#action` owns the maintained source/analyze/preview/build/evidence flow | Direct server redirect, then retire old entry |
| `sprite` tab | Already covered | Studio `#sequence` owns the maintained sprite-sequence flow and API parameters | Direct server redirect, then retire old entry |
| `two-point-five-d` tab | Already covered | Studio `#tiles` is accepted and the old Tiles UI is already retired | Direct server redirect |
| `project-pack` tab | Already covered | Studio `#project` owns the maintained project-pack Job and artifact gates | Direct server redirect, then retire old entry |
| `qa` tab | Already covered | Studio `#qa` exactly preserves the five in-memory operator checks | Direct server redirect, then retire old entry |
| Character Smart / Strict grid selectors | Invalid control | The values do not alter the maintained processing request | Retire UI; do not reproduce in Studio |
| Character preview background color | Invalid control | No maintained listener or pipeline parameter consumes it | Retire UI; do not reproduce in Studio |
| Character Save Project | Invalid control | No maintained save action is bound to the legacy control | Retire UI; Project remains unchanged |
| Scene Day / Night / Rain variants | Invalid control | Decorative spans have no maintained state or request binding | Retire UI; do not reproduce in Studio |
| Character advanced local processing | Migrate | Maintained Process Sheet parameters, browser calibration, matte pairing, cut lines, anchors, nudge, locks, cleanup, and scaled exports | Rebuild inside Studio Local as a secondary mode |
| Character direct compatibility generation | Migrate | Existing direct generation endpoint and Job artifacts | Add an independent, fail-closed compatibility mode |
| OpenRouter and compatible Base URL | Migrate | Existing Provider session API; one active local-service configuration | Add collapsed advanced Settings surface; keep Gemini primary |
| Character and Scene prompt builders | Migrate | Deterministic pure functions, no fetch or persistence | Add secondary local drawers with generate/copy/reset only |
| Scene JPEG local source | Migrate | The maintained Scene pipeline accepts JPEG | Add to Studio file validation while retaining existing limits and gates |
| Hidden benchmark gallery browser UI | Retire UI only | The maintained backend API, CLI, protocol, and tests remain useful | Remove DOM, automatic fetch, and refresh bindings only |
| Legacy shell and tab controller | Retired in Phase 5 | Contains no remaining unique accepted browser capability after the above work | Every legacy entry uses a fixed server redirect; the old HTML, root app, and exclusive DOM controllers are deleted one file at a time |

## API and Release Gates

- Do not change `/api/process-sheet`, `/api/generate-character`,
  `/api/provider-config`, Job schemas, or `/api/benchmark-gallery`.
- Advanced local results unlock only for a terminal `done` Job whose quality,
  exact artifact URLs, and current input/parameter binding all pass.
- Compatibility results unlock only when `release_ready=true`,
  `artifact_disposition=release`, quality passes, and every artifact URL and
  current input binding is exact.
- Compatibility diagnostic results never inherit Strict manual acceptance.
- Project accepts verified, currently bound Advanced Local results and complete
  `production_sheet_v0` Compatibility Character packs. A released
  `quality_character_v0` single-image pack remains export-only because the
  maintained Project loader requires `metadata.json`, `animations.json`,
  `normalized_sheet.png`, and `character_pack.zip`; Project itself gains no new
  behavior. Figma Current `971:8101` was corrected before the corresponding UI
  truth was implemented.
- Any source or parameter change immediately revokes the prior Job result,
  export links, and Project candidate.

## Phases and Completion Gates

1. **Parity redirects:** redirect the five already-covered tabs and remove the
   Action and Project legacy-workspace links. Character and prompts remain
   reachable. Gate: guarded routing tests, desktop/narrow browser checks, and
   independent read-only review.
2. **Advanced local:** implement the secondary Local mode without changing the
   accepted standard-import state machine. Gate: guarded normalization,
   calibration/cut-line, selection-race, Abort/Resume, artifact-binding,
   responsive, localization, accessibility, and Project-candidate checks.
3. **Compatibility and Providers:** implement the independent direct-generation
   state machine and advanced Settings surface. Gate: budget/isolation,
   diagnostics lock, release binding, key handling, and candidate checks. Then
   redirect `character-pack`.
4. **Prompt and gallery:** add both deterministic drawers, Scene JPEG, and the
   one-shot prompts redirect; remove only benchmark browser UI. Gate: prompt
   parity, copy/reset, zero fetch/storage, JPEG, and backend-retention tests.
5. **Legacy shell retirement:** redirect empty, unknown, duplicate, and illegal
   legacy inputs safely; stop serving and explicitly delete the old shell and
   only UI files proven exclusive to it. Gate: full guarded Studio regression,
   `npm test`, `npm run smoke:local`, real-browser visual/accessibility checks,
   `git diff --check`, and independent read-only review.

Each phase is a coherent semantic commit. A phase is not called complete until
its current evidence passes; a later phase may not weaken an earlier gate.

## Completed Phase Evidence

- Parity redirects and Advanced Local were merged before the stated
  `origin/main` baseline.
- Compatibility and Providers are merged as PR #42 at
  `43fdf510506c780a5f482ef631a017da0c42e610`. They passed on 2026-08-12:
  guarded compatibility,
  Settings, template, redirect, and Project tests; guarded local smoke; real
  1920×1080 and 390×844 browser checks in Chinese and English; keyboard focus,
  ARIA, console, overflow, zero live-generation-call, and key-clearing checks;
  and an independent read-only review with no remaining P0/P1/P2 findings.
- Prompt and gallery passed on 2026-08-12: guarded Phase 4 focused regression
  (28/28) and local smoke; real 1920×1080 and 390×844 Character/Scene drawer
  checks in Chinese and English; deterministic generate/copy/reset, Escape,
  focus loop, exact inert restoration, zero horizontal overflow, and console
  checks; a real 192×192 JPEG reached the existing Scene ready gate without a
  processing or Provider POST; browser requests contained no benchmark-gallery
  fetch; and the final independent read-only review reported no remaining
  P0/P1/P2 findings.
- Legacy shell retirement passed on 2026-08-12: the final guarded suite passed
  1218/1218 with 0 failures; guarded local smoke passed the fixed redirect,
  Studio/Editor shell, retained API, and benchmark checks; real Chromium
  verified `/legacy`, the Action and prompt-helper whitelist routes, duplicate
  input fallback, and `/index.html` at 1920×1080 and 390×844. Chinese/English,
  modal focus restoration, keyboard focus visibility, ARIA, zero horizontal
  overflow, and zero console warning/error checks passed. Browser traffic made
  no generation or Provider POST and no benchmark-gallery request. Independent
  deletion-boundary and latest-diff reviews passed with no remaining P0/P1/P2.
