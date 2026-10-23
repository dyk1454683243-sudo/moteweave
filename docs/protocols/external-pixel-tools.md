# External pixel tools

Two entry paths share the GameTool native pixel kernel: the in-app Astra adapter,
and this provider-free external CLI. This CLI does not launch an AI, call Codex,
import an image, or save a project. An MCP wrapper is not installed or provided
by this revision; it can use the same local candidate service later.

Start the maintained GameTool server under the existing process-tree resource
guard, with a tracked session and finite lifetime. Use its explicit loopback
origin. Stop that exact server when finished. Do not expose it on a remote host.

Run `npm run pixel-tools -- --help` for the command format. Each invocation reads
one JSON object on stdin and exits. `--url http://127.0.0.1:PORT` is required;
`--image /absolute/new-preview.png` optionally writes the returned observation
PNG using exclusive creation (never overwrites). `--describe` includes schemas.
Normal output is compact JSON, not base64. No credentials are needed or read.

1. `create`: supply explicit `project_id`, `canvas_id`, `expected_revision`,
   `expected_working_revision`, and preferably a UUID `operation_id`. Obtain
   these IDs/revisions from the chosen project, not arbitrary filesystem paths.
   Keep the returned `session_id`.
2. `read_canvas`: supply `project_id`, `session_id`, and `operation_id`; use
   `--image` to inspect the current candidate.
3. `draw_pixels`: add `operations`, using the schemas returned by `--describe`.
   Available operations: pencil, eraser, line, rectangle, flood-fill, fill-rect,
   erase, replace-color. Every operation has a bounded `rect`; points must lie
   inside it. RGBA values are integers; alpha must be 0 or 255. No paths/PNG/RGBA
   replacement payloads or shell commands are accepted.
4. `undo_pixels` undoes one candidate batch; it does not replenish the budget.
5. `review` seals the candidate and returns `review_url`. Open it in a **new
   browser tab** to inspect the actual candidate in GameTool. Further drawing
   is rejected. The human chooses Save drawing or Discard preview. Save uses
   the existing editable-copy/in-place writer and Undo; the CLI cannot save.
6. `close` invalidates the candidate without saving. Server restart or the
   fixed 15-minute lifetime also invalidates it. Nothing is persisted as a
   project revision before human confirmation.

Limits: 64×64, one visible unlocked layer and frame, three drawing batches,
64 operations per batch, 256 points per operation, combined arguments at most
64 KiB, nine read/draw/undo calls, 24 sessions. Session commands are serialized;
overlap returns `pixel_tool_busy`. Within a live session and unchanged source,
reusing an operation UUID with identical payload replays its result without
drawing twice; changing its payload returns `pixel_tool_operation_conflict`.
After close or expiry the session is unavailable, including old receipts.
Post-request errors retain the operation UUID; do not automatically retry
network failures or create a fresh drawing operation to recover a preview file.

Local API: POST `/api/editor/projects/:projectId/pixel-tools` creates a session
with `{operation_id,canvas_id,expected_revision,expected_working_revision}`.
POST `.../:sessionId` accepts `{operation_id,tool,arguments}`. GET `.../:sessionId`
reads a sealed review with frozen context and the server-produced candidate.
All routes use the existing loopback/Host/Origin checks and bounded JSON bodies.
Every operation and review verifies the original project/document revision.
Close, expiry, stale context and unsupported targets return explicit errors.
There is no migration, new persistent project field, model provider, accepted
asset, arbitrary file access, automatic apply, or MCP registration in this API.

## Validation status — 2026-10-05

- Local verification: 1,751 tests and the local smoke gate passed. The real
  CLI/server/browser check passed seven groups covering preview, discard,
  confirmed save, Undo, stale/closed sessions, late responses, and origin checks.
- A separate reference-free 64×64, five-color flame was drawn using the CLI's
  native pencil/flood-fill/fill-rect operations. The preview was not saved into
  the project; no external image-generation service was used.
- These results do not establish the in-app Astra adapter as live-verified:
  its one authorized real task failed with `assistant_tool_blocked`, produced
  no candidate, and was not retried. The exact blocked event remains unknown.
- Runtime screenshots were inspected, but the matching Figma render could not
  be inspected. Design parity and remaining human UI acceptance stay pending.
  This feature-branch checkpoint is not a claim of production readiness.
