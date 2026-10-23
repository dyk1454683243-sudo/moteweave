# Studio Current State

**Authority:** Required current-state snapshot for every Studio task

**Last verified:** 2026-08-30

**Accepted baseline:** `origin/main` at `0cd2608f9d5067ce49cda745cb0a93d74e47d6ce`

**UX candidate:** `codex/studio-ux-human-feedback` at
D-54 residual provenance/test commit
`7b3607bc74787c4b2637e8ad8a4211762c76d30d`, draft PR #49.
Previous closeout product/docs commit remains
`91364cdbf8893550d384986ad825242940c53b18`. Prior Sequence product
ancestor remains `367c10349113426ca36d60f3c0faf52705d677f8`.

**Lineage:** `367c103` is not a direct descendant of the accepted
`origin/main` merge `0cd2608f9d5067ce49cda745cb0a93d74e47d6ce`. Their
merge-base is `a70dc1beae7cf434fb170be738defb5dac20abc7`, and
`a70dc1b^{tree}` equals `0cd2608^{tree}`
(`56f7bdaeab0937427e832694933bbad96efa649b`). There is no missing main
content in the candidate.

**Acceptance:** These product commits keep separate evidence and must
not be collapsed into one gate.

- `c1dc14a` (D-47–D-50 ancestor): final focused Studio closeout 59/59,
  guarded `npm test` 1236/1236, `npm run smoke:local`, and the D-47–D-50
  all-eight-route Chinese/English browser checks.
- `2832a1a` (D-52): user-facing `#action` naming only; guarded focused
  verification 36/36 plus Chinese/English browser checks at 1135×998 and
  390×844. Independent latest-disk review found no P0/P1/P2.
- `367c103` (D-53): Sequence display/localization only; guarded focused
  Sequence tests 22/22 plus resource-guarded system Chrome at 1920×1080,
  1135×998, and 390×844 in Chinese and English, with zero horizontal
  overflow, empty console logs, and zero non-GET requests.
- D-54: Figma Current cleanup and Scene provenance only. The first
  product/docs commit is `cd4b7d5` (2026-08-20 00:05:51 +0800). The
  previous closeout product/docs commit is
  `91364cdbf8893550d384986ad825242940c53b18` (2026-08-20 00:31:46
  +0800). The latest residual provenance/test commit is
  `7b3607bc74787c4b2637e8ad8a4211762c76d30d` (2026-08-20 01:11:07
  +0800); that commit changed CSS, focused tests, docs, and matching
  Figma residuals, and is not docs-only. Later docs-only residual
  commits are not recorded as a new product hash. Guarded focused
  Scene + primary-navigation tests are recorded with this change. No
  browser, full `npm test`, or smoke run is part of D-54.

Final human visual acceptance is still pending.

**D-56 incremental evidence:** Two more human-feedback items on the Tiles candidate, recorded independently of D-55 commit `20af2e0`. (1) Shared module-primary CTA class `.studio-module-cta` (48px min-height, fills the owning footer/content column, `var(--brand)`, 12px/600, 4px radius, unified hover/active/focus-visible/disabled/busy). The earlier universal 248px maximum was rejected by human visual review because 300px, 320px, and 340px sidebars produced unequal left/right gaps. A later Sequence/Tiles module-specific 248px width was a temporary content-column match. The 2026-08-27 human decision supersedes that 248px exception as a Studio runtime correction: Character, Action, Sequence, Tiles, Scene, and Project primary CTAs now stretch to 100% of their owning footer/content column at 390px, 1135px, and 1280px, with left/right edges aligned to that column. Applied only to Character local/review, Action phase primaries, Sequence, Tiles, Scene, and Project main CTAs. QA has no fake submit. Settings save, export/back/cancel/secondary/destructive stay outside the class. Events, enablement, Jobs, APIs, and state machines are unchanged. Tiles AI no longer recolors the module CTA to `#0e639c`. (2) Tiles onboarding copy now leads with purpose: empty title 把地表素材变成可编辑的地图图块 / Turn terrain material into editable map tiles; contract title 地图设置 / Map settings; primary empty 开始编辑地图 / Start editing the map; width/height units 格 / cells; density help; `constraint`/`seeded` option values unchanged and labels 约束求解 / Constraint solver and 种子生成 / Seeded generation. The earlier D-56 Figma Current in-place resize/recolor of module CTAs remains a historical Figma write (no new nodes, no Archive/QA/Settings-save, no person mutation, no prototype/reaction/identity change). This 2026-08-27 full-width runtime correction did not write Figma; Figma Current is not yet synced to the full-width column contract and is a recorded design deviation. Independent review pending. Final human visual acceptance remains pending.

**Character incremental evidence:** The 2026-08-27 human decision makes source acquisition the only processing-flow difference between Local and AI. Local selects a file. Strict AI retains provider-free Review, explicit Confirm, sealed Live generation, evidence review, and human Accept. After Accept, Studio loads only the accepted publication's raw Provider output, verifies its exact bytes against `expectedRawProviderOutputSha256`, and transactionally adopts those bytes as the source of the same editable `#character-local-advanced-form` used by Local. Both source origins then submit the maintained `POST /api/process-sheet` contract with the current visible processing parameters and use the same downstream Job, running state, Quality Report, playable preview, Export dialog, and Project candidate.

The accepted publication is acquisition provenance and source-handoff authority only; it does not directly unlock Export or Project. Those gates unlock only from a verified downstream processing Job bound to the currently adopted source and parameter state. Missing, unsupported, oversized, unavailable, malformed, or hash-mismatched accepted raw input fail-closes the handoff and leaves Export and Project locked. Strict accepted `fresh` and `already_accepted` responses still require the complete `STRICT_ACCEPT_URL_FIELDS` set, including `debug_report_url`, before handoff. Review, Live, and Accept request bodies, sealed Plan and Reference hashes, Provider-call budget, retry/fallback policy, generation pipeline, and acceptance record remain unchanged.

This decision supersedes the former AI-only sealed four-group read-only processing summary, `acceptedPresentationReady` direct-result behavior, Accepted normalized-sheet binding, and direct accepted-publication Export/Project authority. Once an image source exists, Local and AI use one real editable processing form and one result pipeline. AI → Local → AI reuses a current accepted processing source without another hydrate; stale or superseded acceptance work cannot overwrite the current source. The older read-only Strict AI Figma/plan state remains historical evidence; the maintained runtime intentionally deviates from it until Figma Current is synchronized. No Figma mutation is part of this change.

The shared result stage remains responsive: `≤1100px` column flex uses `align-items:stretch` and preview `width:100%; min-width:0`; `≤860px` uses `.character-local-stage.character-stage { grid-template-rows: 36px auto auto }`, while generic mobile `.character-stage` is scoped `:not(.character-local-stage)`. The playable preview stops RAF and releases movement-key interception outside the Character route, resumes preserved runtime on return, and retries a transient downstream image bind whenever the presentation is reusable but runtime is not playable. Provider-free Local topdown browser verification passed on 2026-08-27 at 1280px and 390px in Chinese and English against Job `job_mtb74g9a_vzwhsn`: exactly one non-GET request (`POST /api/process-sheet`) and zero Provider model, Review, Live, Accept, or Project Build calls. The shared stage was playable; Quality was visible with zero findings and passing validation; Export was unlocked with four Job-bound links; and Project exposed the verified Job candidate without building it. Final Local evidence is `/tmp/gametool-character-local-topdown-qa-1787815384127/`, with `report.json` SHA-256 `648b5b0635d3af4e094047cb2d3be0777d3ceae130ddb4680149a39ea2937552`; it supersedes the earlier partial bundle. Provider-free accepted-publication replay browser verification passed on 2026-08-28 for `accepted_v1_job_mspepnxz_7s1elt`: AI and Local resolved to the same `#character-local-advanced-form` with identical 31-control signatures (29 enabled), and real select and checkbox edits survived AI → Local → AI. Checks at 1280px and 390px in Chinese and English found no horizontal overflow, duplicate IDs, fake read-only summary, console errors, or page errors. The replay made zero Provider calls and kept Export locked before an explicit downstream Build; it did not submit `/api/process-sheet`. Downstream Job, Quality, playable preview, Export, and Project behavior remain evidenced by the shared-processor regression tests and the Local end-to-end run above. Guarded focused Character/API regression passed 49/49. After updating the Promotion source guard to the current option-bearing `selectSource(file, ...)` signature and abort condition, the guarded full suite passed 1258/1258 (TAP 149030.765 ms; guard 149098 ms; peak RSS 810848 KiB; exit 0). Final human visual acceptance remains pending.

The 2026-08-28 human-review transparency correction restores a read-only
`Generation input (sealed)` card above the shared downstream processing
parameters during `review_required`. It shows the exact positive description,
labels negative constraints as built-in and non-editable, links the existing
sealed `generation_prompt.txt`, and restores the separate technical binding
disclosure. Fresh Reviews retain their submitted description; pending deep-link
recovery reads it only from a request manifest whose full canonical content is
rehashed against `plan_hash`. No new prompt field, Provider request, call-budget
change, Live/Accept field, or `/api/process-sheet` option is introduced. Guarded
focused Character/API verification passed 50/50, and the guarded full suite
passed 1259/1259 (TAP 130111.597 ms; guard 130153 ms; peak RSS 807296 KiB;
exit 0). Resource-guarded system Chrome visual acceptance for this correction
passed on 2026-08-28 at 1280×900 and 390×844 in Chinese and English against
pending deep-link `job_mspepnxz_7s1elt` /
`generation_review_mspepntb_bf3a5643`. The sealed card was visible above the
shared editable processing form; the positive description was complete; negative
constraints stayed built-in and non-editable; the Prompt link stayed
`rel="noopener"` `target="_blank"` and bound to the current Review
`generation_prompt.txt`; and Provider/model/hash remained in the collapsed
technical disclosure. A bilingual review-phase copy gap was repaired by
refreshing static Local/advanced copy plus the layout-derived profile title
without enabling the processing surface or submitting Accept. Checks found no
horizontal overflow, clipping, overlap, duplicate IDs, console errors, or page
errors. The run made 88 GETs, zero non-GET requests, and zero Provider, Review,
Live, Accept, `/api/process-sheet`, Export, or Project Build calls. Guard
elapsed 7437 ms; peak process-tree RSS 1,815,648 KiB across 12 processes; exit
0. Final evidence is `/tmp/gametool-character-sealed-input-qa-1787897651951/`,
with `report.json` SHA-256
`2642013266a364cd38bb83a434568c183e2d5c33e69426d13ab3e4584afe0797`.
After that copy repair, guarded focused Character/API tests passed 50/50
(TAP 16468.942 ms; guard 16526 ms; peak RSS 142752 KiB; exit 0). The full suite
was not rerun: the visual-only copy refresh does not change API, Job, Provider,
or process-sheet contracts. A subsequent direct human browser review removed
the redundant stage explanation card from successful `review_required` and hid
the technical-evidence disclosure from that user surface. Evidence-failure
states retain their actionable stage message, while the hidden ten-media load
gate, verified hashes, Accept readiness, request body, and Provider/processing
contracts remain unchanged. Guarded focused Character/API tests passed 50/50
after this visibility correction (TAP 16395.295 ms; guard 16448 ms; peak RSS
143488 KiB; exit 0). Current in-app browser reload confirmed the successful
review at the default desktop viewport and 390×844: both removed surfaces had
computed `display:none`, the source preview and sealed-input card remained
visible, Accept remained enabled, the hidden evidence DOM remained mounted,
390px had no horizontal overflow, and the console had no errors. No Accept,
Provider, or `/api/process-sheet` action was initiated. Final human visual
acceptance of the broader UX candidate remains pending.

A later 2026-08-28 direct human browser review supersedes the visible sealed
input card and further simplifies the same `review_required` baseline. The
read-only sealed prompt card, static Cell/FPS/Matte chips, Provider/hash binding,
manual-review technical panel, and already-spent call-budget panel no longer
appear in the user task hierarchy. The animation-lock multi-select is likewise
removed from the shared Local/AI visual form; its DOM, selected state, and
`lockedAnimations` serialization remain intact so this visual cleanup does not
silently rewrite an existing processing contract. Call-budget truth remains
visible before a Provider call in Setup/Confirm, while Running, Review, and
Accepted use their existing status surfaces. The generated-sheet inspector now
uses a single flat stage layer: its wrapper border, radius, background, shadow,
and toolbar card chrome are removed, while raw-image scrolling, checkerboard,
pixel zoom, size output, open-original link, focus behavior, and source binding
remain functional. Internal sealed provenance, the issue-count default, the
ten-media readiness gate, hashes, Accept request fields, evidence-failure stage
message, Provider budget enforcement, and downstream `/api/process-sheet`
contract are unchanged. These browser annotations are the current visual source
of truth for this correction; Figma Current has not been mutated and remains a
recorded synchronization gap. Guarded focused Character/API verification passed
50/50 (TAP 16406.5795 ms; guard 16458 ms; peak RSS 142704 KiB; exit 0). A real
pending-Review reload at 1135×998 and a temporary 390×844 viewport confirmed all
six removed user surfaces at computed `display:none`, the flat inspector at
zero border/radius with transparent background and no shadow, the raw sheet
still scrollable and zoomable, Accept enabled, all ten hidden evidence media
still mounted, no duplicate IDs or horizontal overflow, and an empty browser
error log. No Provider, Accept, or `/api/process-sheet` action was initiated.
Final human visual acceptance remains pending.

A further 2026-08-28 human browser review removes the remaining explanatory
chrome around the shared Character task. The visible `Processing parameters`
heading and both helper paragraphs no longer consume left-panel space; the
heading remains a clipped accessibility/focus target and every real Local/AI
processing control remains present and editable. In a successful
`review_required` state, the generated-sheet checkerboard now fills the
available stage and the size, zoom, and open-original controls float directly
over that background. This full-bleed presentation is scoped to a valid static
sheet: evidence failure, hydration failure, running, accepted, and downstream
playable/Quality states retain their existing layouts and recovery messages.
The Character prompt-helper topbar entry, drawer, and Scene-to-Character helper
handoff are retired because prompt authoring already belongs to the Character
AI source form; the independent Scene prompt helper remains maintained. This is
a user-hierarchy and layout correction only. It does not change source bytes,
Accept readiness, hidden evidence gates, Provider calls, processing parameters,
`/api/process-sheet`, Jobs, Quality, Export, or Project. The direct browser
annotations are the current visual authority; Figma Current has not been
mutated and remains a recorded synchronization gap. Guarded focused
Character/API/Prompt-helper verification passed 55/55 (TAP 16447.1735 ms;
guard 16498 ms; peak RSS 143216 KiB; exit 0). After the 390px floating-toolbar
clearance was increased from 104px to 124px and Review phase focus was moved
from its `display:none` source heading to the clipped workspace heading, the
final guarded Character-only rerun passed 35/35 (TAP 16257.981791 ms; guard
16307 ms; peak RSS 144656 KiB; exit 0). Real pending-Review browser verification
passed at 1135×998 and
390×844: the checkerboard filled the available stage, the toolbar floated
inside it, the source image cleared the toolbar by 8px at 390px, the redundant
left copy and all Character prompt-helper entry points were absent, Accept
remained enabled, ten evidence media stayed mounted, horizontal overflow and
duplicate IDs were zero, and browser logs were empty. The run used only reload,
viewport-resize, and scroll; it did not invoke Provider, Accept,
`/api/process-sheet`, Export, or Project Build. Evidence is
`/tmp/gametool-character-review-ui-qa-1787902488064/`, with `report.json`
SHA-256 `dc82f24b50070795fbdccaccb2429136c5a39b35473fa7ac3437d1c7feacd468`.
Final human visual acceptance remains pending.

A 2026-08-29 direct human browser annotation extends that flat generated-sheet
baseline through the successful Accepted-to-processing handoff. When Strict AI
starts the accepted-source verification, an already visible verified Review
image remains mounted instead of flashing to an empty stage. Once the accepted
publication's exact raw bytes are verified and adopted, the same content stays
visible as a locked `accepted_static` presentation while the editable Local
processing form becomes available. The redundant “source bound / ready to
process” stage card is hidden whenever that valid static presentation exists in
either the acquiring or ready handoff state. The existing full-bleed
checkerboard, floating inspector toolbar, scroll, and pixel zoom remain in the
same center region across both the AI and Local source tabs. A direct accepted
deep link with no previously verified Review image still shows its truthful
acquiring message until verification succeeds; decode errors,
downstream-running, Quality, and playable states retain their recovery/status
layouts. The adopted raw source now has its own bilingual image alternative and
is no longer described as a normalized downstream result. This source preview
remains non-playable and cannot unlock Export or Project; only a verified
downstream `/api/process-sheet` Job can do that. No Provider, Review, Live,
Accept, processing, artifact, or API contract changed. Guarded Character
verification passed 35/35 (TAP 16276.03825 ms; guard 16334 ms; peak RSS 143488
KiB; exit 0). The final Job-versus-publication URL regression rerun also passed
35/35 (TAP 16277.546 ms; guard 16331 ms; peak RSS 144432 KiB; exit 0). A live
accepted-publication replay at 1280×720 confirmed the
status card at computed `display:none`, the shared preview and inspector visible
with the 2048×2048 adopted raw image, the processing form enabled, zero
horizontal overflow, and Export still locked before Build. AI → Local → AI kept
the same blob URL, image dimensions, and full-bleed presentation; browser
warning/error logs were empty. The verification used only a page reload and
source-tab switches and did not initiate Provider, Accept,
`/api/process-sheet`, Export, or Project Build. The direct annotation is the
current scoped runtime authority; Figma Current was not mutated and remains a
recorded synchronization gap. Final human visual acceptance remains pending.

A later 2026-08-29 browser annotation covers the pre-receipt local submission
failure that follows the same accepted handoff. The Local/AI source tabs were
already changing their selected state, but both appeared inert because
`submission_unknown` cleared the verified accepted source from the shared
stage. The accepted raw image now remains mounted as the same non-playable,
non-exportable `accepted_static` presentation while this fail-closed state is
visible. Local and AI tab switches update only mode and `aria-pressed`; they do
not reset the uncertain submission, unlock processing controls, retry
`/api/process-sheet`, rehydrate the publication, or change Provider/Accept
budgets. Export and Project remain locked. The direct browser annotation is the
scoped visual authority; Figma Current was not mutated. Guarded Character
verification passed 36/36 (TAP 16260.9015 ms; guard 16311 ms; peak RSS
144912 KiB; exit 0). A live accepted-publication replay loaded the verified
2048×2048 source, then reproduced the pre-receipt failure with the guarded
local server stopped so the single `/api/process-sheet` attempt could not reach
or create a Job. After the failure, both source tabs retained the same Blob
image and inspector, changed selected state correctly, kept the primary action
disabled, kept Export locked, and introduced no horizontal page overflow. The
guarded server was restarted for continued human review. Final human visual
acceptance remains pending.

The 2026-08-29 source-workspace correction makes the Character topbar tabs
control their actual acquisition entry points instead of only changing the
selected styling. `Local import` shows the file source card and its Replace /
Clear actions. `AI generation` shows the maintained editable description and
the existing provider-free “prepare another image” action, including after a
verified accepted source has entered shared processing. The AI tab does not
reuse or expose the Local file actions. In accepted-ready and fail-closed
`submission_unknown` states, switching tabs and editing an AI draft preserve
the adopted source Blob URL, provenance, processing parameters, shared static
preview, downstream state, and Export / Project gates. Only the explicit AI
action creates a new Review; the existing Confirm gate still authorizes the
single Live Provider call. No duplicate form, prompt-helper entry, processing
option, Provider/Review/Accept payload, or `/api/process-sheet` contract was
added. The direct browser annotations are the scoped runtime design authority;
Figma Current was not mutated and remains a recorded synchronization gap.
Guarded Character verification passed 36/36 (TAP 16263.385708 ms; guard 16316
ms; peak RSS 143936 KiB; exit 0). The regression also proves that a source-tab
switch during an in-flight provider-free Review does not abort that operation
or leave the AI composer permanently busy, and that a failed replacement
Review keeps the prior source URL, provenance, input epoch, processing settings,
and shared preview. A live accepted-publication replay at the
current desktop viewport confirmed mode-specific source visibility, an enabled
AI textarea, an inline new-generation action that remains disabled for an empty
description, the same accepted Blob image across AI → Local → AI, preserved
draft text across that switch, shared processing controls in both modes, and
zero horizontal overflow. The temporary verification draft was cleared. The
browser run did not click Review, Confirm, Live generation, Accept,
`/api/process-sheet`, Export, or Project Build. Final human visual acceptance
remains pending.

**Character AI form incremental evidence:** The 2026-08-30 human browser review
of `角色工作室 > AI 生成` removes the setup center card, the visible call-budget
panel, “俯视布局暂不可用”, and the two permanent helper paragraphs under the
old description textarea. The left AI composer is now a compact character form:
free-form 角色概念 / Character concept bound to `description`; compatible 1:1
`characterPreset` options only; structured `promptFields` for identity, body,
outfit, colors, equipment, and style; optional character and palette reference
images with thumbnail, replace, clear, and MIME/size/read errors; optional
Advanced `seed`. Sampling parameters, candidate count, aspect ratio, output
size, negative prompt, and the incompatible 2:1 preset stay out of the active
UI. Setup keeps the generated-image checkerboard canvas instead of a technical
status card. Gemini/session copy appears only when the local session is
unavailable. CTA copy is 生成角色 / Generate character, then 确认生成 / Confirm
generation. Provider-free Review, sealed Live confirmation, one-call budget,
no auto-retry, Accept, `/api/process-sheet`, Export, and Project contracts are
unchanged. Figma Current on Game-tool `ro8w6TKkpd969zW2V5bmkx` was synchronized
in place on AI frames `683:4017`, `701:4864`, `702:3936`, `709:4274`,
`704:4036`, `706:4136`, and `711:4369`. EN desktop setup is `1449:4733`.
390×844 Current setup is `1450:4953` (zh) and `1450:6394` (en); scrolled-bottom
CTA evidence is `1452:5091` / `1452:5453`. Superseded setup/review evidence was
cloned, not deleted, to Archive section `1239:5085` as `1442:4706` and
`1442:5005`. `#studio-character-view` `data-design-source` now includes
`683:4017`, `1449:4733`, `1450:4953`, `1450:6394`, `1452:5091`, and `1452:5453`.
Present starts after clone inheritance peaked at 68, including Archive
`1442:4706` / `1442:5005`. After cleanup, Current Present is 49 and Archive
page `215:167` Present is 0. Character Setup entries are `655:3697` (existing
main), `683:4017` (zh desktop), `1449:4733` (en desktop), `1450:4953` (zh 390),
and `1450:6394` (en 390). New confirm/running/review/accepted/scrolled clones
are not Present starts. Setup-entry rails navigate to Current Sequence
`603:3340`, Map `603:4360`, and Project `646:3692`; no Current Setup reaction
targets Archive `1442:4706` / `1442:5005`. Recorded deviations: 390 Current is
a clipped 390×844 first viewport plus a separate 390×844 scrolled-bottom
frame, not a 1600-tall outer frame; some inherited Strict-shell chips remain
on non-setup state clones. Guarded focused Character/API/navigation/
prompt-helper/settings/review tests passed 38/38 + 29/29 + 9/9. Guarded full
`npm test` passed 1263/1263 (TAP 131131.001 ms; guard 131181 ms; peak RSS
814384 KiB; exit 0). Resource-guarded system Chrome passed `#character` AI
setup at 1280×900, 1135×998, and 390×844 in Chinese and English: quiet
checkerboard canvas, structured form, one-column 390 reflow, Local ↔ AI draft
preservation, zero horizontal overflow, empty console/page errors, 360 GETs,
and zero non-GET / Provider / Review / Live / Accept / `/api/process-sheet` /
Export / Project Build calls. Guard elapsed 6722 ms; peak RSS 1,893,728 KiB
across 15 processes; exit 0. Evidence:
`/tmp/gametool-character-ai-form-qa-1788090469609/` (empty setup, 390 scrolled CTA,
consoleAPICalled + exceptionThrown, 360 GET, zero non-GET). `report.json` SHA-256
`8647dff59788fade2d0bb1890784b7b291b1967f5d6b03743aae771d02e44024`. Independent
Codex review pending. Final human visual acceptance remains pending.

**Character AI model-selector incremental evidence:** The 2026-08-30 human
decision retires the six Current `promptFields` controls (`identity`, `body`,
`outfit`, `colors`, `equipment`, `style`) because the normal Studio Review body
still cannot deliver them: `server.js::promptFieldsFromBody()` overwrites nested
keys with empty top-level compatibility values. This cycle is UI retirement
only; the server merge defect is deferred and protected Review / Live / Accept /
Provider / `process-sheet` contracts are unchanged. The maintained composer now
keeps Model, Character type, Character concept, both reference images, optional
Advanced seed, and the existing primary action. The Model `<select>` reads the
one eligible native Gemini preset from `studioProviderSnapshot()` through
`selectStrictGeminiPreset()`, sends that `preset.id` as `providerPresetId`, and
never submits a naked `model` field or `promptFields`. Loading/saving/clearing
show a disabled checking placeholder; missing/non-strict Gemini shows a disabled
Settings placeholder plus the existing nearby eligibility message. Implicit
`#character-ai-form` submit / `requestSubmit` fail-closes with zero network when
`characterAiComposerBlockedReason()` is set; ready still prepares Review, and a
missing, stale, or mismatched `providerPresetId` fail-closes locally against the
current snapshot preset before any reset, URL cleanup, or Gemini-state GET. The
API still re-checks the same exact preset after a later Review GET. Figma Current
file `ro8w6TKkpd969zW2V5bmkx` was updated in place on the same setup IDs
`683:4017`, `1449:4733`, `1450:4953`, `1450:6394`, `1452:5091`, and `1452:5453`,
plus matching confirm/running/review/accepted clones. Displaced structured forms
were cloned to Archive section `1239:5085` as `1492:4984`, `1492:5035`,
`1492:5086`, and `1492:5137`. Present starts remain 49 on Current and 0 on
Archive page `215:167`. `data-design-source` is unchanged because the
authoritative setup node IDs did not change. Recorded Figma deviation: the
static Model option uses the representative ready-state label
`Gemini · gemini-2.5-flash-image ▾` so the operable one-option select matches
Character type; runtime always renders the live resolved `preset.model`. Character type / 角色类型 is full form width on every visible
Current AI form, matching Model and the runtime `<select>`. Main setup / confirm
/ running / review / accepted Current frames show Advanced collapsed (label
kept, Seed hidden) to match the default closed `<details>`. Only the existing
390 scrolled CTA evidence frames `1452:5091` and `1452:5453` remain Advanced
expanded (renamed `… · 390 scrolled · Advanced expanded · Current`) so Seed and
the reachable sticky CTA stay visible; no new frames or Present starts.
Independent Codex review pending. Final human visual acceptance remains
pending.

**Character AI reference-mode incremental evidence:** The 2026-08-30 human
decision makes the built-in fixed-region structure reference visible in setup.
A branded `参考方式` / `Reference mode` listbox defaults to `builtin` (`内置动作模板（默认）`
/ `Built-in motion template (Default)`), hides the two custom upload cards, and
omits `referenceImage` / `paletteImage` from the Review payload. Custom mode
(`内置动作模板 + 外观/配色参考` / `Built-in motion template + appearance / palette references`)
reveals the existing cards, treats a character image as identity/appearance
priority and a palette image as color/pixel guidance, requires at least one valid
optional image, and still does not send a `referenceMode` field. Help copy states
that the built-in template still owns motion and layout, references should be a
single subject, and character type should match the image. Model, character type, and reference mode now share one branded select-only
`role="combobox"` implementation. Hidden native `<select>` elements remain the
canonical values (`#character-model`, `#character-preset`,
`#character-reference-mode`). Visible triggers use the existing 14×14 V caret
(`M5 8l5 5 5-5`, stroke `#94a3b8`, 1.8px, round caps/joins) and do not rotate.
Model stays disabled while loading/unavailable/non-editable. Opening one Character
AI combobox closes the others. Open/hover/focus reference-mode states remain on
`1518:4982`. Additive non-Present model/type evidence is `1546:5006`. Desktop
custom-selected full-state evidence (upload cards revealed, Generate Disabled,
not Present starts) is `1532:5139` / `1532:5499`. The server continues to seal
`templates/motion_template_ocad_primary.png` first. Toggling preserves local
drafts without a request; Clear still revokes. Figma Current was updated in
place on `683:4017`, `1449:4733`, `1450:4953`, `1450:6394` (default mode) and
scrolled custom evidence `1452:5091` / `1452:5453`. Pre-change composers were
archived as `1498:4984` and `1498:5039` on `1239:5085`. Present starts remain 49.
`data-design-source` IDs are unchanged. Current reference-mode help copy now
matches the runtime bilingual strings. Custom empty 390 scrolled evidence uses
a Disabled primary CTA that is fully inside the 390×844 viewport. Switching
back to builtin clears the custom-only action error without disabling Accept,
recheck, or accepted hydrate. Non-setup implicit submit validates concept, seed,
custom references, Provider eligibility, and exact `providerPresetId` match
before any `resetToReview()` or URL cleanup. Independent Codex review pending. Final human visual acceptance remains
pending.

**Character Local processing combobox incremental evidence:** The 2026-09-01 human
browser correction unifies the four visible Local/accepted-source processing
singleselects with the Character AI combobox: `#character-advanced-layout`,
`#character-advanced-background-mode`, `#character-advanced-outline-mode`, and
`#character-advanced-frame`. Hidden native selects remain the only canonical
values; one `change` event still feeds `sourceLayout`, `backgroundMode`,
`pixelFinishingOutlineMode`, and `handleFrameSelectorChange()`. `#character-advanced-locks`
stays a hidden multiple-select. Shared controller is `src/ui/studio/characterCombobox.js`.
Frame list is scrollable (`max-height: 232px`) and flips above when space below is
insufficient. Figma Current compact processing panel `971:4596` / `971:4730` now visibly shows all
four runtime comboboxes: layout `1125:5325`, background `1124:5333`, outline
`1567:5064`, and frame `1567:5070`. Compact Local shells `655:3778`, `660:3776`,
`683:3894`, and `971:4707` use the independent V caret instead of `更改 ▾`.
Superseded processing/caret visuals are archived as `1567:5006`, `1567:5048`,
`1567:5052`, `1567:5056`, and `1567:5060` on `1239:5085` with zero Present/reactions.
There are no full Local EN/390 Current product frames; non-Present spec `1559:5006`
is the Current state contract for open/longest-English/frame-scroll/disabled/390.
`data-design-source` IDs are unchanged. Present starts remain 49.

**Character Local waiting-source stage override:** Browser annotation on Local empty
(`data-character-local-phase="empty"`) hides the visible `.character-local-stage-copy`
card and `.character-local-clips-dock` and collapses the third stage row. The CSS gate
requires both `.character-main[data-character-mode="local"]` and
`#character-local-workspace[data-character-local-phase="empty"]` so a stale Local empty
dataset cannot hide the AI shared stage. Toolbar `等待源文件` / `Waiting for source`
stays. Shared IDs including `#character-stage-title` remain. Current `655:3697` Empty
stage `655:3811` is a quiet checkerboard; dock `655:3821` is hidden. Superseded visual
is Archive `1578:5006` on `1239:5085`. Other Current Local frames are unchanged.
Independent Codex review pending. Final human visual acceptance remains pending.

**Character shared combobox no-layout-shift contract:** Opening, highlighting, committing, or closing any of the seven Character comboboxes is a `position: fixed` overlay 4px from the trigger. `.character-local-panel` and `.character-advanced-scroll` keep their baseline overflow; there is no expanded-state `overflow: visible` rule. Active options scroll only the listbox (`max-height: 232px`); internal focus uses `preventScroll`. Figma overlay evidence is extended on non-Present `1546:5006` (`1587:5029` layout open, `1587:5047` background open). Present remains 49. Independent Codex review pending. Final human visual acceptance remains pending.

**Map unification incremental evidence:** The 2026-08-29 human product decision
merges Tiles and Scene into one Map workspace. Visible rail copy is 地图 / Map
and the page title is 地图工作室 / Map Studio. Internal route `#tiles` remains
the maintained editor. Hash `#scene` canonicalizes to `#tiles` so the old URL
opens the same map workspace instead of a blank or duplicate pipeline page.
The Scene DOM, APIs, Jobs, prompt helper, and Figma Current Scene frames stay
as hidden inventory; they are not deleted in this change. Provider material
evaluation and Scene live generation are not presented as Map AI source
switches because they are not a complete Review → Confirm → Provider → Accept
material-replacement flow for the map canvas. Local import plus an explicit
「使用默认素材」 control are the real terrain sources; procedural material is
the default when no image is chosen. Solver and border stay real options inside
an Advanced details block. Seed help states that the value reproduces the same
automatic layout. Empty copy only names the next step. Output cards appear only
after a verified complete Job; filenames remain secondary. No new Provider call,
retry, or budget is added. Figma Current was synchronized on 2026-08-30 to the
unified Map workspace. File `Game-tool` (`ro8w6TKkpd969zW2V5bmkx`), Current page
`UI Design` `0:1`, Archive page `215:167`. Section `726:4447` is now
`04 · 地图`. Scene section `726:4448` is Archive / NOT CURRENT. Current Map
frames: empty ZH `603:4360`, ready `909:6025`, building `909:7644`, complete
`910:4970`, failed `911:4977`, stale `911:6385`, UX v4 `997:5491`, empty EN
`1432:4767`, empty ZH 390 `1432:5797`, empty EN 390 `1432:6978`. Pre-unification
Tiles/Scene Current clones on Archive `215:167` (not deleted): `1429:4952`,
`1429:5969`, `1429:6315`, `1429:6668`, `1429:7021`, `1429:7147`, `1429:7543`,
`1429:7684`, `1429:7823`, `1429:7962`, `1429:8101`, `1429:8272`, `1429:8416`,
`1429:9433`, `1429:9574`. Original Scene Current nodes were relabelled Archive
and hidden: `650:3694`, `946:4572`, `946:4702`, `946:4832`, `977:5069`,
`1119:5324`, `997:6627`, `998:5286`. Visible Current rails now show 地图 / Map
and hide 场景. Empty Current hides the four unbuilt output cards and the
decorative pixel person (aligned with D-55 runtime). Implementation baseline is
the 2026-08-29 Map unification in `src/ui/studio/studio.html`, `studio.css`,
`tilesView.js`, and `app.js`, plus browser evidence
`/tmp/gametool-map-unify-qa-1788026558871/`. A 2026-08-30 Figma cleanup pass then: moved leftover UX Scene frames `997:6627`
and `998:5286` into Archive section `726:4448`; hid historical Scene v1/v2
`56:135` and `603:5380` on that section; dropped Map Ready/Building/Complete/
Failed/Stale/UX Present starts, leaving four Map starts (`603:4360`,
`1432:4767`, `1432:5797`, `1432:6978`) while retaining other Studio module
starts (Current Present = 50); restacked 390 frames to 390×2200 with settings
column then canvas/dock; widened the English empty status box so it no longer
covers Map settings; hid Complete editor-method, Job validation body, map-meta
hash, and technical dock truth. File URL
https://www.figma.com/design/ro8w6TKkpd969zW2V5bmkx ; Current page
https://www.figma.com/design/ro8w6TKkpd969zW2V5bmkx?node-id=0-1 ; ZH desktop
https://www.figma.com/design/ro8w6TKkpd969zW2V5bmkx?node-id=603-4360 ; EN
desktop https://www.figma.com/design/ro8w6TKkpd969zW2V5bmkx?node-id=1432-4767 ;
ZH 390 https://www.figma.com/design/ro8w6TKkpd969zW2V5bmkx?node-id=1432-5797 ;
EN 390 https://www.figma.com/design/ro8w6TKkpd969zW2V5bmkx?node-id=1432-6978 ;
Complete https://www.figma.com/design/ro8w6TKkpd969zW2V5bmkx?node-id=910-4970 ;
Archive section https://www.figma.com/design/ro8w6TKkpd969zW2V5bmkx?node-id=726-4448 ;
Archive page https://www.figma.com/design/ro8w6TKkpd969zW2V5bmkx?node-id=215-167 .
`#studio-tiles-view` `data-design-source` already lists the six unified Map
Current IDs `603:4360,909:6025,909:7644,910:4970,911:4977,911:6385` and was not
changed (focused Tiles tests lock that exact list). Cleanup screenshots:
`/tmp/gametool-figma-map-cleanup/`. Remaining deviations: 390 Figma is a full
390×2200 stacked document (settings then canvas), **not** a 1:1 pixel match of
the 844px first-viewport browser shot, which does not include the canvas;
Complete still shows the user-facing “验证与导出已就绪” card; EN/390 empty
IDs are Current frames but not in `data-design-source`. True scene editing
remains unimplemented. Guarded focused
Tiles/Scene/navigation/legacy tests passed 47/47 (TAP 735.473 ms; guard 790 ms;
peak RSS 101744 KiB; exit 0). Resource-guarded system Chrome passed `#tiles` and
`#scene` at 1280×900 and 390×844 in Chinese and English: visible rail is Map
only, both hashes show the Map workspace, Scene form is not visible, empty
output cards are absent, and there is no horizontal overflow, duplicate ID,
console error, or page error. The run made 58 GETs and zero non-GET / Provider /
Accept / build / export calls. Guard elapsed 7452 ms; peak RSS 1,639,616 KiB
across 12 processes; exit 0. Evidence:
`/tmp/gametool-map-unify-qa-1788026558871/`, `report.json` SHA-256
`404830ee0e478db8091d5c2268707cf81ae60295734e2ae8834af50356d72464`.

**D-57 incremental evidence:** Figma Present and Current Rail prototype metadata only, on Game-tool `ro8w6TKkpd969zW2V5bmkx`. Phase 1: file-wide Present went from 65 (64 on Current page `0:1` plus 1 on Archive page `215:167`) to 54 by removing 11 Archive/SUPERSEDED flow starting points; the nodes were not deleted, moved, or renamed: `688:3826`, `1289:5086`, `1289:5436`, `1289:5786`, `1289:6136`, `1289:6486`, `1289:6836`, `1289:7186`, `1289:7536`, `1313:5247`, `1313:5597`. After write, `0:1` Present is 54, `215:167` Present is 0, `706:4136` and `683:4154` remain Present starts, and the remaining 54 match the pre-write keep snapshot (`extra=[]`, `missing=[]`, `renamed=[]`). Phase 2: eight Current Rail `NAVIGATE.destinationId` values only — `797:4760` `54:107`→`603:3340`; `797:4764` `54:1883`→`603:4360`; `797:4768` `56:135`→`650:3694`; `797:4772` `56:1916`→`646:3692`; `706:4148` `54:107`→`603:3340`; `706:4152` `54:1883`→`603:4360`; `706:4156` `56:135`→`650:3694`; `706:4160` `56:1916`→`646:3692`. Independent read-only re-verify: all eight destinations match; each keeps exactly one `ON_CLICK`+`NODE`+`NAVIGATE`; `rolledBack=false`; `706:4226` still destinations `221:2189` with one reaction; Present remains 54; `706:4136` and `683:4154` remain starts with parent `700:3836`; no node delete, move, or rename. This does not change Studio runtime: `#sequence`, `#tiles`, `#scene`, and `#project` already exist, and `data-design-source` already lists Sequence `603:3340`, Tiles `603:4360`, Scene `650:3694`, and Project `646:3692`. No API, Job, Provider, pipeline, artifact, exporter, route, or parameter-binding change. No npm test, build, or browser run. No verified Figma numeric version id or named History is recorded. Independent review pending. Final human visual acceptance remains pending.

**D-55 incremental evidence:** Two Tiles human-feedback items. (1) Implementation-only deviation: Studio deleted `.tiles-pixel-person` and its exclusive CSS. The empty copy uses `.tiles-empty-copy`. Figma Pixel Head/Body/Legs/Shadow on Current empty `603:4360` / UX `997:5491` were **not** mutated (Figma person mutation count = 0). Reason: the operator said the figure adds no useful information. (2) Build-outputs information design: local dock title is 构建产物 / Build outputs; cards lead with Chinese/English names and purposes; filenames are secondary monospace; phase states are 尚未构建 / 等待构建 / 正在生成 / 可下载 / 未生成 / 需重新构建. Download still unlocks only when `phase === complete` and `localTilesResultIsCurrent(state)`. Tiled still downloads the JSON+TSX pair. Current Figma docks on `603:4360`, `909:6025`, `909:7644`, `910:4970`, `911:4977`, `911:6385`, and UX `997:5491` were rewritten to the same IA; frame IDs, Archive boards, prototypes, and person nodes are unchanged. No API, Job, Provider, exporter, artifact, or route contract changed.

**D-54 incremental evidence:** Figma Current was audited against the
permanent-delete gate. Permanently deleted nodes remain those recorded
in the first D-54 write. Unique-evidence nodes stay archived, not
deleted. Live 2026-08-20 Plugin API scan (after `setCurrentPageAsync`)
showed page `215:167` is **not empty**: it hosts frame `215:168`
(1600×1995, 10 children) with superseded IA, `角色打包` naming, old
Job enum copy, “Next batch Phase C”, “PARALLEL NOT REPLACE”, and
stale “DESIGN.md 与此同步” copy. That page/frame were renamed Archive /
Historical Design Spec · NOT CURRENT and banner `1245:5085` /
`1245:5086` now point at
`docs/roadmap/studio-migration-status.md` plus Authority `1073:5047`.
They are **not** Current or Authority. The file has three pages:
Current `0:1`, required Icons `1:2`, Archive Design Spec `215:167`.
Scene `#studio-scene-view` `data-design-source` does not list
`603:5380`; that node lives on `data-design-archive-inventory`.
Studio CSS keeps Current and Archive Scene IDs on separate lines.
Historical v1/v2 / inventory boards remain **labeled inside Canonical
Sections**; a whole-page scan still sees them. They are not
implementation sources. Eight Canonical Sections, ten UX
Current/override frames, Foundations, Components Library, Design
Authority, and Icons remain. UI Design Present now has 54
flowStartingPoints after D-57 (D-54 recorded 55; a later live scan
before D-57 counted 65: 64 on `0:1` plus 1 on Archive page `215:167`).
Archive page `215:167` Present starts are 0 after D-57. Current Scene
start is `650:3694`; Current Project start is `646:3692`. Relabelled and removed from Present starts, boards kept:
`316:2510`, `221:2189`, `321:628`, `56:1916`, `321:2657`. No route,
runtime controller, API, Job, Provider, artifact, or Project gate
changed.

**This-round findings before the residual fix:** banner `1245:5086`
cited a missing `DESIGN.md`; stamp `1247:5085` claimed a Figma version
was recorded in the repo; six Archive/NOT CURRENT frames were still
Present flow starts; CSS mixed Current and Archive IDs on one line;
the Scene test treated a same-line `archive` mention as sufficient.
Those residuals are repaired in this change.

**Figma orientation marker:** Authority text `1247:5085` records the
write window 2026-08-19 23:57–2026-08-20 00:02 Asia/Shanghai. REST
`GET /v1/files/ro8w6TKkpd969zW2V5bmkx/versions` returned 403, so no
numeric Figma version id exists in the repo. This marker cannot
precisely roll back the file. Exact restore still requires a human to
locate the correct Figma history entry.

**D-53 incremental evidence:** Sequence empty Current is text-only after
removing decorative person nodes `870:4740`–`870:4743` and Studio
`.sequence-pixel-person`. Binding `#studio-sequence-binding-title` now
projects the nine Current state titles in Chinese and English; the Binding
card and its real nine-phase body remain. Guarded focused Sequence tests
passed 22/22. Resource-guarded system Chrome passed 1920×1080, 1135×998, and
390×844 in Chinese and English with zero horizontal overflow, empty console
logs, and zero non-GET requests. This is display/localization only. Final
human visual acceptance remains pending.

**D-52 incremental evidence:** Product commit `2832a1a` synchronized
Figma Current and Studio copy to Rail「取帧」/“Extract”, page「动作取帧」/
“Frame Extraction”, input「动作素材」/“Source media”, and CTA「分析素材」/
“Analyze source media”. Guarded focused verification passed 36/36. The
maintained Studio passed Chinese/English browser checks at 1135×998 and
390×844 with zero horizontal overflow and empty console logs. No upload, Job,
Provider, or other POST action ran. Final human visual acceptance remains
pending.

**Design file:** Figma `Game-tool` (`ro8w6TKkpd969zW2V5bmkx`)

This document is the shortest authoritative answer to "what is the Studio
today?" Read it before inspecting historical plans or Figma Archive material.
It records current product truth, design authority, accepted retirements, and
known unfinished UX work. Historical plans remain evidence; they do not replace
this snapshot.

## Authority Order

When sources appear to disagree, use this order:

1. Maintained runtime capability, API, Job, artifact, and safety contracts.
2. The Figma Current frame for the exact route and state.
3. An approved UX override, but only for the hierarchy, copy, or interaction it
   explicitly names.
4. This current-state snapshot and the active approved implementation plan.
5. Historical plans and Archive frames as context only.

Figma identities have distinct meanings:

- **Canonical Current:** the implementation source for an unchanged state.
- **Approved UX override:** a scoped replacement for specifically recorded
  hierarchy, wording, or interaction; it does not replace unrelated states.
- **Archive / Superseded:** history only. Never implement from it, promote it,
  or use it to contradict Current.

The preserved canonical Sections are:

| Surface | Section |
|---|---|
| Character | `700:3836` |
| Action | `726:4445` |
| Sequence | `726:4446` |
| Tiles | `726:4447` |
| Scene | `726:4448` |
| Project | `726:4450` |
| Settings | `749:4445` |
| QA | `955:4572` |

The approved optimization Section is `995:5125`. Its ledger is 10
Current/override frames plus 2 Archive evidence frames (`996:5274` and `997:6498`),
plus the later human refinements D-08 through D-13, and is recorded in
`docs/plans/2026-08-13-studio-ux-optimization.md`. On 2026-08-14, Character
Compatibility left Figma Current: UX v4 frame `996:5274` is Archive / NOT
Current and is not a Current visual gate. On 2026-08-15, D-45 restored
Project Current `998:5408` after the brief D-44 hide. The remaining UX v4
frames are still scoped overrides. Both sources are in the same Figma file.
Their coexistence is provenance, not permission to choose whichever frame
looks newer.

**Figma Current no longer includes Character Compatibility.** Independent
「高级兼容」Config / Running / Diagnostic / Release boards are Archive /
Superseded only. Design Current for AI generation is the unified Strict-style
flow, with Gemini as the only Provider that may look available. D-15 synced
Studio Current product UI to this rule: Compatibility is no longer a first-level
mode, workspace, or Project candidate. API, CLI, and backend compatible
generation remain outside the Current Studio product path.

**Figma Current no longer includes Tiles Provider material evaluation.**
Frames `912:5088`, `913:5095`, `913:5234`, `914:5109`, `918:5310`, and UX v4
`997:6498` are Archive / Superseded only. D-41 hid them and the local
`Mode/AI` chips. Local Tiles Current remains the only implementation source.
API and CLI benchmark commands remain outside the Current Studio product path.

**Figma Current includes Project again after D-45.** Frames `646:3692`, UX v4
`998:5408`, and caption `646:3821` are Current. Current-page and Scene
Current rails use `Nav/项目`; the brief D-44 hide and `Nav/产出` label are
gone. **D-51** retargets Scene Current `Nav/项目` prototypes to Current
Project `646:3692`. Scene Current visible/hidden navigation copy now uses
「项目」/“前往项目合成…”, not 产出. `603:5380` is Archive / Historical v2 ·
NOT CURRENT inventory, the GameTool main-path v2 historical prototype start;
keep it, do not implement from it, and do not continue Current-style edits.
This is a recorded repair, not human acceptance. `/api/project-pack` and the
legacy `project-pack` → `#project` map remain the maintained compose path.

The Figma file also contains a locked, non-product orientation Section
`1073:5047`, named `00 · DESIGN AUTHORITY · READ FIRST · NOT UI`. It records the
same authority order, canonical Section IDs, scoped-override boundary, Archive
warning, permanent-delete gate, and this current-state document path directly
on the canvas. It is an index for operators and agents, not an implementation
frame or a competing design source. On 2026-08-14, card `1099:5319` was updated
to record that D-15 synced Studio Current product code: Compatibility is
retired from Studio UI, and Gemini is the only generation-ready Provider.

### Figma cleanup record

On 2026-08-13, a dependency audit checked repository references, prototype
inbound links and starting points, component definitions, unique-state
coverage, and Current replacements before deletion.

- The stale external reference `525:3340` is not present in the current Figma
  file. It must not be confused with maintained Sequence Current node
  `603:3340`.
- Four hidden Tiles drafts with no inbound prototype reference, no prototype
  starting-point role, no component definition, no repository reference, and a
  complete Current replacement were permanently deleted:
  `909:4765`, `909:6385`, `915:6097`, and `915:7078`.
- Their orphaned captions were also deleted:
  `909:6024`, `909:7643`, `915:7077`, and `915:8058`.
- Their Current replacements remain:
  `910:4970`, `911:4977`, `914:5109`, and `918:5310`.
  On 2026-08-15, D-41 moved the two AI replacements `914:5109` and
  `918:5310` to Archive / NOT Current. Local replacements `910:4970` and
  `911:4977` remain Current.
- Prototype-linked historical nodes such as Character v2 `221:167` were not
  deleted or relabelled. They remain history-only because changing them would
  currently break old demonstration paths; the authority index prevents them
  from being mistaken for Current.

On 2026-08-14, Character Compatibility was removed from Figma Current by
relabel, not permanent deletion. Prototype-linked Compat boards remain in
the file as Archive so old demonstration paths are not destroyed.

Removed from Current authority (nodes kept, renamed Archive / Superseded):

| Former Current role | Node ID |
|---|---|
| Compat Config | `971:5301` |
| Compat Running | `971:6230` |
| Compat Diagnostic | `971:7159` |
| Compat Release | `971:8101` |
| UX v4 Compatibility | `996:5274` |
| Captions | `971:6229`, `971:7158`, `971:8100`, `971:9022` |

Current Character chrome change: `973:5278` Entry/AdvancedCompat on AI 生成
`683:4017` is hidden and its inbound prototype reaction to `971:5301` is
cleared. Other Character states were not restyled.

Affected prototype connections (recorded, not bulk-deleted):

- Cleared: `973:5278` → `971:5301` (AI 生成 一级页签)
- Kept as Archive internals: `973:5149` → `971:6230`; `996:6252` → `971:6230`;
  `973:5190` → `971:7159`; `973:5192` → `971:8101`; `973:5217` → `971:5301`
- Compat frames still navigate out to Local/Action/Sequence/Tiles/Scene/Project/
  Settings and to historical v2 destinations
- Compat `971:5301`, `971:6230`, `971:8101`, and `996:5274` are former
  Present flow starting points. D-54 removed those starts; the frames
  remain Archive / NOT CURRENT inventory and must not be described as
  current flow starting points.

Settings Current still shows OpenRouter / compatible Base URL as configuration
surfaces, but they must appear disabled / not generation-ready. Gemini is the
only Provider that may look available for generation. On 2026-08-14 the covered
legacy Provider dashboard bodies were moved out of Current:

| Archive body | Node ID |
|---|---|
| Old shared Provider card · 配置 | `978:5131` |
| Old shared Provider card · 已保存 | `978:5272` |
| Old shared Provider card · 失败 | `978:5413` |

Each of `978:5077`, `978:5218`, and `978:5359` now keeps Header chrome plus one
Provider UI overlay. The save control is neutral 「保存配置」; the success state
is 「配置已保存（未启用生成）」, not 「已激活」. Failure is 「配置保存失败」.
OpenRouter / compatible cards `979:5139`, `979:5191`, and `979:5234` are full
opacity; generation unavailability is expressed only by 「未启用生成」 badges,
explanatory copy, and the capability matrix. Internal layer `979:5191` is
`Advanced Provider Saved · Generation Disabled`. Collapsed failure
「技术详情（已收起）」 on `978:5359` prototypes to Current
`1111:5317` (`配置保存失败 · 技术详情已展开`), which shows the English
diagnostic `provider config failed: upstream rejected compatible Base URL`.

On 2026-08-16, the approved D-47–D-50 cleanup reconciled the affected Figma
Current compositions with the maintained Studio hierarchy. Action Current no
longer exposes a Source Set entry or reaction; Tiles and Scene Current no
longer show the retired flow/step/binding chrome; audited Current topbars use
the 92 px title slot, hidden crumb/search, x=132 first control, and Secondary
topbar export; audited Rails contain all eight destinations with QA in the
utility group. Character running uses the shared discrete `JobStage` instance
`1084:5191` with no percentage. Representative verified frames are
`971:4596`, `683:3795`, `829:6334`, `603:4360`, `946:4702`, and `998:5408`.
`603:5380` is not a D-47 Scene Current source; it is Archive / Historical v2
inventory and is not an implementation source. The operation changed Current
nodes only; other Archive and hidden inventory were preserved.

Do not permanently delete another Figma node until the same dependency audit
passes. A name such as `v1`, `v2`, `Archive`, `stub`, `Superseded`, repair
workbench, or workspace shell is sufficient to disqualify a node as Current,
but is not by itself proof that deletion is safe.

On 2026-08-19 23:57–2026-08-20 00:02 Asia/Shanghai, D-54 ran that
gate. Permanently deleted nodes are an operator-recorded deletion
gate; live absence of `1094:5075` and the 22 hidden page-root captions
listed in `docs/plans/2026-08-13-studio-ux-optimization.md` was
reverified. Current evidence cannot independently rebuild the
pre-deletion seven-item proof. Archived rather than deleted because
unique evidence or historical prototype value remains:
IA `209:167`, Interaction Map `237:327`, IA Redesign `639:3649`,
superseded note `643:3741`, Compat kit frame `1094:5074`, set
`1094:5421`, and variants `1094:5417` (Config), `1094:5418` (Running),
`1094:5419` (Diagnostic), `1094:5420` (Release), Settings stub
`726:4451`, Tiles hidden drafts `907:4568`, `908:4661`, `911:5335`,
`915:5116`, `908:5920`, Scene v1 `56:135`, Scene historical v2
`603:5380`, and Design Spec page `215:167` / board `215:168`. The first
five live in section `1239:5085`. Design Spec stays its own Archive
page. Compatibility, Tiles Provider, Action Source Set, Sequence
Archive, Character v2 demonstration boards, and other labeled
inventory stay inside their Canonical Sections. Do not restore deleted
Sequence people `870:4740`–`870:4743`, Tiles drafts `909:4765` /
`909:6385` / `915:6097` / `915:7078`, their captions, or stale
external `525:3340`.

## Maintained Browser Surface

Studio is the sole maintained browser application. The accepted visible rail
order is Character, Extract (`#action`), Sequence, Map (`#tiles`), Project, QA,
and Settings. `#scene` remains a compatible hash that opens Map. Every route
below is real; Scene is inventory rather than a parallel product page:

| Route | User object | Maintained capability and release boundary |
|---|---|---|
| `#character` | Character | Standard and Advanced Local processing; Strict Review/Confirm/one-call observation/evidence/human Accept. AI generation is one unified native-Gemini flow, and prompt authoring lives in that source form rather than a separate Character helper. Compatibility is Archive in Figma and retired from Studio Current product UI. Local Quality Report remains a real surface but defaults to a closed native disclosure: status and finding count stay visible, taxonomy details expand on demand. Failed/quality-blocked Local no longer paints a second issue list in the stage body; the stage keeps a localized block category plus any concrete non-machine current-task response and the download lock, while the right disclosure is the only detailed report. Local import is one 300 px left column: source, current values, processing parameters, and a single sticky start CTA. The empty-form source layout defaults to `fixed_region_motion_v0`; 8 × 8 remains selectable. The former “当前流程” explainer is not shown; a later operation guide may replace it. Studio topbars hide the `· …` crumb on every route; see `docs/guardrails/studio-topbar-convention.md`. There is no Advanced-entry click and no second run button. Calibration, manual cut lines, and automatic-grid reset stay in DOM and JS as inventory; Current Local UI does not expose them. 8 × 8 uses the automatic even grid (`manualOverrides` default null). Figma Current config `971:4596` was updated to this column on 2026-08-14; overlay `972:5069` is inventory only. D-21 sets left-column controls to 28 px height and 8 px stack gap, including a full-width black-matte choose/clear pair. Verified clip tiles crop the first frame from the current `normalized_sheet_url` plus `animations.json`; they do not use placeholder art. The thumbnail fits opaque sprite bounds to about 80% of the 48px box. Clip names and frame/FPS sit in reserved rows under the thumb; the Local dock is 120px so they are not covered. The playable center canvas follows the stage host box so the actor is not CSS-stretched. Export and Project eligibility require current-input, terminal, quality, artifact, and URL binding gates. |
| `#action` | Source media | Import source media; analyze, preview, build, review evidence, apply, recover the same operation where supported, and download only the current verified Applied artifact. D-52 names this user path Rail「取帧」/“Extract”, page「动作取帧」/“Frame Extraction”, input「动作素材」/“Source media”, and primary CTA「分析素材」/“Analyze source media”. Eighteen maintained options remain real. The Current context toolbar of preset clip names is hidden; operators type the action name in the left Frame selection list. The `action` option still defaults to `walk_down` and still binds to `runtime_action`. Selection recipe stays bound at `motion_selection_recipe_v2` and is not shown in Current UI. Source Set / existing-strip entry and its secondary page are inventory only; Current UI does not expose them. The former left-column “当前流程 / 新建动作处理” explainer is not shown; `#studio-action-phase-title` remains for `aria-labelledby` and focus. The `#action` route, Motion API/module names, machine fields, Job states, parameters, and artifacts are unchanged. |
| `#sequence` | Ordered frames | Import images, preserve explicit manual order, build Sheet/JSON/GIF/ZIP, edit frames, and retain honest partial, stale, local-error, and rebuild states. Old output is locked after input order changes. The former left-column “当前流程 / 序列打包” explainer is not shown; a later operation guide may replace it. Phase copy IDs remain for `aria-labelledby` and writers. After D-53 the empty stage is text-only: the decorative person is gone and title/body use the freed Current slot. The Binding card remains visible and still carries the real nine-phase information; only its heading is localized to the Current state titles. Display and localization only; data flow, GIF request interface, artifact gates, and Archive `54:107` are unchanged. |
| `#tiles` | Map | Unified Map workspace: terrain material, map settings, editable corner-grid canvas, and verified export. Default built-in procedural material is explicit; a local image may replace it. Width, height, density, and seed are primary; solver and border remain real inside Advanced settings. Output cards (tileset, map preview, map project files, pack) appear only after a verified complete Job. Provider material evaluation stays hidden inventory (D-41). No complete Map AI generate-and-accept flow is exposed. Empty copy states the next edit step only. Figma Current Tiles frames remain the map-editor design source. |
| `#scene` | Map (compat) | Not a visible rail destination. `#scene` canonicalizes to `#tiles`. Scene Studio DOM, live Gemini generation, prompt helper, and Figma Current Scene frames remain inventory for the future true scene editor (actors, props, layers, collision, triggers, camera). They must not be presented as a second map form. |
| `#project` | Project package | Compose only currently verified Character and Scene inputs, or exact supported Job IDs; run the existing Project-pack Job, validate its manifest, and download only the verified ZIP. Project does not generate upstream assets. The former left-column “当前任务 / 合成” explainer and “能力边界” callout are not shown; a later operation guide may replace them. `#studio-project-title` remains for `aria-labelledby`. **D-45** restored Current reachability after the brief D-44 hide. **D-46** keeps the right stage in the remaining width instead of clipping it behind a 1020px min-width. |
| `#qa` | Manual checklist | Exactly five page-session-only operator checks. No API call, Job read, storage, automatic verdict, export unlock, release authority, or Project mutation. |
| `#settings` | Service session | Language, secret-handling boundaries, and read-only local tool status. Studio generation-ready is true only when the provider-state preset list contains an eligible native Gemini preset. A top-level Gemini route with empty, unavailable, illegal, or OpenRouter-only presets fail-closes. OpenRouter and compatible Base URL can be saved as service-session configuration through `/api/provider-config`, which replaces `runtimeProviderEnv`, but they are not connected to current Studio generation. Environment-sourced OpenRouter (`runtime_configured=false`) is “detected, not connected,” even when the route identity is undisclosed; it is not “saved / session replaced.” An active OpenRouter route plus an eligible native Gemini preset still shows OpenRouter as the service route and says Studio generation will use that Gemini preset. Saving other Providers without any eligible native Gemini fail-closes Character Strict, Scene online generation, and Tiles Provider paths. |

The 2026-08-28 direct browser annotations are the scoped visual authority for
the Character AI acquisition and Review states. The left column keeps the
editable Character description visible through `review_required`; changing it
prepares a different image and does not rewrite the sealed prompt or provenance
of the image currently under review. “Prepare another image” returns to the
existing provider-free Review step, after which the existing Confirm gate still
authorizes exactly one live call. The built-in layout, background, anatomy,
watermark, and unwanted-element constraints remain internal prompt-contract
inputs; Studio does not expose a decorative negative-prompt field that the
request contract cannot honor. Pending Review deep links restore the verified
sealed description once, and preparing a replacement clears the old pending
Job/Review query before creating the next Review.

Local processing controls stay hidden while the AI source is still acquiring
or awaiting human acceptance. After verified Accept hands off the original
bytes and SHA, AI uses the same maintained Local form, `/api/process-sheet`,
Job states, Quality Report, playable preview, Export, and Project gates. The
visual refinement does not change Provider selection, generation payloads,
Accept, or processing contracts. Official product documentation for comparable
prompt-and-result workspaces informed the information hierarchy only; no
external code or assets were copied. Focused Character verification passed
35/35, and direct browser checks covered Chinese and English at 1135×998 and
390×844 with no horizontal overflow or duplicate IDs. Those checks did not
click Confirm, Accept, or `/api/process-sheet`, and consumed no Provider call.
Figma Current was not mutated in this refinement; exact design-file sync and
final human visual acceptance remain pending.

Root and legacy shell URLs redirect to Studio; they do not load a parallel DOM
application.

| Legacy tab | Studio destination |
|---|---|
| `character-pack` | `#character` |
| `motion-source` | `#action` |
| `sprite` | `#sequence` |
| `two-point-five-d` | `#tiles` |
| `prompts` | `#tiles` |
| `project-pack` | `#project` |
| `qa` | `#qa` |

Missing, empty, unknown, repeated, or illegal `tab` values use the fixed
`#character` fallback. Query values never participate in destination URL
construction.

## State And Control Interpretation

Do not infer a capability from static DOM presence or a single Figma frame.
Studio keeps some terminal-state elements in the DOM and reveals them only when
their real phase and binding gates pass.

- Studio topbars do not show a `· …` crumb. Route, mode, and phase use the
  rail, page title, workspace tabs, and status badge. The title is Inter Semi
  Bold 14 in a fixed 92px column; the first control starts at 132px. Sibling
  controls use 8px. See `docs/guardrails/studio-topbar-convention.md`.
- Empty and setup states must not claim quality success, a verified artifact,
  an enabled preview, or a downloadable output.
- A disabled or hidden export control may represent a real terminal capability;
  do not delete it merely because it is unavailable in the current phase.
- `poll_paused` and recoverable observation errors resume the same known Job or
  operation. They are not permission to submit another Provider call.
- Character Local processing uses discrete phase labels with an indeterminate
  activity indicator. It never invents percentage completion, and a paused or
  terminal state never looks actively progressing. Verification failures keep
  the same terminal Job/input binding, show a localized blocking reason, and
  expose Quality Report detail only when a real report was returned.
- Partial, stale, diagnostic-only, blocked, failed, and accepted states are
  materially different. Do not collapse them into a generic success/failure
  stepper.
- Strict Character remains the Figma Current AI-generation state machine.
  Compatibility Character is Archive in Figma Current and is retired from
  Studio Current product UI. Do not implement from Archive, and do not treat
  API/CLI compatible generation as a Current Studio path.
- QA completion is an operator checklist state, not release, quality, or asset
  authority.

The shared user mental model may be described as Prepare, Process, Verify, and
Download, but it is not a requirement to render every module as the same
four-step UI. Each module must preserve its real sub-states and recovery
semantics.

## User-Facing Naming

Use names according to object level rather than forcing one word everywhere:

| Level | Example |
|---|---|
| Rail label | `角色` |
| Page or workspace | `角色工作室` |
| Asset or artifact | `角色资源包` |
| Product action | `导出` |
| Transfer action | `下载` |
| `#action` Rail label | `取帧` / `Extract` |
| `#action` page title | `动作取帧` / `Frame Extraction` |
| `#action` input object | `动作素材` / `Source media` |

Primary task surfaces use human task language. Exact Job status codes, Profile
IDs, layout enums, hashes, artifact URLs, and protocol names belong in a clearly
labelled technical disclosure unless the exact value is required to make an
actionable choice. Translating a visible label must never translate or mutate
the underlying request value.

## Retired Or Forbidden Browser UI

Do not recreate any of the following as active Studio controls:

- the legacy root/tab shell and its strongly coupled DOM controllers;
- Character Smart/Strict fake grid choices, preview background colour, or Save
  Project control;
- Scene Day/Night/Rain decorative variants;
- hidden benchmark-gallery browser DOM, automatic fetch, or refresh binding;
- obsolete global search without a maintained search contract;
- setup Profile/internal-ID cards, decorative fake result artwork, checkbox-like
  process markers, or duplicated visual status copies;
- Action empty-state artwork or the five-row source identity/upload metadata
  table;
- legacy-workspace links from maintained Studio routes.

Retirement of browser UI does not retire a maintained backend, CLI, pure
function, protocol, test, or artifact contract that still has a consumer.

## Known Current UX Follow-Ups

These are current observations, not approved capability changes:

1. The UX candidate in draft PR #49 still requires final human visual
   acceptance before it becomes the accepted main baseline. Frame `996:5274`
   is pre-D-15 / superseded Archive evidence and is not a Current visual gate.
   Character Compatibility code was retired from Studio Current in D-15.
   D-51 repaired Scene Current project prototypes and leftover 产出
   navigation copy on 2026-08-17; that repair is recorded, not accepted.
   D-52 records the approved `#action` user-facing 取帧 / Extract naming on
   2026-08-17. D-53 records the Sequence empty-state person removal and
   per-state Binding titles on 2026-08-17. D-54 records the Figma Current
   cleanup and Scene archive-provenance repair; Figma writes began
   2026-08-19 23:57 Asia/Shanghai and the first repo commit is `cd4b7d5`
   at 2026-08-20 00:05:51 +0800. This closeout is 2026-08-20. Figma
   Current, repository copy, focused tests, and bilingual
   desktop/narrow browser verification are synchronized through D-53;
   D-54 did not rerun browser checks. Final human visual acceptance
   remains pending.
2. Settings Figma Current still has no dedicated environment-detected
   OpenRouter state or active-OpenRouter-plus-eligible-Gemini-preset state.
   Existing labeled visual fixtures prove Studio product projection only;
   they are not Figma Current authority.

Do not silently fix these while performing another task. First confirm the
relevant Figma Current state, record the scoped design change, preserve the
underlying value and state contracts, and obtain the required approval.

## Protected Contracts And Paths

- Do not change `/api/process-sheet`, `/api/generate-character`,
  `/api/provider-config`, Job schemas, artifact protocols, or
  `/api/benchmark-gallery` as incidental UI work.
- Do not copy server pipelines or import retired strongly coupled DOM
  controllers into Studio.
- Preserve the maintained Motion API/binding/options modules, Sprite API/core,
  Character calibration core, Provider/i18n/DOM helpers, Editor dependencies,
  benchmark backend/CLI modules, and their real consumers.
- Do not read, modify, clean, or stage
  `generated/job_mso2thdv_qsfx95`,
  `generated/accepted_v1_job_mso2thdv_qsfx95`, or untracked `node_modules`
  unless a later human instruction explicitly changes that boundary.
- No real Provider call is part of ordinary Studio UI verification.

## Update Discipline

Update this document in the same coherent change whenever any of the following
changes:

- the accepted Studio baseline or active candidate acceptance state;
- a Studio route, rail position, redirect, or maintained capability;
- a Figma canonical Current Section or approved override;
- a real phase, recovery action, quality/download/Project gate, or Provider-call
  budget;
- an approved UI retirement or a known UX follow-up.

Do not create another document that also claims to be the current Studio source
of truth. Implementation plans record scope and evidence; protocols record
stable contracts; this file records the current cross-module product snapshot.
