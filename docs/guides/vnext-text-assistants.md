# VNext text assistants

The opt-in entry is `/src/ui/vnext/vnext-preview.html`; it does not replace the
Studio default. Open or create a v1 project, leave Skill unselected, choose the
text model at the right of the composer, and send a message. Sprite remains a
disabled content-type control on the left. Ordinary discussion uses selected
canvas IDs as context, without image bytes. A clear creative request runs the
selected model's native action directly. With no Skill selected, no generation preset is offered or executed. An explicitly selected Skill permits only that preset (see [Direct creative actions](#direct-creative-actions)).
Only these actions send the selected canvas's saved pixels: Codex drawing or Codex
image generation with an explicit reference, and Astra pixel and canvas & timeline
edits, which work on the selected canvas itself.

| Connector | Pinned native version | Requested model | Native executable |
| --- | --- | --- | --- |
| Codex | 0.160.0, 0.162.0-alpha.2, 0.162.0-alpha.17.2, 0.163.0-alpha.10.2, 0.163.0-alpha.11.1 | `gpt-6.1-sol` | `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex` |
| Grok | 1.0.40 | `grok-4.7` | `~/.local/bin/grok` |
| Antigravity | 1.2.14 | `gemini-3.8-flash-low` | `~/.local/bin/agy` |

Native installations and account login are operator prerequisites, not bundled
executables or credentials. This is a local integration, not a self-service
login wizard. Provider availability and account entitlement remain external.
Do not replace a pinned model or version merely to pass a failed check.

Codex and Grok require the already provisioned private profiles under
`~/.local/share/gametool/{codex-assistant,grok-assistant}`. The adapters verify
the exact approved configuration; they do not import the developer's default
profile. Antigravity reuses native account login and creates/verifies its
restricted agent in `~/.local/share/gametool/antigravity-assistant/workdir`.
It checks for hooks before each message and rejects unsupported tool events.
Never commit these profiles, authentication files, native conversations or keys.
If a profile/version/login check fails, repair that explicit prerequisite;
do not disable the safety check, copy credentials into the repository or retry
the message automatically. Fresh-machine profile provisioning is not automated.

Run the maintained server under the existing resource supervisor. For isolated
acceptance, both `EDITOR_WORKSPACE_ROOT` and `EDITOR_GENERATED_DIR` must resolve
inside the checkout (for example `workspace/acceptance` and `generated/acceptance`).
A workspace outside the project root violates asset-path validation. Keep the
server attached to a tracked terminal and stop it after checking the page.

The composer clears on send. Switching models preserves the unsent draft and
the same visible project discussion, including replies labeled by model.
Only the next request uses the selected model. While replying, the
same Send control becomes Stop and model selection is locked. Provider and
workflow errors appear in the conversation, whereas local-service disconnection
(`assistant_service_unavailable`) is shown as a single application-level
warning toast (`#vnext-project-toast`, Figma `1970:130` / Warning `1970:96` / usage `2109:1203`) rather
than model-signed chat replies; restoration must not replace a newer draft. The removed
persistent footer note remains an accessible status announcement only. Long
model names may be truncated; the full name is available in the selector title.
Project discussion history is saved under the project's
`runtime/conversations/` directory. Reload reopens the last project for this
browser origin and reads the current discussion; it never sends a model request
or re-applies an old pixel proposal. The existing New conversation icon starts
a separate discussion; previous records remain on disk. A failed history read
keeps Send blocked until a successful reload or explicit new discussion.
Definite provider failures can be corrected and sent again explicitly; unknown
outcomes (a Stop, a lost reply or a restart) pause only that model's native
channel, without automatic retries. Since `DIRECT-ACTIONS-20261020/r3` the paused
channel shows one plain note with **Continue here** instead of requiring a reload
or New conversation: it keeps the same discussion, its history and the draft,
never sends the stopped request again and never applies an earlier action. The
client re-reads the shared history and, only if the server still holds the channel
paused, calls `POST /api/editor/projects/:pid/assistant/resolve` (body exactly
`provider`, `conversation`, optional `discussion`). The route never calls a model:
the unknown turn stays recorded as unknown, and the channel's next message starts a
fresh native thread (the shared discussion history still travels with it). While a
stopped request is still winding down it answers `assistant_busy`, and the note
asks to try again in a moment. Since `DIRECT-ACTIONS-20261021/r4` **Continue here**
holds the same concurrency boundary as sending until its write has been saved or
rolled back: a send or a second Continue here in that window answers
`assistant_busy` and starts nothing, a failed write leaves the channel paused, and
the next message keeps its durable pending receipt and starts exactly one request.
Because the boundary is the conversation service's single in-flight request, Continue
here also answers `assistant_busy` while any other reply is running; the note then says
another reply is still running or the stopped reply is still ending.
Each native channel retains at most 64 turns and reserves storage before calling
a provider (2 MiB record limit). A bounded shared-discussion manifest links the
four channels while keeping login, native thread IDs and failure state separate.
The first shared discussion links the four existing current provider records;
it does not overwrite them or replay their actions. New conversation creates a
new shared manifest; previous records remain stored.
Changing models, reloading or switching projects never applies, previews or
selects an earlier result. When shared history contains a result that was produced
but never applied, and it still matches the current project revision, one note offers
**Apply it** or **Dismiss**. Apply is the request: it reads the saved result without
calling a model, re-checks its target, revision, scope and hashes, applies it with its
original operation ID, and offers Undo. Dismiss hides the offer (remembered in this
browser; if storage fails the note says so).
History is read through `GET /api/editor/projects/:pid/assistant/history?provider=...&shared=true`.
The session endpoint joins the current shared discussion with `shared:true`;
only the explicit New conversation action also sends `fresh:true`.
Full messages remain visible and stored. Each model request includes recent
shared excerpts as historical data, within the unchanged 6000-character input
ceiling; older or long content may be omitted from model context. Historical
actions are never executed again.
If the local service stops before a message is sent, a single top-center warning
toast (`Local service unavailable` — `Draft kept. No message sent. Restart the
service, then reload.`) identifies that connection failure without appending
model-signed chat bubbles, preserves the draft, does not stack notifications
when switching models or repeating failed reads while offline, and keeps Send
blocked with its accessible status reason even after the toast is dismissed or
auto-hidden until the service is restored and the project is reloaded. If the
local service drops only after a model reply has already returned (for example,
while reading a returned canvas & timeline candidate), the user message and run
turn remain in the conversation, the toast and status report that the reply
completed but the result could not be read yet and was not applied (never claiming
`No message sent`), any newer composer draft stays untouched, and **Retry same
result** (or **Apply it** after reload) reuses the same candidate and operation ID
without another model call.

Native image receipts and validated output bytes are saved under
`runtime/images/`. The most recent 32 tasks are shown as compact messages.
Completed tasks no longer permanently fill the in-memory job limit. Reloading
uses `GET /api/editor/projects/:pid/image-generation/recent`, followed by the
existing job query only when needed. Reloading or restarting reads the same job;
a request that was running at restart becomes
unknown, not a fresh provider call. Adding a saved result requires an explicit
click. Import is deduplicated under the project mutation lock by source job ID,
including after a lost response; it does not reposition or restore an undone
canvas. No login files or unrelated native CLI transcripts are copied here.

The existing file icon downloads the selected saved canvas's currently displayed
frame as PNG, at its original pixel dimensions, without stage zoom or controls.
It is disabled with no saved canvas selected. This is not multi-frame/sheet or
whole-project export. Legacy JSON APIs now share loopback/same-origin protection
and a 16 MiB outer body ceiling; existing stricter per-route limits still apply.

<a id="direct-creative-actions"></a>

## Direct creative actions

A clear request for a result is the permission to produce it. The selected model
chooses one action from the application's capability catalog; the app runs it at
once, shows short progress in the conversation, applies or places the result, and
offers an optional **Undo**. Since `DIRECT-ACTIONS-20261020/r3` this includes the
preset sheet, whose Undo removes exactly its new canvas (r1/r2 placed it without an
Undo entry). There is no confirmation dialog, authorization card,
Save/Discard step or plan review in the normal flow. The model fills in missing
details from the conversation (size, style, palette, background, target) and asks
one short question only when an open choice would change the result and context
cannot settle it; ordinary conversation stays conversation.

| Action | Models | What runs | Result |
| --- | --- | --- | --- |
| `generate_image` | Codex, Grok, Antigravity (reference upload: Codex only) | One native image request on your account, no automatic retry | New canvas beside the selection, flat background removed (automatic proposal); Undo removes it |
| `draw_pixels` | Codex | One drawing reply for a 32×32 or 64×64 grid | `selected`: drawn on the selected empty canvas in place; `new`/`edit`: a new canvas beside the selection |
| `edit_pixels` | Astra | GameTool brush/fill/eraser tools on the selected 64×64 canvas or marked region, within a minted scope grant | Applied in place on native/derived canvases, as an editable copy beside an imported original |
| `edit_document` | Astra | Document tools including new pixel drawing across frames (`draw_frames`), frame timing, layers, canvas size, scoped frame revision (`editable_frame_ids` / `locked_frame_ids`), and active project references (`reference_ids`) | Applied directly as one undoable change (`restore-working` with `mode: 'structure'`); locked frames stay byte-identical |
| `use_preset` | All, only with that Skill explicitly selected | `fixed-region-motion`: plan check, the one Gemini call, processing, placement | Sprite sheet on a new canvas, with downloads; Undo removes that canvas |

**Scoped frame revision and project references (`Block 4 / N4`).** On a multi-frame
timeline, selecting a subset of frames for revision (`Alt/Cmd+click` or `Shift+click`
on frame headers, or the frame context menu's `Revise only frame N (lock others)`)
passes `editable_frame_ids` to `prepare-document`, `messages`, and `document-candidates`.
When only one editable frame remains in scope, excluding that last frame is disabled
(`Keep at least one editable frame in scope, or choose Unlock all frames.`) in both the
context menu and `Alt/Cmd+click` shortcuts so a 1-frame scope never silently unlocks
all frames; use `Unlock all frames` or the scope chip dismiss (`×`) to clear the scope
explicitly. All non-selected frames are locked: canvas dimensions (`w`, `h`),
`frame_order`, `layer_order`, shared `layers` metadata (name, visibility, lock state),
`links.copy_layers`, locked-frame link groups, `anchors`, locked-frame `text_objects`,
any `tags` touching locked frames, and locked frames' durations, cel identities, null
state, and pixel block hashes are frozen both in `documentToolSession` (`edit_structure`
and `compose_document`) and before disk commit in `acceptDocumentCandidate`
(`applyDocumentCandidate`), and single-step **Undo** (`restore-working` with
`mode: 'structure'`) restores the full prior structure and pixel state. Scoped candidate
`accept` and `resolve` require `expected_editable_frame_ids` matching the candidate's
scope and bind that list into the persistent receipt payload hash so lost-ACK or
post-restart recovery replays the exact same operation without duplicate revisions or
model calls. Any `links.groups` entry spanning both an editable frame and a locked frame
is rejected with `422 unsupported_input` naming the linked frames and layer rather than
silently unlinking or expanding scope. Users can also explicitly promote a clean,
saved frame composite (`Save frame to project references` / `Save frame`) or non-empty
cel (`Save cel to project references` / `Save cel`) into the project's persistent
`references` library (up to 64 total reference records per project including revoked
history, persisted across reload and reopen via content-addressed RGBA blocks, with up
to 8 active `reference_ids` per `Canvas & timeline` turn). The reference header and
status distinguish active references from occupied records (for example `63 active ·
64/64 records`) and disable promotion with an explicit reason at `64/64 records`
without implying that revoking frees a slot. If a reference save or revoke loses its
confirmation response, `#vnext-recover-reference` (`Verify pending save` / `Verify
pending revoke`) retains the original operation ID, payload, project, and epoch so retry
recovers the same request while blocking duplicate concurrent mutations. At narrow
viewports (`1024×768`), `.vnext-playback` wraps cleanly so the timeline `.vnext-scope-chip`
(`Revise F… · Lock F… ×`) stays unclipped and clickable alongside `#vnext-document-scope-bar`.
In `Canvas & timeline` turns, `read_document` lists active `references`, `read_image`
inspects source cels/frames or project references, and `compose_document` places
`source`, `reference`, or `blank` cels into editable frames while preserving locked
frames unchanged (structural placement/cropping of existing source or reference blocks,
not freehand pixel synthesis).

**How models learn the actions.** `src/editor-project/composerCapabilities.js` is the
one definition of actions, parameters, allowed values and presets. It generates
the model-facing contract text, the strict reply schema and the validator. Codex and
Astra adapters also enforce the schema as structured output, so their text carries
field meanings only. Grok and Antigravity receive the complete text contract: the
`type` discriminator, every required field, each allowed value and an example. The
preset's generation profile is derived from the server profile in
`src/character-pack/generationProfiles.js`. The UI router
(`src/ui/vnext/vnext-composer-actions.js`) refuses to start if its handlers do not
match the catalog, so a new capability needs one definition and one handler.

**Conversation presentation.** Replies, questions, progress and routine notices are
plain text under the model's name, with inline actions; consecutive turns by the same
model show the name once. A result that shows an image, the finished sheet with
downloads, and the Job ID recovery form use the richer block. A preset run is one turn
updated in place. Failures are written as sentences: provider or server codes and job
IDs are not shown in the conversation (the Job ID form is the one place a job ID is
entered). Finished results are announced through a polite status region
(`#vnext-run-status`); progress updates are not announced.

**Stop, Undo and recovery.** Progress offers Stop where waiting can end; a request
already started may still count toward usage. A Stop before the sheet's live call says
nothing was generated; after it, the Job ID form can check the same job. Undo stays on the
result after later messages, but only reverts while that result is still the latest
change; otherwise it says that this Undo was withdrawn and nothing was reverted, and
⌘Z / Ctrl+Z steps back through changes in order. If another change is still
saving, the same Undo stays offered and says to try again. Uncertain saves keep
**Resolve** actions that replay the same operation ID and payload and never call the
model again. The external Aseprite/MCP return review and destructive or
project-navigation confirmations keep their dialogs.

Since `DIRECT-ACTIONS-20261020/r3` every result binds its Undo only to the history
entry its own write recorded (shared helper `src/ui/vnext/vnext-result-lifecycle.js`),
never to an earlier change; Perfect pixels offers Undo only when its save recorded
one. A result whose write committed but whose canvas has not shown it yet is reported
as saved, not complete:

- **Generated image:** if the import commits but the project does not reload, the
  turn says the image is saved and offers **Reload canvas**. It re-reads the newest
  project (never rolling back a later change) and never imports or generates again;
  once the canvas shows the image, the same turn completes and gains its Undo.
- **Preset sheet:** a saved sheet whose canvas did not reload offers only **Reload
  canvas**, never a second add; Undo appears after the reload. Since
  `DIRECT-ACTIONS-20261021/r4` the reload completes only from a newest project read
  (this project, not older than the save, no project change in between) whose
  reload was committed to the shown canvas. A failed, stale, older or interrupted
  read keeps **Reload canvas** ("Saved, but the canvas could not be reloaded yet")
  and never shows the saved snapshot instead. Since `DIRECT-ACTIONS-20261021/r6` a
  read is also not shown when a newer revision of the same project was saved meanwhile
  (for example canvas positions saved while the read was delayed or while its canvases
  loaded): the newer positions and revision stay, the turn keeps **Reload canvas**, and
  the next click reads the newest revision and completes the same result with its Undo.
  The subscription sheet's reload follows the same rule and stays "reload pending".
  Since r7 such a refused read still completes the result when the canvas shown by then
  already holds the sheet (for example after **Discard and load**); it stays pending
  only while no shown canvas holds it.

**Add, recovery and Undo (`DIRECT-ACTIONS-20261021/r7`).**

- **Late add response:** an add's own response becomes the shown project only if it is
  not older than what is shown. When a newer same-project save already landed, the
  newest project is read and shown instead. Nothing is written again: no generation,
  processing or placement is repeated, and the newer layout stays.
- **One shared show step:** the preset add, the preset **Reload canvas** and the
  subscription reload all use it (`showSavedAddition`).
- **No override of the user's layout:** completing a result never moves a canvas that
  a later save moved. The sheet is placed beside the others only while it is still
  where its add stored it.
- **Placement status follows the canvas, not the saved asset.** A sheet the project
  holds but that no canvas shows reads **Saved, not on the canvas**, for example
  after Undo and a page reload (since r8 with **Put back on the canvas**, below), or
  when a later change removed it. No **Add to
  canvas** is offered there, since a new add would duplicate the saved sheet; the
  downloads stay.
- **After Undo in this session:** the turn reads **Undone** ("the sheet stays saved in
  this project") and offers **Redo**, which restores the same canvas. Redo is offered
  only while that is the newest undone change, and Undo is offered again afterwards.
  A Redo blocked by another save stays offered and says so.
- **Keyboard and earlier turns:** the card follows ⌘Z / Ctrl+Z and ⌘⇧Z / Ctrl+Shift+Z,
  re-reading its entry once the history step has moved. The card of an earlier run
  still answers for its own placement. In the subscription dialog the same button
  reads **Redo** in that state, and the open dialog follows the keyboard too.
- **Restored subscription records:** a record restored after a page reload does not
  know where its add placed the sheet. Once a later revision exists, completing its
  reload never moves the sheet.
- **Lost processing job:** if its sheet is saved but on no canvas, the plain note says
  so instead of "already in this project".
- **Project switch:** switching projects removes a released run's temporary candidate
  preview from the canvas.
- **Codex drawing:** a drawing recovered through `Resolve pixel drawing save`
  completes its original run turn, with that run's author and its Undo, even if
  another model is selected by then.

**Placement recovery (`DIRECT-ACTIONS-20261021/r8`).**

- **Put back after Undo and a page reload:** the page's history lives in memory, so
  after a reload an undone preset sheet has no **Redo** (the same holds once a later
  change has cleared its Redo). When this browser holds the page's own record of that
  Undo, the card reads **Saved, not on the canvas** and offers **Put back on the
  canvas**.
  - It restores the same canvas where it was, through the existing canvas restore and
    the recorded Undo request, and brings it into view. It becomes the selection unless
    another canvas was selected meanwhile. Nothing is added, processed or generated.
    The saved asset and every other canvas stay as they are.
  - While it runs the button reads **Putting back…**. If it was blocked by another
    save, not confirmed, or the project changed first, the card says so and the
    button stays. An unconfirmed request is sent again unchanged; nothing else waits
    on it. If a later read already shows the canvas back, it has no Undo entry, as
    after a reload.
  - Afterwards the card reads **Back on the canvas. Undo removes it.**, and Undo (or
    ⌘Z / Ctrl+Z) removes exactly that canvas again.
  - Without that record (the canvas was removed elsewhere, or the record was
    refused) the card stays **Saved, not on the canvas** with downloads only. A
    refusal, or a put-back canvas this view could not reload, is explained on that
    card.
- **Unsaved positions stay:** when a sheet's recovery shows it, a position the user
  gave that canvas without saving is neither replaced nor saved by automatic
  placement. **Save canvas positions** keeps it as usual.
- **Add to canvas during a layout save:** the first add of a preset sheet uses the
  revision shown after the sheet was downloaded and checked. A canvas save in the
  meantime therefore no longer makes the add fail.
  - If a canvas save, Undo, import, stroke or name is still being written at that
    moment, the add waits for it (up to 10 seconds), then sends with the newer
    revision. A save started after the add was sent meets the usual conflict dialog.
  - If that write is still in progress after the wait, nothing is added yet and the
    card says so; **Add to canvas** adds it later. A project opening during the wait
    ends it quietly.
  - An add whose result is unknown is sent again exactly as it was, and stays "not
    confirmed" until then.
- **Subscription reload note:** if the canvas is shown but recording its reload fails,
  or that answer is lost, the dialog reads "The sheet is on the canvas. Check status
  to finish recovery; nothing is added again." It keeps **Check status** and its
  working **Undo**. If the canvas has not been shown, it keeps the reload-pending
  message instead. Neither case reads "Adding was not confirmed".
  - Undo immediately changes the dialog to **Undone** with **Redo** while that
    history entry is eligible. **Check status** preserves the same undone entry
    and never puts the canvas back. Redo restores that canvas, without another
    asset, processing run or generation call. Keyboard Undo/Redo follows the same
    state. This does not add Put back or preserve Redo after a page reload.

A preset turn restored after a reload keeps the author who ran it (remembered in
this browser), or the preset's name when that is unknown.

**Placement and selection (r4).** A run's temporary candidate preview ends when its
sheet is placed: re-renders, late image loads and Undo never bring the candidate
back. The placed, editable canvas becomes the selection when the selection is still
the one the run started with (or empty, or the candidate); a canvas the user selected
during the run stays selected. A **Reload canvas** click owns the selection it was
clicked with; a placement that completes on its own after a project change ended in
this project (including a reopen that already holds the sheet) keeps the selection the
add owned, and still gets its Undo and its place beside the others. A placement
completed by Reload canvas is brought into view the same way as a direct one. A
placement whose project was switched away before it completed is not finished later:
its Undo is dropped and the sheet stays where it was stored. A new canvas from a preset
sheet, a generated image or a subscription sheet that would cover existing canvases is
moved beside them and only its own position is saved (other unsaved positions stay
drafts); that position write holds the same lock as an import, so Save positions, Undo
or another import wait for it (leaving the project asks first). If the position cannot be saved now (another change is
in progress) or its save fails, the canvas stays beside the others as a draft and the
status says to save canvas positions; an unanswered save says it was not confirmed.
Canvases the user arranged keep their positions.

An Undo clicked on a result that ⌘Z / Ctrl+Z already reverted is reported as undone,
never as a later change: conversation results and Perfect pixels say it was already undone,
and the preset sheet and subscription dialog show their undone state.

**Subscription sheet.** The Subscription sheet… dialog runs the same way: describe
the character and choose **Generate sheet**. The one native-size candidate is
generated, accepted as requested, processed through the existing gates and added
to the canvas as a new canvas, with **Undo** for exactly that canvas. **Check
status** never generates again. A click is needed only for **Finish processing**
(a candidate restored after a reload; never continued on its own) and **Use this
original** (an original that older size rules rejected, decided from the preview).
Background-review and quality failures still stop before placement. There are no
separate Accept original / Add processed sheet steps. Each project keeps its own
subscription operation: a status, restore, acceptance, processing or placement
response for project A that arrives after B is opened never changes B, and A keeps
its recovery state. Following stops while A is not shown; reopening the dialog in A or
**Check status** continues it (nothing resumes on its own). A run that becomes ready
while another project is opening continues once that open ends. A restored sheet whose
canvas was removed later says so ("that canvas is no longer in this project") and adds
nothing again; an Undo whose history entry is gone (another project's history replaced
it) is no longer offered.

**Perfect pixels.** A result, its **Undo** and any recovery action are scrolled into
view in the properties column. When a later change withdraws that Undo, the panel
says nothing was reverted and that ⌘Z / Ctrl+Z steps back through changes in order.

The composer's output-size label is a read-only summary of the selected preset's
fixed size (currently `1:1 · 2K`); it is disabled because there is no size to choose.

**Runs, switches and restored work.** A run belongs to the project and the request that
started it. Stop, a manual job query or a project switch releases it, and a released run
is never continued: returning to the project only reads its job status again, with no
provider call. **Generate again** repeats only the request remembered for the current
project in this tab; after a reload it is not offered. Restoring a job, a discussion or a
model never previews, selects or refits anything; a sheet the project already holds is
shown as already added. **Apply it** on an earlier unapplied result applies exactly that
offered result, after the same dismissal and receipt checks.

**Job ID checks (`DIRECT-ACTIONS-20261021/r5`).** The Job ID form and `?job=<id>` first
read the local service's job record. The service keeps jobs only in memory, so after a
restart it answers "not found" even for a job whose files are saved; the page then looks
for those files. The outcomes stay distinct:

- **Job not found:** no job record and no saved files, for a Job ID not started in this
  browser (for example a typed one). Checking it generated and changed nothing; the
  remembered Job ID is forgotten and the form offers checking another ID. A missing job
  is never shown as a candidate with an action that cannot work.
- **Job cannot be finished:** files exist but are not a generated sheet waiting for
  acceptance (for example a processing job, or a failed or decided one). Nothing to
  finish; the remembered ID is forgotten.
- **Result not saved:** a job started in this browser that the service no longer holds
  and whose result was never saved (for example the service restarted during
  generation). It cannot be finished; its one generation call may already have been
  used, and nothing is retried. This page remembers the last 32 jobs it started (and,
  for a processing job, the generation job it finished) in browser storage.
- **Job not checked:** the service or the files did not answer (network failure, timeout,
  a server error, or a read cut off mid-transfer). The Job ID is kept, also across a
  project switch, and **Continue query** checks the same ID again.
- **Rebuilt from saved files:** a generated sheet waiting for acceptance is rebuilt from
  its saved generation record and sealed review (the same strict restore Studio uses).
  Its sealed request text is shown as the user's turn, and **Finish processing** is
  offered; nothing is generated again.
- **Lost during a run:** if the service stops holding a job while the page waits for it,
  the turn says so and keeps the generation Job ID in the form; **Continue query** checks
  whether its result was saved; nothing is generated again on its own. A lost processing
  job is checked the same way, through the generation job it was finishing. If this
  project already holds the processing job's sheet, a plain note says so and nothing is
  finished or added again. **Generate again** (a new provider call) appears beside these
  only when this tab remembers the request for this project, as on the other recovery
  cards.

When a page is opened with a Job ID, it checks that ID again once the project is bound,
using the Job ID shown at that moment. Since r6, a lost processing job checked before
the project is shown concludes nothing until the project is bound, so whether the project
already holds its sheet is known first; the generation job is never offered for a sheet
the project holds. Checked by hand while no project is open, it reads **Open a project
first** and keeps its Job ID; the check runs again once a project is open.

**Acceptance request (r5).** Finish processing, and the automatic acceptance in a
requested preset run, no longer read hashes from the job record (it has none). A job that
already has a publication (accepted here or in Studio) is replayed with exactly the
values that publication recorded (Studio's `replayStrictAcceptedPublication`), so a
Studio acceptance with reviewed issues is kept, not contradicted; the server checks them
against the publication, answers `already_accepted` and writes nothing. Otherwise the
page rebuilds the job and its sealed review from the saved artifacts, hashes the real
artifact bytes and checks the sealed plan and reference manifest through Studio's strict
acceptance helpers, then sends those values with `humanReviewedIssueCount: 0` and
`acceptanceBasis: "user_request"`. The server checks every value against its stored files
again and makes no provider call.

**Subscription sheet: accepted original deferred (r5, user decision C).** The formal
processing, placement and Undo check of the human-accepted subscription original stays
deferred: it is blocked by that record's own matte gate, and no new subscription or
provider call, substitute input, relaxed gate or matte-review workflow is authorized. The
original and its records are unchanged. Checks of the subscription flow with synthetic
inputs and a local fake provider are evidence for the flow only, not verification of
that original.

The retired text-only pixel proposal (`expected_working_revision` without pixel tools
or drawing) is not used by this page: a reply's legacy `pixel_edit` field is never
applied.

## Conversational pixel drawing (Codex)

Choose Codex and ask for pixel art, for example “Draw a 64×64 pixel forest guard”.
The supported grids are 32×32 and 64×64 (default 64×64). With an empty,
single-frame, single-layer 32/64 canvas selected, the drawing goes onto that canvas
in place unless a new canvas is asked for. To redraw a selected image, ask to use it
as a reference; only that saved image is sent as an inline PNG. Grok and Antigravity
do not support this drawing mode; there is no automatic provider fallback.

Codex returns strict drawing data, not an image-generation call or executable
code: at most 32 opaque/transparent RGBA palette entries and 512 bounded integer
rectangles within the chosen grid. Invalid, empty and unchanged results write nothing. File access,
image-generation tools and arbitrary image paths/URLs remain unavailable to this mode.

New and reference drawings are imported as an independent copy to the right, with a
16-pixel gap and collision avoidance; the source and position drafts stay unchanged.
Undo/Redo uses the normal history; reopening preserves saved results.

The message endpoint accepts optional `pixel_drawing: {size, kind, reference}`
(`kind` `new` or `edit`; a selected empty canvas is sent as `new` without reference).
Reference requests require the selected canvas and `expected_working_revision`.
Identity, revision, block hash and request fingerprint are checked before the model
call; drawing requests use a fresh restricted native thread, and the response alone
writes no pixels.

Unknown import or position-save acknowledgements stay recoverable through
`Resolve pixel drawing save`, even with an empty composer. Recovery reuses the
frozen write and never calls the model again. A changed project/open epoch,
provider or source invalidates a late result. Local controlled checks are not proof
of a successful live Codex drawing or human acceptance.

Local verification uses `npm run test:focused -- <test files>`, `npm test`, and
`npm run smoke:local` serially. Live account calls need their own authorized
budget. The legacy capture helper requires an explicit absolute
`VIS02_EVIDENCE_DIR`; it has no personal-directory fallback. Rendering or a
successful HTTP response does not prove a model reply or user acceptance.


### Native animation with no Skill selected

Choose Astra and an empty canvas, leave Skill unselected, and ask for an animated pixel drawing. Astra uses its document tools to create frames and durations, then paints distinct frames with native brushes. The app applies the result through the existing document candidate path with Undo. It does not invoke the character-sheet preset or another image provider. Imported originals remain protected by the existing editable-copy behavior.

`draw_frames` paints a bounded atomic batch targeting explicit frame/layer IDs. It reuses native pixel operations and the document candidate's locked-frame, locked-layer, link, revision and cancellation checks. Per-turn limits remain 9 tool calls/180 seconds, 128 KiB arguments, 16 MiB candidate pixels and 1024 pixels per edge. The player uses the resulting actual frames and durations; identical copies alone do not establish visible animation. A running local service is required for uncached frame blocks.

Assistant answers have no application-level character cap or cumulative model-output byte cap. Ordinary chat remains complete. Native process-tree memory/time protection, strict action schemas, tool budgets, connection-probe bounds and the existing 2 MiB conversation-record storage budget remain enforced; removing reply caps does not promise unlimited storage or model context. A storage failure remains an explicit failure, never a truncated successful answer.

Native document operation commentary stays internal. The app displays its own progress, actionable recovery errors and final `Canvas & timeline updated` status with the real Undo control. It does not display or offer expansion of the model's candidate narration, dimensions/frame/layer summary, or the redundant Undo explanation. Restoring discussion history keeps a neutral result note instead of resurfacing pre-save commentary. Ordinary conversational answers are unaffected.
