# Studio UI Parallel Implementation

**Status:** Approved for phased implementation on 2026-08-11
**Branch:** `codex/full-sheet-generation-quality-v1-clean`
**Code baseline:** `18563a368ac163f44400585333c802927ec91fd0`
**Design source:** Figma `Game-tool` (`ro8w6TKkpd969zW2V5bmkx`), including
Settings frame `749:4446` and the accepted Strict Full-Sheet state frames
`701:4864`, `702:3936`, `709:4274`, `704:4036`, `706:4136`, and `711:4369`.

## Outcome

Implement the accepted Studio design as a real, parallel UI over the existing
application. The current `/` UI remains available until the Studio has passed
real upload, strict generation, evidence review, acceptance, export, visual,
and full-suite gates. Promotion changes the default entry; it does not delete
the legacy UI.

The first slice is a standalone page at
`/src/ui/studio/studio.html#settings`, which is already inside the maintained
`/src/` static-file boundary and therefore requires no server route or API
change.

## Lineage And Scope

- The current code baseline does not contain historical design-spec commit
  `d399e6062df971234f5069ffad7534e8cfa0873c`. That document is retained as
  lineage evidence only; the current accepted Figma frames above are the visual
  source of truth.
- This plan does not modify pipeline, Provider, exporter, Profile, generated
  artifact, job-state, or existing server endpoint contracts.
- No mock generation, hard-coded artifact, synthetic status, or replacement
  preview may appear as a real result.
- Topdown remains `Coming later` and blocked before Review or Provider use.
- The existing QA panel has no accepted primary-rail destination. It remains
  reachable in the legacy UI and is recorded as a design gap; it is not
  silently removed or inserted into another module.

## Phase 1 — Parallel Shell And Settings

Build the accepted seven-item rail and Settings dashboard in new
`src/ui/studio/` files. Other rail items deep-link to whitelisted legacy tabs.

| Surface | Real authority | UI policy |
|---|---|---|
| Language | `src/ui/i18n.js` and `localStorage.gameToolLanguage` | Active; Chinese/English; immediate and persisted in the browser |
| Provider state | `GET /api/gemini-state` | Active read; distinguish runtime session, local environment, unconfigured, and configuration error |
| Gemini session config | `POST /api/provider-config` | Studio exposes Gemini only; active only on explicit Save/Clear; key is never echoed and the input clears after Save |
| FFmpeg/rembg | `GET /api/motion-source-tool-status` | Read-only detection on load and explicit recheck; no polling, install, or path editor |
| Theme, shortcuts, default engine, output path, cloud sync, permanent key | No maintained application capability | Text-only `not provided`; never an active control |

**Gate:** Figma visual parity, loading/error/disabled states, real Provider
save/clear behavior, key non-echo, real tool detection, language persistence,
legacy navigation, focused guarded tests, and `git diff --check`. The legacy
root remains unchanged.

## Phase 2 — Character Strict Full-Sheet

Add a Studio Character vertical slice without reusing the legacy direct-call
flow as though it were reviewed:

1. Provider-free Review (`0` Provider calls).
2. Explicit Confirm with sealed Plan and Reference hashes.
3. One live generation call at most, with no retry or fallback.
4. Real queued/generating/post-processing and failure states.
5. `review_required` evidence using the actual Raw, full-resolution matte,
   normalized output, six-base preview, Spill Overlay, Masks, and reports.
6. Explicit manual Accept followed by immutable publication and export.

Raw evidence must not appear before the Provider response has been persisted.
Only the accepted state enables export. No Reject action is shown because no
maintained Reject endpoint exists.

Strict Profile values are locked rather than exposed as editable controls:
`full_sheet_fixed_region_v1`, `fixed_region_motion_v0`,
`deterministic_pixel_matte_v2`, `1:1`, `2K`, candidate/provider-call budget
`1`, no manual overrides, zero anchor offset, empty frame adjustments and
locked animations, and enabled auto-correct/motion stabilization.

**Gate:** provider-free Review tests, pre-call Confirm validation, zero-call
failure tests, real job-state rendering, real evidence URL rendering, Accept
integrity tests, and one human-reviewed live run under the separately approved
Provider-call budget.

## Phase 3 — Remaining Modules

Migrate Character upload, Action, Sequence, Tiles, Scene, and Project in small
sections. Reuse maintained UI mappers and APIs; do not duplicate pipelines.
Each section must preserve its real empty/loading/error/running/review/completed
states and pass focused guarded tests before the next section begins.

The Character parameter-binding completion table must cover:
`name`, `description`, `sourceLayout`/`preset`, `backgroundMode`,
`backgroundTolerance`, `blackSourceBuffer`, `manualOverrides`, `anchorOffset`,
`frameAdjustments`, `lockedAnimations`, `autoCorrect`, `motionStabilize`, and
`styleEnforcement`. Every value must map to a visible control, a locked Profile
value, or a documented maintained default.

## Phase 4 — Promotion

Promotion is allowed only after:

- one real `fixed_region_motion_v0` generation passes end-to-end through the
  Studio;
- one real upload/process flow passes end-to-end;
- Quality Report and Godot/RPG Maker/OCAD exports render real results;
- the parameter-binding and missing-field tables contain no silent disconnect;
- desktop browser visual/console/overflow/focus checks pass;
- focused tests, full guarded `npm test`, guarded `npm run smoke:local`, and
  `git diff --check` pass;
- an independent read-only UI review finds no blocking issue.

After promotion, the former UI remains available at an explicit legacy route.

## Deviation Log

- The accepted Figma rail does not contain QA. QA stays available only in the
  legacy UI until a separate accepted design gives it a truthful destination.
- Phase 1 uses a `/src/` preview URL instead of a new top-level route to avoid
  changing the protected server static-route contract.
- Phase 1 does not expose generation or Accept controls. They are introduced
  only with their real Phase 2 state machine and tests.
- On 2026-08-11 the user selected Gemini as the only Provider configuration
  shown by the new Studio Settings page. OpenRouter and compatible endpoint
  controls remain available only in the legacy UI; their backend support is not
  removed or changed by this phase.
- Phase 2 keeps backend failures inside the accepted six-frame design instead
  of adding a seventh visible state: generation, submission, and observation
  failures use the Running frame (`709:4274`), while evidence and publication
  failures use Review Required (`704:4036`). Exact diagnostics remain visible
  and no retry or fallback is added.
- An already accepted publication can be reopened only through an explicit
  `?publication=accepted_v1_<source-job>` selector. The Studio validates the
  sealed acceptance record and performs only the existing idempotent,
  zero-Provider Accept replay before rendering Accepted (`706:4136`); it never
  re-generates or substitutes the accepted image.

## Phase 3 Scene Slice Record — 2026-08-12

This slice starts from merged `origin/main`
`48f11bb7a0c9b578ca0636792ee91739ebb5bc09` on branch
`codex/scene-studio`. The plan header above remains the historical Phase 1
approval baseline.

The Scene slice uses Figma file `ro8w6TKkpd969zW2V5bmkx`, Section `726:4448`,
with the direct-child board order verified before implementation:

| State | Figma node | Implementation binding |
|---|---|---|
| Default | `650:3694` | No source, Job, preview, or artifact is implied |
| Preview | `603:5380` | Exact 192×192 local source and maintained local preview only |
| Running | `946:4572` | The submitted Job and same-Job observation state |
| Complete / Export | `946:4702` | Quality-verified current Job artifacts only |
| Recovery | `946:4832` | Quality, submission, observation, expiry, and stale-output boundaries |
| Archive reference | `56:135` | Reference only; not an implementation source |

The full Section, board names/order, Rail destinations, prototype lineage, and
the Running, Complete / Export, and Recovery screenshots were checked before
implementation. All six boards are 1920×1080; Archive remains last and was not
used to override Current-state geometry or behavior.

Capability truth for this slice is bound to maintained repository behavior:

- local PNG/WebP ingestion uses `POST /api/process-scene-tiles` and the existing
  style correction, edge conditioning, arrangement, and quality code;
- confirmed live generation uses `POST /api/generate-scene-tiles` with one call
  per requested candidate, no hidden Provider selector, retry, or fallback;
- running work resumes only `GET /api/jobs/:id` for the exact Job;
- release requires a terminal `done` Job, a passing or warning quality report,
  and exact same-origin `/generated/<job-id>/...` artifact bindings;
- failed quality gates expose diagnostic artifacts but never unlock release;
- the legacy Scene deep link `/?tab=prompts` remains explicit and reachable;
  Project is unchanged and outside this slice.

Scene-specific design deviations are intentional capability-truth decisions:

- the shared seven-item Studio rail is retained because its existing Character,
  Motion, Sequence, Tiles, Scene, Project, and Settings destinations are real;
  the simpler Scene-only rail shown in the Figma lineage would remove already
  accepted entry points;
- unsupported Preview-v2 character dock, WASD movement, and repair affordances
  are omitted because Scene has no maintained capability for them;
- Complete contains no sample thumbnails, filenames, sizes, hashes, or links.
  Those rows are created only from the current verified Job response.

## Phase 3 Project Slice Record — 2026-08-12

This slice starts from merged `origin/main`
`1420348b712e0da5d95a09175778abaebd41b796` on branch
`codex/project-studio`. The plan header remains the historical Phase 1
approval baseline.

The Project slice uses Figma file `ro8w6TKkpd969zW2V5bmkx`, Section
`726:4450`, and Current frame `646:3692` (`项目包 / 合成产出 · v3`). The
Section order, Current naming, 1920×1080 screenshot, Rail destinations, and
prototype links were checked before implementation. Old Project Editor and
repair boards (`221:2189`, `56:1916`, and `60:164`) remain Archive/reference
material and are not live states.

Capability truth for this slice is bound to maintained repository behavior:

| Surface | Real authority | Project Studio policy |
|---|---|---|
| Inputs | `POST /api/project-pack` | Visible Project ID, exact Character Job ID, exact Scene Job ID, and strict shared-style checkbox |
| Fixed archive behavior | `src/project-pack/projectPack.js` | Manifest writing and child ZIP inclusion are checked and locked because the pipeline always performs them |
| Running state | `GET /api/jobs/:id` | Observe and resume only the exact submitted Project Job; never create replacement work after a poll interruption |
| Release | Current Job plus `project_manifest.json` and `project_validation.json` | Unlock only after exact Project/child binding, terminal `done`, pass/warning validation, matching style policy, and same-origin exact-Job artifact URLs |
| Failed validation | `failed_project_pack` diagnostic URLs | Manifest and validation may be opened only after verification; `project_pack.zip` remains locked |
| Current-session candidates | Accepted Character and verified Scene Studio state | Offered only when those modules hold a current verified result; otherwise the operator enters exact Job IDs |
| Legacy workspace | `/?tab=project-pack` | Remains explicit and reachable during parallel Studio rollout |

Project-specific design deviations are intentional capability-truth decisions:

- the shared seven-item Studio Rail is retained; the simplified four-item Rail
  in Project v3 would remove already accepted Studio destinations;
- Figma sample history rows, search, and example filenames are not rendered
  because no maintained recent-Job listing API exists;
- the visual Project Editor and repair surfaces are omitted because the real
  maintained capability is Character + Scene package composition;
- “Open output directory” stays visibly disabled because no maintained browser
  API can reveal the server's local output directory;
- Current-frame manifest and package labels are shown as an expected contract,
  while links, identifiers, statuses, and metrics remain empty until verified
  current-Job evidence exists.

## Phase 4 Studio Promotion Record — 2026-08-12

Phase 4 promotes the maintained Studio shell as the default product entry while
preserving the former UI at the explicit `/legacy` route. `/` and `/index.html`
redirect to `/src/ui/studio/studio.html#character`; `/legacy` serves the former
root document. API, generated-artifact, Editor Workspace, and `/src/` routing
remain unchanged.

Character keeps both accepted Figma modes. Local import is the default and is
bound to the Character Section Current boards `655:3697`, `660:3702`,
`683:3795`, `663:3707`, `665:3716`, `667:3725`, and `668:3736`. Strict AI
generation retains the accepted boards `701:4864`, `702:3936`, `709:4274`,
`704:4036`, `706:4136`, and `711:4369`. Archive boards remain reference-only.

### Local Character parameter binding

Local import calls the maintained `POST /api/process-sheet` entry exactly once
per explicit Build action. The source file is limited to a non-empty PNG or
WebP of at most 32 MiB. Every request field is either visibly operator-bound or
fixed and disclosed below; there is no hidden Provider call in this path.

| Request field | Binding sent to `/api/process-sheet` | UI/capability truth |
|---|---|---|
| `source_base64` | Bytes of the currently selected file | Selection epoch invalidates any previous result |
| `source_black_base64` | `null` | No unsupported second-source control is shown |
| `options.name` | Visible resource name, or selected filename stem | 1–64 visible characters |
| `options.sourceFileName` | Exact selected filename | Read-only source metadata |
| `options.sourceLayout` | `topdown_rpg_v0` | Fixed Top-down RPG 8×8 profile shown in the panel |
| `options.description` | Empty string | No disconnected description field is shown |
| Background | `backgroundMode: "auto"`, `backgroundTolerance: 24` | Fixed automatic cleanup disclosed in details |
| Alignment | `anchorOffset: {x: 0, y: 0}`, empty `frameAdjustments` and `lockedAnimations`, `manualOverrides: null` | No unsupported per-frame editor is implied |
| Correction | `autoCorrect: true` | Fixed maintained correction step |
| Cleanup | `componentCleanup: true`, `minAlpha: 18`, `minArea: 4`, `minAreaRatio: 0` | Fixed maintained cleanup step |
| Stabilization | `motionStabilize: true`, `motionMaxShift: 2` | Fixed maintained motion stabilization |
| Pixel finishing | `pixelFinishing: false`, `pixelFinishingMaxColors: 16`, `pixelFinishingOutline: true`, `pixelFinishingOutlineMode: "outer"` | Disabled as a transform; dormant sub-options are sent only as the maintained schema defaults |
| Style report | `styleReport: false`, `styleMaxColors: 16` | No local style-report capability is advertised |
| Scales | `export1x: true`, `export2x: true`, `export3x: false`, `export4x: false` | Exact available scales shown as fixed details |

The terminal Job must remain bound to the submitted Job ID. Release requires a
terminal `done` status, exact same-Job generated URLs, a valid
`debug_report.json` with pass/warning status and zero blockers, and a valid
`animations.json` for `topdown_rpg_v0`. Only transient request, timeout,
observation-limit, unavailable-fetch, or HTTP 5xx errors expose same-Job Resume;
schema, binding, 404, quality, and terminal processing errors stay fail-closed.

The playable preview uses the verified normalized sheet and animations manifest
with real WASD/arrow input. Its frame rate is read per animation from
`animations.json`; local processing has no global FPS request field, so the UI
does not invent one. Character, Godot, RPG Maker, and OCAD downloads are
separate verified current-Job artifacts. Unity and Godot `.tres` rows remain
visibly disabled as future formats.

### Phase 4 design-gap log

- Figma's simulated-failure affordance is omitted because it is not a product
  capability.
- Figma's Cancel action is omitted because `/api/process-sheet` has no cancel
  contract.
- Figma's combined multi-selection package is not synthesized; the maintained
  pipeline exposes four separate packages.
- A post-download filesystem location is not claimed because browsers do not
  expose that location through a maintained application API.
- Local import does not expose Strict AI style-enforcement controls; those stay
  in the real strict generation mode.
- The fixed Studio observation window can end while the same server Job keeps
  processing. Figma has no state for that completed-after-observation case, so
  the smallest necessary Current recovery state accepts one explicit Job and
  Review selector pair. It reads exactly five sealed artifacts with GET only,
  recomputes the canonical JSON reference hash, and reuses the existing evidence
  and human-Accept gates. Transient reads retry the same selectors; structural,
  hash, binding, release-gate, and Provider-budget mismatches remain fail-closed.

The latest guarded real local visual acceptance run produced Job
`job_msp25f8p_e9fq8n` from a 1536×1536 8×8 sheet. Quality passed with zero
warnings and zero blockers; WASD changed the real preview from `idle_down` to
`idle_right`; Character, Godot, RPG Maker, and OCAD packages returned HTTP 200
with 752430, 21642, 5929, and 8063 bytes respectively. This upload path made
zero `POST /api/generate-character` calls. Independent review corrections
invalidate verified publication immediately when a replacement selection
starts, reject stale asynchronous image decodes, preserve same-Job recovery
when response-body reading times out, and complete the bilingual keyboard and
ARIA contract.

The required live strict-generation gate is complete. Provider-free Review
`generation_review_mspepntb_bf3a5643` sealed plan hash
`f050a9fc5d4d13303fd04a6c602252f64a61324d60ebfb68a59220dd8e30c71e`
and canonical reference-manifest hash
`29b12fecaa48e21cc5829d6daa06111d37bc2c0c84f048ee477b8a51dd6234f7`.
Exactly one `POST /api/generate-character` used the approved Gemini native
2K · 1:1 configuration; no retry, fallback, model switch, or second Provider
call occurred. Job `job_mspepnxz_7s1elt` completed after the first UI
observation window with one successful attempt. Its 2048×2048 Raw output SHA
is `204b38ddb93286b064008c7d40ff3e6a717d11fa9c9b9c5a1a3609a2f67a8a5c`;
the normalized sheet SHA is
`1043e1b2d4849d7bcea487e85212bd8c05bc84ff89632696f3dc68fd4ed37bd5`.
The release gate was `needs_review`, with zero blockers and only non-blocking
accessory-edge advisories.

The operator reviewed that exact recovered evidence in visible Studio and
clicked Accept with issue count 0. Publication
`accepted_v1_job_mspepnxz_7s1elt` records protocol
`full_sheet_manual_acceptance_v1`, decision authority `human`, and zero
Provider calls during acceptance. The guarded recovery proxy recorded zero
Review or Generate POSTs; a later idempotent accepted-publication replay also
made zero Provider calls. Character, Godot, RPG Maker, and OCAD packages all
returned HTTP 200 with 10242341, 36240, 12383, and 41851 bytes respectively.

Final verification is complete. The final affected Character regression run
passed 43/43; the full guarded serial suite exited 0 in 107422 ms with peak RSS
820576 KiB; and `npm run smoke:local` exited 0 in 3946 ms with peak RSS 712944
KiB. Guarded real-browser acceptance at 1920×1080 in Chinese and English plus
390 px narrow layout verified language switching, no narrow horizontal
overflow, the accepted evidence, and all four exact-publication downloads with
no console or page errors. Independent read-only review reports no remaining
P0, P1, or P2 issue.
