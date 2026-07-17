# Targeted Frame Repair v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an honest, one-frame, rectangle-mask-constrained AI repair flow inside the existing Character Finishing Workbench, with one-call accounting, exact decoded-pixel integrity, real validation, and specialized immutable acceptance.

**Architecture:** A browser-safe mask/plan contract is shared by the Workbench and the Editor server. The server re-resolves managed authority, snapshots one exact provider preset, records the operation durably outside public static artifacts, generates one candidate, composites only the canonical mask, packages the exact patched normalized sheet without reprocessing it, and accepts only sealed evidence under the existing project mutation lock. Existing Workbench modules receive thin integration hooks while new frame-repair state, lifecycle, controller, Canvas, and rail modules own the feature.

**Tech Stack:** Node.js ESM, `node:test`, Sharp, Canvas 2D, existing provider adapters, existing Character Pack validators/exporters/artifact builders, local Editor Workspace APIs, guarded npm test/smoke scripts.

---

## Approved Source, Baseline, And Scope

- Normative design: `docs/superpowers/specs/2026-07-11-targeted-frame-repair-v1-design.md`.
- Approved design commit: `1bb606e`.
- Execution starts from `main` after `1bb606e`; accepted Workbench ancestors `36eefaf`, `58176ce`, `89cf7b2`, `17d23f3`, and `ae5b69b` are all ancestors.
- Local visual evidence remains unstaged under `.superpowers/brainstorm/4735-1783751584/content/`.
- The roadmap item is Candidate #33, explicitly selected for this Editor Workspace block.
- Existing `/`, Action Repair, Character Reprocess, provider adapters, validator, exporters, job-status enum, and project format remain available and behavior-compatible.
- No new dependency, provider family, freehand tool, multiple-candidate mode, automatic retry, project migration, or external asset is authorized.

### Recorded implementation clarifications

The design originally used the phrase “generated-data root” for the durable operation ledger. `server.js` serves `/generated/*` directly, so implementation must instead use `workspace/.operations/frame-repair/`. This is a security-preserving storage clarification, not a UI or capability change: ledger records remain server-only, outside project JSON and outside the registered artifact route.

The Context must bind a sealed artifact manifest but cannot include its own hash without a circular dependency. The writer therefore seals all other required files in an inner manifest stored in Context, then seals Context in an outer public job manifest whose digest is stored in the private ledger. Acceptance verifies both levels. This is an explicit implementation of the approved cross-binding requirement, not a relaxation of it.

### Design-to-implementation obligations

| Approved surface | Required implementation truth |
| --- | --- |
| Existing large Canvas and filmstrip | Reuse them; do not create a competing workspace. |
| Right Recipe rail switches to Frame Repair | Hide but preserve the Recipe DOM/state, mount one four-stage rail, and restore Recipe exactly on exit. |
| Four stages | `Target & Mask`, `Review AI Call`, `Processing`, `Result & Validation`; future stages are visible progress only, never active early. |
| Mask tools | Rectangle Add/Remove, selected-rectangle numeric controls, Delete, local Undo; no brush, lasso, eraser, or pixel pencil. |
| Call truth | Provider-free Plan; one explicit confirmation; exactly one candidate; no fallback or automatic retry. |
| Result review | Existing Before/After/Split/Difference/Onion modes, repaired-frame badge, repaired-clip playback, real integrity and quality evidence. |
| Responsive behavior | Existing rail becomes the existing modal drawer at narrow widths; no second mobile navigation system. |
| Capability gaps | Semantic diagnosis remains unclaimed; provider-unavailable and unknown-quality states disable generation/acceptance with real reasons. |

## File Structure

### New core/server files

| File | Responsibility |
| --- | --- |
| `src/editor-project/frameRepairProtocol.js` | Exact request envelopes, controlled errors, field limits, operation-id validation. |
| `src/editor-project/frameRepairMask.js` | Browser-safe deterministic diagnostic mask, ordered rectangle edits, canonical runs. |
| `src/editor-project/frameRepairPlan.js` | Server canonical plan, stable serialization, SHA-256 binding, clip-position validation. |
| `src/editor-project/frameRepairProvider.js` | Exact preset resolution, safe prompt/reference payload, one adapter request with no fallback. |
| `src/editor-project/frameRepairComposite.js` | Bounded provider decode, subject fit, fixed local finishing, mask-only composite, RGBA integrity report. |
| `src/editor-project/normalizedCharacterSheetPackage.js` | Build the standard Character Pack result from an already-normalized patched sheet without calling the normalizer pipeline. |
| `src/editor-project/frameRepairArtifacts.js` | Exclusive artifact writing, fixed artifact registry, safe public URLs, sealed manifest verification. |
| `src/editor-project/frameRepairOperationLedger.js` | Private durable operation reservation/transitions/recovery outside `/generated`. |
| `src/editor-project/frameRepairService.js` | Shared-queue job execution and exact one-call lifecycle. |
| `src/editor-project/frameRepairCoordinator.js` | Managed authority, Plan/live/recovery/Accept orchestration and mutation-lock checks. |

### New browser files

| File | Responsibility |
| --- | --- |
| `src/ui/editor/frameRepairState.js` | Complete UI state matrix, draft factory, action availability, warning identity. |
| `src/ui/editor/frameRepairLifecycle.js` | Plan/live/poll/recovery/accept tokens, aborts, timers, session recovery handle. |
| `src/ui/editor/frameRepairCanvas.js` | Mask bitmap/rectangle overlays and pointer-to-frame coordinate conversion outside RAF. |
| `src/ui/editor/frameRepairController.js` | Workbench-context adapter, provisional mask, plan invalidation, result hydration and exact acceptance. |
| `src/ui/editor/frameRepairPanel.js` | Four-stage right rail, controls, diagnostics, accessible focus/state behavior. |

### Existing files with thin, explicit changes

| File | Change |
| --- | --- |
| `src/editor-project/index.js` | Export new browser-safe/core boundaries. |
| `src/editor-project/artifactRegistry.js` | Reject general import for the new job type and import one verified frame-repair child with `processing_recipe_ref: null`. |
| `src/editor-project/apiHandler.js` | Four thin `/api/editor/.../frame-repair` routes and controlled status mapping. |
| `server.js` | Construct one service/coordinator using the existing queue and adapters; pass them into the Editor handler. |
| `src/ui/editor/api.js` | Typed Frame Repair Plan/live/recovery/Accept calls plus safe provider-state GET. |
| `src/ui/editor/state.js` | Add one independent ephemeral `repair.frame` state factory. |
| `src/ui/editor/repairWorkbenchController.js` | Delegate frame-repair entry/exit/view decoration; do not absorb feature logic. |
| `src/ui/editor/repairWorkbenchPanel.js` | Mount the new rail, route Canvas pointer events, add Repair Frame entry and filmstrip badge. |
| `src/ui/editor/shell.js` | Construct/wire controller and reset/teardown it with existing Repair lifecycle. |
| `src/ui/editor/editor.css` | Approved desktop rail, four-stage UI, mask state, badge, drawer, overflow, focus, reduced-motion rules. |
| `scripts/smoke-local-ui.mjs` | Assert real Frame Repair module/API/UI markers without making a live provider call. |
| `docs/protocols/local-api-boundaries.md` | Record the four routes, call budget, durable recovery, specialized Accept. |
| `docs/roadmap/technology-reference-roadmap.md` | Mark deterministic MVP status only after verification; keep broad live-quality claims gated. |

### New focused tests

`test/editor-project/editorFrameRepairProtocol.test.js`, `editorFrameRepairMask.test.js`, `editorFrameRepairPlan.test.js`, `editorFrameRepairProvider.test.js`, `editorFrameRepairComposite.test.js`, `editorNormalizedCharacterSheetPackage.test.js`, `editorFrameRepairArtifacts.test.js`, `editorFrameRepairOperationLedger.test.js`, `editorFrameRepairService.test.js`, `editorFrameRepairCoordinator.test.js`, `editorFrameRepairApi.test.js`, `editorFrameRepairServerWiring.test.js`, `editorFrameRepairState.test.js`, `editorFrameRepairLifecycle.test.js`, `editorFrameRepairCanvas.test.js`, `editorFrameRepairController.test.js`, and `editorFrameRepairPanel.test.js`.

## Execution Safety

- At execution time, create a clean isolated worktree/branch with `superpowers:using-git-worktrees`; suggested branch: `codex/targeted-frame-repair-v1`.
- Do not stage, edit, move, scan, or delete the unrelated `.superpowers/` directory or duplicate `* 2.js` / `* 2.md` files present on the source checkout.
- Only the primary agent or designated test owner runs tests, smoke, servers, or browser verification. Never overlap them.
- Use only `npm run test:focused -- ...`, `npm test`, and `npm run smoke:local`; never raw `node --test` or an unguarded browser/server command.
- Treat Tasks 1–2, 3–5, 6–10, and 11–13 as four verification sections. Run the full guarded suite at the end of Tasks 2, 5, 10, and 13.
- Real provider calls are forbidden throughout Tasks 1–14. Tests inject a deterministic provider. The post-MVP benchmark requires a separate explicit user authorization and call budget.
- Do not modify `src/character-pack/processSheet.js`, provider adapters, validator, exporters, job-state enum, or package dependencies. New modules may import their existing public functions.

---

### Task 1: Exact Request And Protocol Contract

**Files:**
- Create: `docs/protocols/editor-frame-repair-v1.md`
- Create: `src/editor-project/frameRepairProtocol.js`
- Modify: `src/editor-project/index.js`
- Test: `test/editor-project/editorFrameRepairProtocol.test.js`

- [ ] **Step 1: Write the failing exact-envelope tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertFrameRepairAcceptRequest,
  assertFrameRepairLiveRequest,
  assertFrameRepairPlanRequest,
} from '../../src/editor-project/frameRepairProtocol.js'

const planRequest = {
  expectedRevision: 4,
  expectedAssetRevisionId: 'rev_003',
  clipId: 'walk_down',
  clipFramePosition: 1,
  sheetFrameIndex: 17,
  instruction: 'repair the left hand',
  maskEdits: [{ op: 'add_rectangle', x: 10, y: 12, width: 8, height: 9 }],
  providerPresetId: 'gemini-default',
  imageConfig: { image_size: '1K' },
}

test('Frame Repair request validators accept only the approved exact fields', () => {
  assert.deepEqual(assertFrameRepairPlanRequest(planRequest), planRequest)
  assert.deepEqual(assertFrameRepairLiveRequest({
    ...planRequest,
    operationId: 'fr_0123456789abcdef',
    expectedPlanHash: 'a'.repeat(64),
    confirmLiveGeneration: true,
    maxProviderCalls: 1,
  }).operationId, 'fr_0123456789abcdef')
  assert.deepEqual(assertFrameRepairAcceptRequest({
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    expectedPlanHash: 'a'.repeat(64),
    warningConfirmed: false,
  }).warningConfirmed, false)
})

test('Frame Repair rejects aliases, extra fields, secrets, base64, invalid rectangles and budgets', () => {
  for (const request of [
    { ...planRequest, expected_revision: 4 },
    { ...planRequest, apiKey: 'secret-value' },
    { ...planRequest, instruction: 'data:image/png;base64,AAAA' },
    { ...planRequest, maskEdits: [{ op: 'add_rectangle', x: -1, y: 0, width: 1, height: 1 }] },
    { ...planRequest, maskEdits: Array.from({ length: 65 }, () => ({ op: 'add_rectangle', x: 0, y: 0, width: 1, height: 1 })) },
  ]) assert.throws(() => assertFrameRepairPlanRequest(request))
  assert.throws(() => assertFrameRepairLiveRequest({
    ...planRequest,
    operationId: '../escape',
    expectedPlanHash: 'a'.repeat(64),
    confirmLiveGeneration: true,
    maxProviderCalls: 1,
  }))
  assert.throws(() => assertFrameRepairLiveRequest({
    ...planRequest,
    operationId: 'fr_0123456789abcdef',
    expectedPlanHash: 'a'.repeat(64),
    confirmLiveGeneration: true,
    maxProviderCalls: 2,
  }))
})
```

- [ ] **Step 2: Run the focused test and verify it fails before implementation**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairProtocol.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `frameRepairProtocol.js`.

- [ ] **Step 3: Implement the exact validators and controlled error type**

```js
import {
  clonePlain,
  findBase64PayloadPaths,
  findSecretLikePaths,
  isPlainObject,
  isValidId,
} from './safety.js'

const HASH = /^[a-f0-9]{64}$/
const OPERATION_ID = /^[A-Za-z0-9_-]{16,80}$/
const PLAN_KEYS = Object.freeze([
  'expectedRevision', 'expectedAssetRevisionId', 'clipId',
  'clipFramePosition', 'sheetFrameIndex', 'instruction', 'maskEdits',
  'providerPresetId', 'imageConfig',
])

export class FrameRepairError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'FrameRepairError'
    this.code = code
    this.details = details
  }
}

function exact(value, keys, code = 'invalid_frame_repair_request') {
  if (!isPlainObject(value)) throw new FrameRepairError(code, 'expected a plain JSON object')
  const extra = Object.keys(value).filter((key) => !keys.includes(key))
  if (extra.length) throw new FrameRepairError('unexpected_request_field', 'request contains unsupported fields', { fields: extra })
}

function assertSafeJson(value) {
  if (findBase64PayloadPaths(value).length || findSecretLikePaths(value).length) {
    throw new FrameRepairError('invalid_frame_repair_request', 'binary and secret-like values are forbidden')
  }
}

function validInstruction(value) {
  return typeof value === 'string' && value.trim().length > 0 &&
    [...value.normalize('NFC').trim()].length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
}

function validMaskEdit(edit) {
  if (!isPlainObject(edit)) return false
  exact(edit, ['op', 'x', 'y', 'width', 'height'])
  return ['add_rectangle', 'remove_rectangle'].includes(edit.op) &&
    Number.isInteger(edit.x) && edit.x >= 0 &&
    Number.isInteger(edit.y) && edit.y >= 0 &&
    Number.isInteger(edit.width) && edit.width >= 1 &&
    Number.isInteger(edit.height) && edit.height >= 1
}

export function assertFrameRepairPlanRequest(body) {
  exact(body, PLAN_KEYS)
  assertSafeJson(body)
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      !isValidId(body.expectedAssetRevisionId) || !isValidId(body.clipId) ||
      !Number.isInteger(body.clipFramePosition) || body.clipFramePosition < 0 ||
      !Number.isInteger(body.sheetFrameIndex) || body.sheetFrameIndex < 0 ||
      !validInstruction(body.instruction) || !Array.isArray(body.maskEdits) ||
      body.maskEdits.length > 64 || !body.maskEdits.every(validMaskEdit) ||
      !isValidId(body.providerPresetId) || !isPlainObject(body.imageConfig)) {
    throw new FrameRepairError('invalid_frame_repair_request', 'Frame Repair plan fields are invalid')
  }
  exact(body.imageConfig, ['image_size'])
  if (!['1K', '2K'].includes(body.imageConfig.image_size)) {
    throw new FrameRepairError('invalid_frame_repair_request', 'image_size must be 1K or 2K')
  }
  return clonePlain({ ...body, instruction: body.instruction.normalize('NFC').trim() })
}

export function assertFrameRepairLiveRequest(body) {
  exact(body, [...PLAN_KEYS, 'operationId', 'expectedPlanHash', 'confirmLiveGeneration', 'maxProviderCalls'])
  const plan = assertFrameRepairPlanRequest(Object.fromEntries(PLAN_KEYS.map((key) => [key, body[key]])))
  if (!OPERATION_ID.test(body.operationId) || !HASH.test(body.expectedPlanHash) ||
      body.confirmLiveGeneration !== true || body.maxProviderCalls !== 1) {
    throw new FrameRepairError('invalid_frame_repair_request', 'live confirmation fields are invalid')
  }
  return { ...plan, operationId: body.operationId, expectedPlanHash: body.expectedPlanHash, confirmLiveGeneration: true, maxProviderCalls: 1 }
}

export function assertFrameRepairAcceptRequest(body) {
  exact(body, ['expectedRevision', 'expectedAssetRevisionId', 'expectedPlanHash', 'warningConfirmed'], 'invalid_accept_request')
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      !isValidId(body.expectedAssetRevisionId) || !HASH.test(body.expectedPlanHash) ||
      typeof body.warningConfirmed !== 'boolean') {
    throw new FrameRepairError('invalid_accept_request', 'Frame Repair Accept fields are invalid')
  }
  return clonePlain(body)
}

export function isFrameRepairOperationId(value) {
  return typeof value === 'string' && OPERATION_ID.test(value)
}
```

Add `export * from './frameRepairProtocol.js'` to `src/editor-project/index.js`.

Write `docs/protocols/editor-frame-repair-v1.md` with the exact three request bodies, the operation lookup route, canonical mask/plan schemas, all seven public job statuses inherited unchanged from `JOB_STATUS`, fixed artifact filenames, error/status mapping, call-accounting rule, and the explicit statement that the ledger is server-private and not part of `editor_project_v0`.

- [ ] **Step 4: Run focused tests and static checks**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairProtocol.test.js`

Expected: PASS, no provider call, peak RSS below the focused 1536 MiB limit.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Commit the contract unit**

```bash
git status --short
git add docs/protocols/editor-frame-repair-v1.md src/editor-project/frameRepairProtocol.js src/editor-project/index.js test/editor-project/editorFrameRepairProtocol.test.js
git commit -m "feat: add frame repair request contract"
```

### Task 2: Deterministic Mask And Canonical Plan

**Files:**
- Create: `src/editor-project/frameRepairMask.js`
- Create: `src/editor-project/frameRepairPlan.js`
- Modify: `src/editor-project/index.js`
- Test: `test/editor-project/editorFrameRepairMask.test.js`
- Test: `test/editor-project/editorFrameRepairPlan.test.js`

- [ ] **Step 1: Write failing mask and plan golden-vector tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyFrameRepairMaskEdits,
  deriveFrameRepairBaseMask,
  maskBitsToRuns,
} from '../../src/editor-project/frameRepairMask.js'
import {
  createCanonicalFrameRepairPlan,
  hashFrameRepairPlan,
  serializeFrameRepairPlan,
} from '../../src/editor-project/frameRepairPlan.js'

function frame(width = 6, height = 6) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

test('diagnostic mask localizes fringe pixels and ordered rectangle edits are canonical', () => {
  const image = frame()
  const offset = (2 * image.width + 2) * 4
  image.data.set([248, 248, 248, 120], offset)
  const base = deriveFrameRepairBaseMask(image)
  assert.equal(base.mode, 'localized_diagnostic')
  const edited = applyFrameRepairMaskEdits(base.bits, image.width, image.height, [
    { op: 'add_rectangle', x: 1, y: 1, width: 3, height: 3 },
    { op: 'remove_rectangle', x: 1, y: 1, width: 1, height: 1 },
  ])
  assert.deepEqual(maskBitsToRuns(edited), [
    { start: 8, length: 2 },
    { start: 13, length: 3 },
    { start: 19, length: 3 },
  ])
})

test('plan binds exact repeated clip position and stable key-sorted bytes', () => {
  const input = {
    request: {
      expectedRevision: 4,
      expectedAssetRevisionId: 'rev_003',
      clipId: 'walk_down',
      clipFramePosition: 2,
      sheetFrameIndex: 17,
      instruction: 'repair hand',
      maskEdits: [],
      providerPresetId: 'gemini-default',
      imageConfig: { image_size: '1K' },
    },
    authority: {
      projectId: 'project_demo', projectRevision: 4,
      assetId: 'asset_hero', parentRevisionId: 'rev_003',
      profileId: 'topdown_rpg_v0', frameSize: { w: 96, h: 96 },
      clipFrames: [16, 17, 17, 18], parentSheetSha256: '1'.repeat(64),
      targetFrameSha256: '2'.repeat(64), contextFrames: [
        { position: 1, sheet_frame_index: 17, sha256: '3'.repeat(64) },
        { position: 3, sheet_frame_index: 18, sha256: '4'.repeat(64) },
      ],
      referenceContextSha256: '6'.repeat(64),
      referenceImages: [
        { role: 'target_enlarged', name: 'target.png', sha256: '7'.repeat(64) },
        { role: 'mask_visualization', name: 'mask.png', sha256: '8'.repeat(64) },
        { role: 'clip_context', name: 'clip_context.png', sha256: '9'.repeat(64) },
        { role: 'full_sheet', name: 'normalized_sheet.png', sha256: 'a'.repeat(64) },
      ],
    },
    mask: { width: 96, height: 96, source: 'user_scoped', confidence: 'user_confirmed', runs: [{ start: 0, length: 1 }], activePixelCount: 1, sha256: '5'.repeat(64) },
    provider: { id: 'gemini-default', provider: 'gemini', label: 'Gemini default', model: 'model-a', available: true, image_config: { image_size: '1K', aspect_ratio: '1:1' } },
    implementationRevision: 'package-0.4.0',
  }
  const first = createCanonicalFrameRepairPlan(input)
  const second = createCanonicalFrameRepairPlan({ ...input, authority: { ...input.authority } })
  assert.deepEqual(serializeFrameRepairPlan(first.plan), serializeFrameRepairPlan(second.plan))
  assert.equal(hashFrameRepairPlan(first.plan), first.plan_hash)
  assert.equal(first.plan.clip.position, 2)
  assert.equal(first.can_run, true)
  assert.throws(() => createCanonicalFrameRepairPlan({
    ...input,
    request: { ...input.request, clipFramePosition: 1 },
  }), (error) => error?.code === 'frame_identity_mismatch')
})
```

- [ ] **Step 2: Run both tests and verify the missing modules fail**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairMask.test.js test/editor-project/editorFrameRepairPlan.test.js`

Expected: FAIL with missing `frameRepairMask.js` or `frameRepairPlan.js`.

- [ ] **Step 3: Implement the browser-safe mask contract**

```js
function indexFor(width, x, y) { return y * width + x }

function transparentNeighbor(image, x, y) {
  return [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => {
    const nx = x + dx
    const ny = y + dy
    return nx < 0 || ny < 0 || nx >= image.width || ny >= image.height ||
      image.data[indexFor(image.width, nx, ny) * 4 + 3] === 0
  })
}

function dilate(bits, width, height) {
  const out = new Uint8Array(bits)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!bits[indexFor(width, x, y)]) continue
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) out[indexFor(width, nx, ny)] = 1
    }
  }
  return out
}

export function deriveFrameRepairBaseMask(image) {
  if (!Number.isInteger(image?.width) || !Number.isInteger(image?.height) ||
      !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new TypeError('frame RGBA input is invalid')
  }
  const bits = new Uint8Array(image.width * image.height)
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const offset = indexFor(image.width, x, y) * 4
    const alpha = image.data[offset + 3]
    const nearWhite = image.data[offset] >= 240 && image.data[offset + 1] >= 240 && image.data[offset + 2] >= 240
    if (alpha > 0 && transparentNeighbor(image, x, y) && (alpha < 255 || nearWhite)) bits[indexFor(image.width, x, y)] = 1
  }
  const expanded = dilate(bits, image.width, image.height)
  const activePixelCount = expanded.reduce((sum, value) => sum + value, 0)
  return {
    mode: activePixelCount ? 'localized_diagnostic' : 'needs_scope',
    bits: expanded,
    activePixelCount,
  }
}

export function applyFrameRepairMaskEdits(baseBits, width, height, edits) {
  const out = new Uint8Array(baseBits)
  for (const edit of edits) {
    if (edit.x + edit.width > width || edit.y + edit.height > height) {
      const error = new RangeError('mask rectangle is outside the frame')
      error.code = 'invalid_frame_repair_mask'
      throw error
    }
    const value = edit.op === 'add_rectangle' ? 1 : 0
    for (let y = edit.y; y < edit.y + edit.height; y += 1) for (let x = edit.x; x < edit.x + edit.width; x += 1) {
      out[indexFor(width, x, y)] = value
    }
  }
  return out
}

export function maskBitsToRuns(bits) {
  const runs = []
  for (let index = 0; index < bits.length;) {
    if (!bits[index]) { index += 1; continue }
    const start = index
    while (index < bits.length && bits[index]) index += 1
    runs.push({ start, length: index - start })
  }
  return runs
}
```

Add deterministic connected-component localization for detached components before dilation. Only components smaller than the largest and at least two pixels are included; the largest subject component is never masked merely for existing. Add a display-only subject-bbox suggestion for `needs_scope`, but keep its bits empty.

- [ ] **Step 4: Implement canonical plan serialization and hashing**

```js
import { createHash } from 'node:crypto'
import { FrameRepairError } from './frameRepairProtocol.js'

function sortPlain(value) {
  if (Array.isArray(value)) return value.map(sortPlain)
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortPlain(value[key])]))
}

export function serializeFrameRepairPlan(plan) {
  return Buffer.from(JSON.stringify(sortPlain(plan)), 'utf8')
}

export function hashFrameRepairPlan(plan) {
  return createHash('sha256').update(serializeFrameRepairPlan(plan)).digest('hex')
}

export function createCanonicalFrameRepairPlan({ request, authority, mask, provider, implementationRevision }) {
  if (authority.clipFrames[request.clipFramePosition] !== request.sheetFrameIndex) {
    throw new FrameRepairError('frame_identity_mismatch', 'clip position does not resolve to the submitted sheet frame')
  }
  const plan = {
    version: 'frame_repair_plan_v1',
    project: { id: authority.projectId, revision: authority.projectRevision },
    asset: { id: authority.assetId, parent_revision_id: authority.parentRevisionId },
    profile: { id: authority.profileId, frame_size: authority.frameSize },
    clip: {
      id: request.clipId,
      frames: [...authority.clipFrames],
      position: request.clipFramePosition,
      sheet_frame_index: request.sheetFrameIndex,
      context_frames: authority.contextFrames.map((item) => ({ ...item })),
    },
    parent_sheet_sha256: authority.parentSheetSha256,
    target_frame_sha256: authority.targetFrameSha256,
    references: {
      input_reference_roles: authority.referenceImages.map((item) => item.role),
      context_sha256: authority.referenceContextSha256,
      items: authority.referenceImages.map(({ role, name, sha256 }) => ({ role, name, sha256 })),
    },
    mask: structuredClone(mask),
    instruction: request.instruction.normalize('NFC').trim(),
    provider: {
      id: provider.id,
      provider: provider.provider,
      label: provider.label,
      model: provider.model,
      image_config: structuredClone(provider.image_config),
    },
    estimated_provider_calls: 1,
    max_provider_calls: 1,
    implementation_revision: implementationRevision,
  }
  const plan_hash = hashFrameRepairPlan(plan)
  return {
    plan,
    plan_hash,
    can_run: mask.activePixelCount > 0 && provider.available === true,
    diagnostics: [
      ...(mask.activePixelCount ? [] : ['invalid_mask']),
      ...(provider.available === true ? [] : ['provider_unavailable']),
    ],
  }
}
```

The server-side mask builder computes `mask.sha256` from `width`, `height`, and canonical runs using the same stable serializer. Source/confidence labels follow the approved deterministic rules exactly. The reference-context digest uses the same stable serializer over ordered role/name/image-digest records; no image bytes or private paths enter the public Plan.

- [ ] **Step 5: Run focused and full Section 1 verification**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairProtocol.test.js test/editor-project/editorFrameRepairMask.test.js test/editor-project/editorFrameRepairPlan.test.js`

Expected: all PASS, including deterministic mask/Plan golden vectors and repeated clip-position binding.

Run: `npm test`

Expected: complete guarded suite PASS; no process-tree RSS above 4096 MiB and no timeout.

- [ ] **Step 6: Commit canonical mask/plan**

```bash
git status --short
git add src/editor-project/frameRepairMask.js src/editor-project/frameRepairPlan.js src/editor-project/index.js test/editor-project/editorFrameRepairMask.test.js test/editor-project/editorFrameRepairPlan.test.js
git commit -m "feat: add canonical frame repair masks and plans"
```

### Task 3: Exact Provider Preset And Mask-Only Composite

**Files:**
- Create: `src/editor-project/frameRepairProvider.js`
- Create: `src/editor-project/frameRepairComposite.js`
- Modify: `src/editor-project/index.js`
- Test: `test/editor-project/editorFrameRepairProvider.test.js`
- Test: `test/editor-project/editorFrameRepairComposite.test.js`

- [ ] **Step 1: Write failing provider and pixel-integrity tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFrameRepairPrompt,
  requestFrameRepairCandidate,
  resolveExactFrameRepairProvider,
} from '../../src/editor-project/frameRepairProvider.js'
import {
  buildFrameRepairQualityReport,
  compositeFrameRepairCandidate,
} from '../../src/editor-project/frameRepairComposite.js'

test('exact provider selection never falls back and makes one request', async () => {
  const env = {
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      { id: 'first', provider: 'gemini', apiKey: 'key-a', model: 'model-a' },
      { id: 'second', provider: 'openrouter', apiKey: 'key-b', model: 'model-b' },
    ]),
  }
  assert.equal(resolveExactFrameRepairProvider(env, 'second').id, 'second')
  assert.throws(() => resolveExactFrameRepairProvider(env, 'missing'), (error) => error?.code === 'provider_unavailable')
  let calls = 0
  const result = await requestFrameRepairCandidate({
    providerPreset: resolveExactFrameRepairProvider(env, 'second'),
    plan: { instruction: 'repair hand', provider: { image_config: { image_size: '1K', aspect_ratio: '1:1' } } },
    referenceImages: [{ name: 'target.png', mimeType: 'image/png', buffer: Buffer.from('target') }],
    requestByProvider: {
      openrouter: async () => { calls += 1; return { buffer: Buffer.from('candidate'), prompt: 'provider-controlled text' } },
      gemini: async () => { throw new Error('wrong adapter') },
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.provider_preset_id, 'second')
  assert.equal(result.prompt, buildFrameRepairPrompt({ instruction: 'repair hand' }))
})

test('mask composite preserves every non-target and target-outside-mask RGBA byte', () => {
  const width = 4
  const height = 2
  const parent = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(10) }
  const candidate = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200) }
  const result = compositeFrameRepairCandidate({
    parentSheet: parent,
    candidateFrame: candidate,
    sheetFrameIndex: 1,
    frameSize: { w: 2, h: 2 },
    mask: { width: 2, height: 2, runs: [{ start: 1, length: 1 }] },
  })
  assert.equal(result.sheet.data[4], 10)
  assert.equal(result.sheet.data[12], 200)
  assert.equal(result.integrity.non_target_equal, true)
  assert.equal(result.integrity.target_outside_mask_equal, true)
  assert.equal(result.integrity.changed_inside_mask, 1)
})

test('quality policy gives integrity failure precedence and preserves honest warning/unknown states', () => {
  const base = frameRepairQualityEvidenceFixture()
  assert.equal(buildFrameRepairQualityReport(base).status, 'pass')
  assert.equal(buildFrameRepairQualityReport({ ...base, integrity: { ...base.integrity, actual_outside_mask_changed: 1 } }).status, 'fail')
  assert.equal(buildFrameRepairQualityReport({ ...base, validation: { ...base.validation, status: 'warning' } }).status, 'warning')
  assert.equal(buildFrameRepairQualityReport({ ...base, integrity: { ...base.integrity, changed_inside_mask: 0 } }).status, 'warning')
  assert.equal(buildFrameRepairQualityReport({ ...base, complete: false }).status, 'unknown')
})
```

Define `frameRepairQualityEvidenceFixture()` immediately above the policy test with complete passing bbox/anchor/baseline, integrity, halo/alpha/component, continuity, and validator fields; do not mock the final status itself.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairProvider.test.js test/editor-project/editorFrameRepairComposite.test.js`

Expected: FAIL with missing module exports.

- [ ] **Step 3: Implement exact preset resolution and one adapter dispatch**

```js
import { getProviderPresets } from '../character-pack/providers/providerConfig.js'
import { requestGeminiPromptImage } from '../character-pack/providers/geminiAdapter.js'
import { requestOpenRouterPromptImage } from '../character-pack/providers/openRouterAdapter.js'
import { FrameRepairError } from './frameRepairProtocol.js'

export function resolveExactFrameRepairProvider(env, presetId) {
  let presets
  try {
    presets = getProviderPresets(env)
  } catch {
    throw new FrameRepairError('provider_configuration_error', 'provider preset configuration is invalid')
  }
  const preset = presets.find((item) => item.id === presetId)
  if (!preset) throw new FrameRepairError('provider_unavailable', 'selected provider preset does not exist')
  return preset
}

export function buildFrameRepairPrompt(plan) {
  return [
    'Repair one isolated transparent pixel-art character frame.',
    `Instruction: ${plan.instruction}`,
    'Preserve the same character identity, action, facing, scale, palette, outline weight, lighting, and pixel density shown in the references.',
    'Return one character frame only: no sheet, grid, contact sheet, scene, text, border, watermark, duplicated anatomy, motion trail, or prop unless the instruction explicitly requires it.',
    'Local code will apply only the approved mask; do not rely on changing pixels outside it.',
  ].join('\n')
}

export async function requestFrameRepairCandidate({
  providerPreset,
  plan,
  referenceImages,
  fetchImpl = globalThis.fetch,
  requestByProvider = {
    gemini: requestGeminiPromptImage,
    openrouter: requestOpenRouterPromptImage,
  },
}) {
  if (!providerPreset?.available || !providerPreset.apiKey) {
    throw new FrameRepairError('provider_unavailable', 'selected provider runtime is unavailable')
  }
  const request = requestByProvider[providerPreset.provider]
  if (typeof request !== 'function') throw new FrameRepairError('provider_unavailable', 'selected provider adapter is unavailable')
  const prompt = buildFrameRepairPrompt(plan)
  const generated = await request({
    providerPreset,
    apiKey: providerPreset.apiKey,
    prompt,
    imageConfig: plan.provider.image_config,
    images: referenceImages,
    fetchImpl,
  })
  if (!Buffer.isBuffer(generated?.buffer) || generated.buffer.length === 0 || generated.buffer.length > 32 * 1024 * 1024) {
    throw new FrameRepairError('provider_output_invalid', 'provider returned an invalid image payload')
  }
  return {
    provider: providerPreset.provider,
    provider_preset_id: providerPreset.id,
    provider_label: providerPreset.label,
    model: providerPreset.model,
    image_config: structuredClone(plan.provider.image_config),
    prompt,
    buffer: Buffer.from(generated.buffer),
  }
}
```

The prompt is project-owned wording. Do not import or transcribe any external prompt/template.

- [ ] **Step 4: Implement bounded candidate normalization and exact composite**

`frameRepairComposite.js` must:

1. require a non-empty provider Buffer no larger than 32 MiB before image inspection; use Sharp metadata before raw decode; allow one-page raster PNG, JPEG, or WebP only; reject SVG, animated/multi-page input, unknown dimensions, width/height above 2048, or pixel count above 4,194,304; decode once and re-encode the decoded RGBA as the actual PNG stored under `raw_provider_output.png`;
2. use existing `removeBackground`, `detectAlphaBBox`, nearest-neighbor resize, `extractPalette`/`snapToPalette`, alpha cleanup, and component cleanup;
3. fit one candidate subject uniformly to the parent target bbox and align its detected foot anchor to the parent anchor;
4. reject empty output, a full-sheet-sized grid response, or more than one significant subject component;
5. composite only mask bits into a cloned parent sheet;
6. compare decoded bytes after composite and return the approved integrity counters.

The public composite boundary is exact:

```js
export async function normalizeFrameRepairCandidate({ providerBuffer, parentFrame, parentSheet, frameSize }) {
  return {
    raw_provider_png: await encodeRgbaPng(decoded),
    normalized_candidate_frame: candidateFrame,
    normalized_candidate_frame_png: candidatePng,
    transforms: {
      source_size: { w: decoded.width, h: decoded.height },
      source_bbox: sourceBbox,
      target_bbox: targetBbox,
      scale,
      destination: { x: destinationX, y: destinationY },
      palette_source: 'parent_sheet',
      resize: 'nearest',
    },
    finishing,
  }
}

export function compositeFrameRepairCandidate({ parentSheet, candidateFrame, sheetFrameIndex, frameSize, mask }) {
  const sheet = cloneRgba(parentSheet)
  const before = extractFrameRgba(parentSheet, sheetFrameIndex, frameSize)
  const origin = frameOrigin(sheetFrameIndex, parentSheet, frameSize)
  const active = runsToBitset(mask.runs, frameSize.w * frameSize.h)
  let changedInsideMask = 0
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    if (!active[pixel]) continue
    const x = pixel % frameSize.w
    const y = Math.floor(pixel / frameSize.w)
    const source = pixel * 4
    const target = ((origin.y + y) * sheet.width + origin.x + x) * 4
    let changed = false
    for (let channel = 0; channel < 4; channel += 1) {
      changed ||= sheet.data[target + channel] !== candidateFrame.data[source + channel]
      sheet.data[target + channel] = candidateFrame.data[source + channel]
    }
    if (changed) changedInsideMask += 1
  }
  return {
    sheet,
    before,
    after: extractFrameRgba(sheet, sheetFrameIndex, frameSize),
    integrity: {
      ...verifyFrameRepairIntegrity({ parentSheet, patchedSheet: sheet, candidateFrame, sheetFrameIndex, frameSize, active }),
      changed_inside_mask: changedInsideMask,
    },
  }
}
```

Define `cloneRgba`, `extractFrameRgba`, `frameOrigin`, `runsToBitset`, and `verifyFrameRepairIntegrity` in the same module; export the last three pure helpers for direct tests. The integrity report must count attempted provider differences outside the mask separately from actual patched differences, because the local compositor must reduce the latter to zero.

Also export `buildFrameRepairQualityReport()`. It consumes the parent frame, composited frame, normalized provider frame, canonical mask, adjacent clip frames, full Character Pack validation, and completeness flags; it returns these evidence groups without inventing semantic diagnosis:

- before/after alpha bounding box, detected foot anchor, and baseline;
- changed pixels inside the mask;
- attempted provider differences outside the mask as a non-blocking diagnostic;
- actual patched differences outside the mask and in non-target frames as blocking integrity counters;
- halo, alpha, significant-component, and clip-continuity evidence;
- full validator status, warnings, blocking errors, and before/after deltas.

Apply one deterministic policy: any actual integrity mismatch or standard validator failure is `fail`; incomplete evidence is `unknown`; a standard warning, continuity warning, or zero changed pixels inside the mask is `warning`; otherwise the report is `pass`. Provider output may attempt outside-mask changes without blocking acceptance when the local compositor removed all of them, but any actual outside-mask or non-target change always blocks. Tests must exercise every precedence edge.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairProvider.test.js test/editor-project/editorFrameRepairComposite.test.js`

Expected: PASS, including corrupt/SVG/animated/oversized/empty/multi-subject/full-sheet cases, allowed non-PNG raster input re-encoded as real PNG evidence, quality-policy precedence, and exact byte equality.

```bash
git status --short
git add src/editor-project/frameRepairProvider.js src/editor-project/frameRepairComposite.js src/editor-project/index.js test/editor-project/editorFrameRepairProvider.test.js test/editor-project/editorFrameRepairComposite.test.js
git commit -m "feat: add bounded frame repair provider composite"
```

### Task 4: Already-Normalized Character Packager

**Files:**
- Create: `src/editor-project/normalizedCharacterSheetPackage.js`
- Modify: `src/editor-project/index.js`
- Test: `test/editor-project/editorNormalizedCharacterSheetPackage.test.js`

- [ ] **Step 1: Write a failing exact-sheet packaging test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { packageNormalizedCharacterSheet } from '../../src/editor-project/normalizedCharacterSheetPackage.js'

test('packager preserves the exact normalized pixels and records no normalization Recipe', async () => {
  const image = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  for (let frame = 0; frame < 64; frame += 1) {
    const x = (frame % 8) * 96 + 47
    const y = Math.floor(frame / 8) * 96 + 80
    const offset = (y * image.width + x) * 4
    image.data.set([32 + frame, 96, 144, 255], offset)
  }
  const png = await encodeRgbaPng(image)
  const result = await packageNormalizedCharacterSheet({
    normalizedSheetPng: png,
    profile: TOPDOWN_RPG_V0,
    parentAnimations: {
      version: TOPDOWN_RPG_V0.version,
      profile: TOPDOWN_RPG_V0.id,
      sheet: 'normalized_sheet.png',
      frame_size: TOPDOWN_RPG_V0.frame,
      sheet_size: TOPDOWN_RPG_V0.sheet,
      anchor: TOPDOWN_RPG_V0.anchor,
      animations: Object.fromEntries(TOPDOWN_RPG_V0.animations.map((item) => [item.name, { frames: Array.from({ length: item.count }, (_, index) => item.row * 8 + item.startCol + index), fps: item.fps, loop: true, mode: item.mode }])),
    },
    parentMetadata: { name: 'Hero', description: 'Managed hero', profile: TOPDOWN_RPG_V0.id },
    createdAt: '2026-07-11T00:00:00.000Z',
    lineage: { project_id: 'project_demo', asset_id: 'asset_hero', parent_revision_id: 'rev_003', parent_job_id: 'job_parent' },
    generation: {
      mode: 'editor_targeted_frame_repair',
      provider: 'gemini',
      provider_preset_id: 'gemini-default',
      provider_label: 'Gemini Default',
      model: 'image-model',
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
    },
  })
  assert.deepEqual((await loadRgba(result.files.sourcePng)).data, image.data)
  assert.deepEqual((await loadRgba(result.files.normalizedSheetPng)).data, image.data)
  assert.equal(result.metadataJson.source.type, 'derived_revision')
  assert.equal(result.metadataJson.generation.mode, 'editor_targeted_frame_repair')
  assert.equal(result.metadataJson.generation.provider_preset_id, 'gemini-default')
  assert.equal(result.processingRecipe, null)
  assert.equal(result.debugReport.normalization.mode, 'already_normalized')
})

test('normalized packager source does not import or call the normal processing entry', async () => {
  const source = await readFile('src/editor-project/normalizedCharacterSheetPackage.js', 'utf8')
  assert.doesNotMatch(source, /processSheetBuffer|prepareSourceForProcessing|normalizeCells|applyAnchorOffset|motionStabil/i)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test:focused -- test/editor-project/editorNormalizedCharacterSheetPackage.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement the specialized packager using only existing final-stage builders**

The module imports existing public builders only: `loadRgba`, `encodeRgbaPng`, `computeGridBoundaries`, `sliceRgbaCells`, `detectAlphaBBox`, `detectFootAnchor`, `validateNormalizedFrames`, `buildCharacterQualityClosure`, `buildEditorMetadataJson`, `buildRowPreviewIndex`, `encodeGifFromRgbaFrames`, `buildInspectionPreviewArtifacts`, `buildMultiResolutionArtifacts`, `buildEngineExportArtifacts`, debug/onion/source-overlay renderers, `buildCharacterPackZip`, and metadata/package-id builders.

The central boundary is:

```js
export async function packageNormalizedCharacterSheet({
  normalizedSheetPng,
  profile,
  parentAnimations,
  parentMetadata,
  createdAt,
  lineage,
  generation,
}) {
  const sheet = await loadRgba(normalizedSheetPng)
  if (sheet.width !== profile.sheet.w || sheet.height !== profile.sheet.h) {
    const error = new Error('normalized sheet dimensions do not match the registered profile')
    error.code = 'invalid_managed_source'
    throw error
  }
  assertParentAnimations(parentAnimations, profile)
  const frames = framesFromExactSheet(sheet, profile)
  const validation = validateNormalizedFrames(frames, profile)
  const metadataJson = buildMetadataJson({
    id: buildPackageId(parentMetadata.name, createdAt),
    name: parentMetadata.name,
    description: parentMetadata.description ?? '',
    createdAt,
    source: {
      type: 'derived_revision',
      file_name: 'source.png',
      parent_project_id: lineage.project_id,
      parent_asset_id: lineage.asset_id,
      parent_revision_id: lineage.parent_revision_id,
      parent_job_id: lineage.parent_job_id,
    },
    generation: sanitizeFrameRepairGeneration(generation),
    quality: {
      status: validation.status,
      warnings: validation.warnings,
      blocking_errors: validation.blocking_errors,
    },
    profile,
  })
  const animationsJson = structuredClone(parentAnimations)
  const editorMetadataJson = buildEditorMetadataJson({ metadata: metadataJson, animationsJson, frames, profile })
  const rowPreviews = buildRowPreviewIndex(profile, animationsJson.animations)
  const rowGifBuffers = Object.fromEntries(rowPreviews.map((preview) => [
    preview.fileName,
    encodeGifFromRgbaFrames(preview.frames.map((index) => frames[index].image), { delay: Math.round(1000 / preview.fps) }),
  ]))
  const inspection = await buildInspectionPreviewArtifacts({ rowPreviews, rowPreviewFrames: frames })
  const debugReport = buildAlreadyNormalizedDebugReport({ profile, frames, validation, lineage, inspection: inspection.report })
  const multiResolution = await buildMultiResolutionArtifacts({ normalizedSheet: sheet, normalizedSheetPng, profile })
  const engine = await buildEngineExportArtifacts({ metadataJson, frames, profile, normalizedSheetPng, sourcePng: normalizedSheetPng, sourceLayout: resolveSourceLayout(profile.id) })
  const debugOverlayPng = await renderDebugOverlayPng({ profile, frames, baseSheet: normalizedSheetPng })
  const onionSkinOverlayPng = await renderOnionSkinOverlayPng({ profile, frames })
  const sourceLayoutOverlayPng = await renderSourceLayoutOverlayPng({
    sourcePng: normalizedSheetPng,
    width: sheet.width,
    height: sheet.height,
    grid: computeGridBoundaries({ width: sheet.width, height: sheet.height, columns: profile.grid.columns, rows: profile.grid.rows }),
    title: 'already_normalized_uniform_sheet',
  })
  const files = await buildNormalizedPackageFiles({ normalizedSheetPng, multiResolution, debugOverlayPng, onionSkinOverlayPng, sourceLayoutOverlayPng, inspection, rowGifBuffers, engine, animationsJson, metadataJson, editorMetadataJson, debugReport })
  return { id: metadataJson.id, animationsJson, metadataJson, editorMetadataJson, debugReport, rowPreviews, inspectionPreviews: inspection.previews, processingRecipe: null, files }
}
```

`framesFromExactSheet()` slices the exact uniform grid and creates frame objects without resizing or moving pixels. Each frame sets `source_bbox` and `normalized_bbox` to the same detected bbox, and `source_anchor` and `normalized_anchor` to the same detected foot anchor. `buildAlreadyNormalizedDebugReport()` explicitly records all skipped transforms as `applied: false` and `reason: 'already_normalized_input'`; it must never copy old normalization claims.

`sanitizeFrameRepairGeneration()` requires `mode: 'editor_targeted_frame_repair'` and allowlists only `provider`, `provider_preset_id`, `provider_label`, `model`, and the public `image_config` fields. It rejects extra keys and never receives or serializes an API key, base URL, adapter function, or private preset object. The service supplies this safe snapshot from the exact preset used for the one call.

`buildNormalizedPackageFiles()` constructs the same result keys consumed by `buildCharacterPackArtifactManifest`, and builds `character_pack.zip` from those real files. `source.png` and `normalized_sheet.png` both receive the exact supplied PNG buffer.

- [ ] **Step 4: Expand tests to the full artifact contract and run them**

Add assertions for 64 frames, parent animation equality, debug validation, multi-resolution nearest-neighbor sheets, Row GIFs, inspection index/sheet, Godot/RPG Maker/OCAD ZIPs, main ZIP, metadata timestamps, and source/normalized decoded RGBA equality.

Run: `npm run test:focused -- test/editor-project/editorNormalizedCharacterSheetPackage.test.js test/character-pack/validator.test.js test/character-pack/export.test.js`

Expected: PASS; no normalization/stabilization call and no changed input pixels.

- [ ] **Step 5: Commit the packager**

```bash
git status --short
git add src/editor-project/normalizedCharacterSheetPackage.js src/editor-project/index.js test/editor-project/editorNormalizedCharacterSheetPackage.test.js
git commit -m "feat: package normalized frame repair sheets"
```

### Task 5: Exclusive Evidence Writer And Sealed Artifact Contract

**Files:**
- Create: `src/editor-project/frameRepairArtifacts.js`
- Modify: `src/editor-project/index.js`
- Test: `test/editor-project/editorFrameRepairArtifacts.test.js`

- [ ] **Step 1: Write failing artifact-registry and tamper tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  FRAME_REPAIR_INTEGRITY_FILES,
  recoverSealedFrameRepairArtifacts,
  verifySealedFrameRepairArtifacts,
  writeFrameRepairArtifacts,
} from '../../src/editor-project/frameRepairArtifacts.js'

test('Frame Repair writer emits a complete sealed manifest with controlled URLs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frame-repair-artifacts-'))
  const generatedDir = path.join(root, 'generated')
  const job = { id: 'job_frame_repair', created_at: '2026-07-11T00:00:00.000Z' }
  await mkdir(path.join(generatedDir, job.id), { recursive: true })
  const written = await writeFrameRepairArtifacts({
    generatedDir,
    job,
    characterResult: characterResultFixture(),
    evidence: frameRepairEvidenceFixture(),
  })
  assert.equal(written.status, 'done')
  assert.equal(written.frame_repair_plan_url, `/generated/${job.id}/frame_repair_plan.json`)
  assert.deepEqual(
    written.artifact_integrity_manifest.map((entry) => entry.key).sort(),
    Object.keys(FRAME_REPAIR_INTEGRITY_FILES).sort(),
  )
  assert.equal((await verifySealedFrameRepairArtifacts({ generatedDir, job: { ...job, ...written } })).length, Object.keys(FRAME_REPAIR_INTEGRITY_FILES).length)
  const context = JSON.parse(await readFile(path.join(generatedDir, job.id, 'editor_frame_repair_context.json'), 'utf8'))
  assert.deepEqual(
    context.sealed_artifacts,
    written.artifact_integrity_manifest.filter((entry) => entry.key !== 'frame_repair_context'),
  )
  const recovered = await recoverSealedFrameRepairArtifacts({
    generatedDir,
    jobId: job.id,
    expectedManifestSha256: written.artifact_manifest_sha256,
  })
  assert.deepEqual(recovered.manifest, written.artifact_integrity_manifest)
})

test('Frame Repair sealed verification rejects replacement, missing files and URL/path tricks', async () => {
  const fixture = await completedArtifactFixture()
  await writeFile(path.join(fixture.jobDir, 'frame_repair_quality.json'), '{}')
  await assert.rejects(
    () => verifySealedFrameRepairArtifacts({ generatedDir: fixture.generatedDir, job: fixture.job }),
    (error) => error?.code === 'artifact_integrity_failed',
  )
  fixture.job.frame_repair_plan_url = '/generated/other/frame_repair_plan.json'
  await assert.rejects(
    () => verifySealedFrameRepairArtifacts({ generatedDir: fixture.generatedDir, job: fixture.job }),
    (error) => error?.code === 'artifact_integrity_failed',
  )
})
```

Define `characterResultFixture()`, `frameRepairEvidenceFixture()`, and `completedArtifactFixture()` in the test. The character result must use real tiny PNG buffers and the exact result keys expected by `buildCharacterPackArtifactManifest`; evidence must include every fixed frame-repair file below.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairArtifacts.test.js`

Expected: FAIL with missing `frameRepairArtifacts.js`.

- [ ] **Step 3: Implement the fixed file map and exclusive writer**

```js
export const FRAME_REPAIR_INTEGRITY_FILES = Object.freeze({
  source: 'source.png',
  source_layout_overlay: 'source_layout_overlay.png',
  sheet: 'normalized_sheet.png',
  multi_resolution: 'multi_resolution.json',
  sheet_96: 'normalized_sheet_96.png',
  sheet_64: 'normalized_sheet_64.png',
  sheet_48: 'normalized_sheet_48.png',
  sheet_32: 'normalized_sheet_32.png',
  sheet_16: 'normalized_sheet_16.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  debug_overlay: 'debug_overlay.png',
  onion_skin_overlay: 'onion_skin_overlay.png',
  inspection_index: 'inspection_index.json',
  inspection_sheet: 'inspection_sheet.png',
  godot_npc_zip: 'godot_npc_pack.zip',
  rpgmaker_zip: 'rpgmaker_pack.zip',
  ocad_zip: 'ocad_pack.zip',
  zip: 'character_pack.zip',
  frame_repair_plan: 'frame_repair_plan.json',
  frame_repair_context: 'editor_frame_repair_context.json',
  target_before: 'target_before.png',
  frame_repair_mask: 'frame_repair_mask.png',
  frame_repair_context_image: 'frame_repair_context.png',
  raw_provider_output: 'raw_provider_output.png',
  normalized_candidate_frame: 'normalized_candidate_frame.png',
  composited_candidate_frame: 'composited_candidate_frame.png',
  frame_repair_difference: 'frame_repair_difference.png',
  frame_repair_quality: 'frame_repair_quality.json',
  frame_repair_prompt: 'frame_repair_prompt.txt',
  patched_normalized_sheet: 'patched_normalized_sheet.png',
})
```

Implementation rules:

- Resolve the job directory with `resolveGeneratedJobDir()` and require that it already exists as a non-symlink directory directly under `generatedDir`.
- Build standard files with `buildCharacterPackArtifactManifest(job.id, characterResult)`.
- Reject duplicate or unsafe relative names before writing.
- Write every standard file and every evidence file except Context with `flag: 'wx'`; create only the explicit nested preview directories returned by the standard manifest.
- Read every required fixed file except Context back and build an immutable inner manifest of `{ key, file_name, size, sha256 }` entries.
- Construct `editor_frame_repair_context.json` from the validated `frame_repair_context_base` plus `sealed_artifacts: innerManifest`, then write it once with `flag: 'wx'`.
- Read Context back and build the outer public job manifest over every `FRAME_REPAIR_INTEGRITY_FILES` entry, including Context. This two-level contract avoids an impossible self-hash while still making Context bind every other required artifact and making the outer manifest bind Context.
- Compute `artifact_manifest_sha256` from the stable UTF-8 serialization of that ordered outer manifest. Return only safe scalar job fields, controlled `/generated/<job>/<file>` URLs, the sealed manifest, and its digest. Never return buffers, filesystem paths, provider keys, full request bodies, or the provider runtime object.
- `verifySealedFrameRepairArtifacts()` must resolve each fixed filename with `resolveGeneratedJobArtifactFile()`, capture it once, compare size/hash, require parsed Context `sealed_artifacts` to deep-equal the outer manifest with the Context entry removed, and return frozen `{ key, file_name, size, sha256, content }` entries.
- `recoverSealedFrameRepairArtifacts({ generatedDir, jobId, expectedManifestSha256 })` rebuilds the same ordered outer manifest from the fixed file map, verifies the Context inner manifest, and compares its stable digest to the durable ledger. It does not trust caller URLs or enqueue work. No manifest file is added to `/generated`; the private ledger digest is the detached recovery authority.

The evidence input contract is exact:

```js
const FRAME_REPAIR_EVIDENCE_INPUT_KEYS = Object.freeze([
  'frame_repair_plan',
  'frame_repair_context_base',
  'target_before',
  'frame_repair_mask',
  'frame_repair_context_image',
  'raw_provider_output',
  'normalized_candidate_frame',
  'composited_candidate_frame',
  'frame_repair_difference',
  'frame_repair_quality',
  'frame_repair_prompt',
  'patched_normalized_sheet',
])
```

`frame_repair_context_base` has these exact fields: `version`, `job_type`, `job_id`, `operation_id`, `submitted_at`, `project_id`, `project_revision`, `asset_id`, `parent_revision_id`, `parent_sheet_ref`, `parent_sheet_sha256`, nullable `parent_processing_recipe_ref`, `profile`, `frame_size`, `sheet_size`, `clip_id`, `clip_frame_position`, `sheet_frame_index`, `target_frame_sha256`, ordered `context_frames` with position/index/digest, `reference_context_sha256`, `mask_sha256`, `plan_hash`, safe `provider_preset` containing only id/provider/label/model/image config, `provider_call_budget`, `provider_calls_used`, `implementation_revision`, and ordered `input_reference_roles`. Artifact refs are controlled project protocol refs, never absolute filesystem paths. The writer alone adds `sealed_artifacts`; callers may not provide it. The parent Recipe reference is lineage evidence only and the accepted child still has `processing_recipe_ref: null`.

JSON values are serialized with two-space indentation and a trailing newline; PNG/text inputs must be Buffers. `patched_normalized_sheet.png`, `normalized_sheet.png`, and `source.png` must be decoded and compared by the service before the writer is called. Dynamic Row GIFs and dynamic inspection-preview files may remain in the generated job and the sealed `character_pack.zip`, but v1 does not register or import them as standalone child artifacts; the inspection index/sheet and all three engine ZIPs above are mandatory fixed artifacts.

- [ ] **Step 4: Run focused and full Section 2 verification**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairComposite.test.js test/editor-project/editorNormalizedCharacterSheetPackage.test.js test/editor-project/editorFrameRepairArtifacts.test.js`

Expected: all PASS, including outer-manifest tamper, inner-manifest tamper, Context replacement, and cross-binding mismatch cases.

Run: `npm test`

Expected: complete guarded suite PASS within the 4096 MiB process-tree limit.

- [ ] **Step 5: Commit the sealed writer**

```bash
git status --short
git add src/editor-project/frameRepairArtifacts.js src/editor-project/index.js test/editor-project/editorFrameRepairArtifacts.test.js
git commit -m "feat: seal frame repair artifacts"
```

### Task 6: Private Durable Operation Ledger

**Files:**
- Create: `src/editor-project/frameRepairOperationLedger.js`
- Modify: `src/editor-project/index.js`
- Test: `test/editor-project/editorFrameRepairOperationLedger.test.js`

- [ ] **Step 1: Write failing reserve/replay/restart tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createFrameRepairOperationLedger } from '../../src/editor-project/frameRepairOperationLedger.js'

const identity = {
  project_id: 'project_demo',
  asset_id: 'asset_hero',
  parent_revision_id: 'rev_003',
  operation_id: 'fr_0123456789abcdef',
  plan_hash: 'a'.repeat(64),
  job_id: 'job_frame_repair',
}

const lookup = {
  project_id: identity.project_id,
  asset_id: identity.asset_id,
  operation_id: identity.operation_id,
}

test('ledger create-exclusive reservation deduplicates concurrent first submit', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-'))
  const ledger = createFrameRepairOperationLedger({ workspaceRoot, now: () => '2026-07-11T00:00:00.000Z' })
  const [first, second] = await Promise.all([ledger.reserve(identity), ledger.reserve(identity)])
  assert.equal(first.record.job_id, 'job_frame_repair')
  assert.equal(second.record.job_id, 'job_frame_repair')
  assert.equal([first.created, second.created].filter(Boolean).length, 1)
  await assert.rejects(
    () => ledger.reserve({ ...identity, plan_hash: 'b'.repeat(64) }),
    (error) => error?.code === 'operation_conflict',
  )
})

test('same operation and plan returns the create-exclusive winner even when proposed job ids differ', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-race-'))
  const ledger = createFrameRepairOperationLedger({ workspaceRoot, now: () => '2026-07-11T00:00:00.000Z' })
  const [left, right] = await Promise.all([
    ledger.reserve({ ...identity, job_id: 'job_left' }),
    ledger.reserve({ ...identity, job_id: 'job_right' }),
  ])
  assert.equal(left.record.job_id, right.record.job_id)
  assert.equal([left.created, right.created].filter(Boolean).length, 1)
})

test('ledger restart recovers dispatched work as outcome unknown and never resets call count', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-restart-'))
  const first = createFrameRepairOperationLedger({ workspaceRoot, now: () => '2026-07-11T00:00:00.000Z' })
  await first.reserve(identity)
  await first.transition(lookup, { from: ['reserved'], operation_status: 'dispatched', job_status: 'generating', provider_calls_used: 1, provider_outcome: 'unknown' })
  const restarted = createFrameRepairOperationLedger({ workspaceRoot, now: () => '2026-07-11T00:01:00.000Z' })
  const recovered = await restarted.recover(lookup)
  assert.equal(recovered.recovery_state, 'outcome_unknown')
  assert.equal(recovered.provider_calls_used, 1)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairOperationLedger.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement direct-digest paths, exclusive reservation, and atomic transitions**

The ledger root is exactly:

```js
const root = path.join(path.resolve(workspaceRoot), '.operations', 'frame-repair')
```

The filename is `<sha256(project_id + "\0" + asset_id + "\0" + operation_id)>.json`. No route or caller may provide a ledger path. `reserve()` accepts the full identity/record proposal; `transition()`, `get()`, and `recover()` accept only `{ project_id, asset_id, operation_id }`, then trust the persisted record for parent revision, Plan hash, and winning job id. The stored schema is:

```js
{
  version: 'frame_repair_operation_v1',
  project_id,
  asset_id,
  parent_revision_id,
  operation_id,
  plan_hash,
  job_id,
  operation_status: 'reserved' | 'dispatched' | 'post_processing' | 'done' | 'failed',
  job_status: 'queued' | 'generating' | 'post_processing' | 'done' | 'failed_model_error' | 'failed_post_processing' | 'failed_safety_filter',
  provider_call_budget: 1,
  provider_calls_used: 0 | 1,
  provider_outcome: 'not_dispatched' | 'unknown' | 'known',
  created_at,
  updated_at,
  reason: null | string,
  retry_hint: null | string,
  artifact_manifest_sha256: null | string,
}
```

Implement this public contract (the implementation remains JavaScript; the type notation makes the boundary explicit without placeholder bodies):

```ts
type FrameRepairOperationLedger = Readonly<{
  reserve(identity: FrameRepairReserveIdentity): Promise<{
    created: boolean
    record: FrameRepairOperationRecord
  }>
  transition(lookup: FrameRepairOperationLookup, patch: FrameRepairTransition): Promise<FrameRepairOperationRecord>
  get(lookup: FrameRepairOperationLookup): Promise<FrameRepairOperationRecord>
  recover(lookup: FrameRepairOperationLookup): Promise<RecoveredFrameRepairOperation>
}>
```

Implement that contract with the following exact rules:

- root setup: resolve and `realpath()` the workspace root first; create/validate `.operations` and then `frame-repair` one immediate child at a time. Each component must be a real, non-symlink directory whose real parent is the previously validated directory. Never accept a pre-existing symlink or a path escaping the real workspace root.
- `reserve`: initialize budget `1`, used calls `0`, and `provider_outcome: 'not_dispatched'`, then write the direct-digest record with `flag: 'wx'`. On `EEXIST`, load the winner and exact-match project, asset, parent revision, operation, and Plan hash; ignore only the losing proposal's `job_id` and return the persisted winner with `created: false`. A scope, parent, operation, or Plan rebind is `operation_conflict`.
- `transition`: serialize per-record updates with a process-local promise lock; reload the record; require `record.operation_status` in `patch.from`; permit only the fields listed in the schema; require call count monotonic and at most one; require provider outcome to move only `not_dispatched -> unknown -> known` (terminal uncertain failure may remain `unknown`); write an adjacent unique temporary regular file then atomically `rename()` it over the record.
- `get`: resolve the direct digest path, require a regular non-symlink file contained under the real ledger root with size between 1 and 16 KiB before reading, parse exact keys, validate every scalar, and return a frozen clone. Missing is `operation_not_found`.
- `recover`: `done` and known `failed` records remain terminal; a terminal failure with `provider_outcome: 'unknown'`, or any `dispatched`/`post_processing` record with one used call, returns the same job status plus `recovery_state: 'outcome_unknown'`; `reserved` with zero calls returns `job_status: 'failed_post_processing'`, `reason: 'interrupted_before_dispatch'`, and `recovery_state: 'interrupted_before_dispatch'`. Recovery never writes a provider task.
- No record contains an instruction, prompt, mask, image, provider key, runtime preset, filesystem source path, project JSON, or raw request body.

- [ ] **Step 4: Add containment and secret-shape tests, then run focused tests**

Cover a symlinked root/file, malformed JSON, unexpected key, invalid hash/id, non-monotonic call count, illegal transition, zero-call interruption, terminal reconstruction, and a source scan proving the root does not contain `generated`.

Run: `npm run test:focused -- test/editor-project/editorFrameRepairOperationLedger.test.js`

Expected: PASS, including different proposed job ids returning one persisted winner.

- [ ] **Step 5: Commit the ledger**

```bash
git status --short
git add src/editor-project/frameRepairOperationLedger.js src/editor-project/index.js test/editor-project/editorFrameRepairOperationLedger.test.js
git commit -m "feat: persist frame repair operation ledger"
```

### Task 7: One-Call Shared-Queue Service

**Files:**
- Create: `src/editor-project/frameRepairService.js`
- Modify: `src/editor-project/index.js`
- Test: `test/editor-project/editorFrameRepairService.test.js`

- [ ] **Step 1: Write failing service call-budget and snapshot tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { createFrameRepairService } from '../../src/editor-project/frameRepairService.js'

test('service snapshots private inputs, queues once, dispatches once, and publishes no private runtime', async () => {
  const harness = serviceHarness()
  const service = createFrameRepairService(harness.dependencies)
  const input = liveServiceInput()
  const first = await service.enqueue(input)
  const replay = await service.enqueue(liveServiceInput())
  assert.equal(first.id, replay.id)
  assert.equal(harness.queue.length, 1)
  await harness.queue[0]()
  assert.equal(harness.providerCalls, 1)
  const completed = await service.getOperation(operationLookup(input.identity))
  assert.equal(completed.status, 'done')
  assert.equal(completed.provider_calls_used, 1)
  assert.doesNotMatch(JSON.stringify(completed), /apiKey|private-runtime|sourceBuffer|providerBuffer/)
})

test('service marks budget used before dispatch and never retries an uncertain failure', async () => {
  const harness = serviceHarness({ providerError: Object.assign(new Error('network lost'), { outcomeUnknown: true }) })
  const service = createFrameRepairService(harness.dependencies)
  const input = liveServiceInput()
  await service.enqueue(input)
  await harness.queue[0]()
  assert.equal(harness.providerCalls, 1)
  const recovered = await service.getOperation(operationLookup(input.identity))
  assert.equal(recovered.provider_calls_used, 1)
  assert.equal(recovered.recovery_state, 'outcome_unknown')
  await service.enqueue(input)
  assert.equal(harness.queue.length, 1)
})
```

`liveServiceInput()` returns the same scoped operation/Plan values with fresh `Buffer.from(...)` instances on each call. The harness injects a fake queue, job store, ledger, candidate generator, compositor, packager, and writer. It must retain private captured Buffers for assertions while proving the returned job contains none.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairService.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement the service boundary and phase order**

```ts
type FrameRepairServiceDependencies = Readonly<{
  generatedDir: string
  jobQueue: SharedJobQueue
  createJob: CreateJob
  getJob: GetJob
  updateJob: UpdateJob
  ledger: FrameRepairOperationLedger
  generateCandidate: GenerateFrameRepairCandidate
  normalizeCandidate: NormalizeFrameRepairCandidate
  compositeCandidate: CompositeFrameRepairCandidate
  packageSheet: PackageNormalizedCharacterSheet
  writeArtifacts: WriteFrameRepairArtifacts
}>

type FrameRepairService = Readonly<{
  enqueue(input: PrivateFrameRepairServiceInput): Promise<PublicFrameRepairJob>
  getOperation(lookup: FrameRepairOperationLookup): Promise<PublicFrameRepairJob>
  getJob(jobId: string): PublicFrameRepairJob | null
}>
```

Implement `enqueue()` in this exact order:

1. Validate a plain private input containing `identity`, `plan`, the live-submit private `providerPreset` snapshot, `parentSheetBuffer`, `targetFrame`, ordered role-tagged `referenceImages`, `parentAnimations`, `parentMetadata`, and `lineage`. Clone every Buffer/plain value synchronously. Derive a separate allowlisted `generation` object for metadata; never pass the private preset to the packager or writer.
2. Derive `{ project_id, asset_id, operation_id }` and call `ledger.get(lookup)`. If found, return `getOperation(lookup)` without creating or enqueuing anything. Ignore only controlled `operation_not_found`.
3. Create one `editor_character_frame_repair` job with public identity/hash/budget fields only.
4. `ledger.reserve({ ...identity, job_id: job.id })`; if another concurrent call won, use the returned persisted `job_id`, return that winning public/recovered job, and do not enqueue the newly created loser. Mark the loser only in memory as `failed_post_processing` with `reason: 'operation_deduplicated'`.
5. Enqueue one task on the existing shared queue.
6. Inside the task, create the job directory exclusively, update job to `generating`, then transition the ledger to `dispatched` with `provider_calls_used: 1` and `provider_outcome: 'unknown'` immediately before calling `generateCandidate()`.
7. On a returned candidate or definitive provider response, transition `provider_outcome` to `known`. On a provider exception, map only to existing `failed_safety_filter` or `failed_model_error` and preserve one used call; an uncertain transport outcome remains `provider_outcome: 'unknown'` and recovers as `outcome_unknown`. Never call the generator again.
8. Update job/ledger to `post_processing`, normalize the candidate, composite the mask, package the exact patched sheet with the safe generation snapshot, build the complete quality report and Context base, and write/seal artifacts.
9. Require composite integrity, complete evidence, one generated candidate, and a quality result in `pass | warning | fail | unknown`. A `fail` or `unknown` result may be retained for honest review diagnostics but cannot become Accept-enabled.
10. After writer/manifest success, transition the ledger to terminal `done` with status, manifest digest, and null failure fields before publishing the in-memory job as `done`. For every failure, transition the ledger terminally with the controlled status, phase reason, and retry hint before publishing the matching public failure. If terminal ledger persistence fails, do not publish `done`; leave the operation conservatively recoverable as uncertain. Never store the Plan body or artifacts in the ledger.

`getOperation()` first returns an in-memory sanitized job when it matches the ledger. After restart it uses `ledger.recover(lookup)` and reconstructs the outer manifest plus controlled fixed URLs only when `recoverSealedFrameRepairArtifacts()` matches the record's terminal manifest digest; it never enqueues. `getJob()` is allowlist-based and includes `provider_call_budget`, `provider_calls_used`, `generated_candidate_count`, `plan_hash`, controlled URLs, and the sealed manifest only. It cannot expose private provider configuration, reference buffers, or full Context content.

- [ ] **Step 4: Cover every terminal phase and run focused tests**

Add cases for queue failure, job-directory collision, provider unavailable, safety filter, corrupt candidate, composite integrity failure, packager failure, writer failure, replay after success/failure, and server-restart reconstruction. Assert one queue task and at most one generator call for every operation id.

Run: `npm run test:focused -- test/editor-project/editorFrameRepairService.test.js test/editor-project/editorFrameRepairOperationLedger.test.js test/editor-project/editorFrameRepairArtifacts.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the service**

```bash
git status --short
git add src/editor-project/frameRepairService.js src/editor-project/index.js test/editor-project/editorFrameRepairService.test.js
git commit -m "feat: add one-call frame repair service"
```

### Task 8: Managed Authority, Plan, Live Submit, And Recovery Coordinator

**Files:**
- Create: `src/editor-project/frameRepairCoordinator.js`
- Modify: `src/editor-project/index.js`
- Test: `test/editor-project/editorFrameRepairCoordinator.test.js`

- [ ] **Step 1: Write failing provider-free Plan and exact live-submit tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { createFrameRepairCoordinator } from '../../src/editor-project/frameRepairCoordinator.js'

test('Plan reloads managed authority, spends zero calls, and binds repeated clip position', async () => {
  const fixture = await managedFrameRepairFixture({ clipFrames: [16, 17, 17, 18] })
  const harness = coordinatorHarness(fixture)
  const coordinator = createFrameRepairCoordinator(harness.dependencies)
  const result = await coordinator.planFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: planBody({ clipFramePosition: 2, sheetFrameIndex: 17 }),
  })
  assert.equal(result.plan.clip.position, 2)
  assert.equal(result.plan.clip.sheet_frame_index, 17)
  assert.equal(result.estimated_provider_calls, 1)
  assert.equal(harness.serviceCalls.length, 0)
  assert.equal(harness.providerCalls, 0)
  assert.equal((await fixture.loadProject()).revision, fixture.project.revision)
})

test('live submit re-plans exactly and stale hash spends no call', async () => {
  const fixture = await managedFrameRepairFixture()
  const harness = coordinatorHarness(fixture)
  const coordinator = createFrameRepairCoordinator(harness.dependencies)
  const planned = await coordinator.planFrameRepair({ projectId: 'project_demo', assetId: 'asset_hero', body: planBody() })
  await assert.rejects(
    () => coordinator.submitFrameRepair({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: liveBody({ expectedPlanHash: 'f'.repeat(64) }),
    }),
    (error) => error?.code === 'stale_plan',
  )
  assert.equal(harness.serviceCalls.length, 0)
  const submitted = await coordinator.submitFrameRepair({
    projectId: 'project_demo', assetId: 'asset_hero',
    body: liveBody({ expectedPlanHash: planned.plan_hash }),
  })
  assert.equal(submitted.plan_hash, planned.plan_hash)
  assert.equal(harness.serviceCalls.length, 1)
})
```

Use the existing Editor project fixture pattern from `editorCharacterReprocessApi.test.js`, but create a real `768×768` managed normalized sheet with 64 non-empty frames and exact managed `animations.json`, `metadata.json`, `editor_metadata.json`, and `debug_report.json`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairCoordinator.test.js`

Expected: FAIL with missing coordinator.

- [ ] **Step 3: Implement managed authority and provider-free planning**

The coordinator constructor accepts `{ projectRoot, workspaceRoot, generatedDir, implementationRevision, getProviderEnv, frameRepairService }` and returns this public contract:

```ts
type FrameRepairCoordinator = Readonly<{
  planFrameRepair(input: FrameRepairPlanRouteInput): Promise<PublicFrameRepairPlan>
  submitFrameRepair(input: FrameRepairLiveRouteInput): Promise<PublicFrameRepairJob>
  getFrameRepairOperation(input: FrameRepairRecoveryRouteInput): Promise<PublicFrameRepairJob>
  acceptFrameRepair(input: FrameRepairAcceptRouteInput): Promise<AcceptedFrameRepairRevision>
}>
```

For Plan and live submit, one private `resolveFrameRepairAuthority()` must:

- load the formal project and exact active `character_pack` revision;
- require project and asset revision equality;
- require profile `topdown_rpg_v0` and the real managed `sheet`, `animations`, `metadata`, `editor_metadata`, and `debug_report` artifacts;
- resolve every file through `resolveManagedRevisionArtifactFile()` and capture it once;
- reject absolute/client paths, missing files, symlinks, malformed JSON, profile/sheet geometry mismatch, invalid clip ids/fps/frames, or `clipFramePosition` not resolving to `sheetFrameIndex`;
- decode the parent sheet, slice target/previous/next frames, compute decoded RGBA hashes, derive the base mask, apply edits, and build the canonical mask;
- resolve the exact provider preset with `resolveExactFrameRepairProvider(getProviderEnv(), providerPresetId)`; expose only safe provider fields and merged `image_size` plus read-only `aspect_ratio`;
- build project-owned reference images in deterministic order: enlarged target, mask visualization, previous/target/next contact sheet, then full normalized sheet only when the selected adapter's explicit local capability table supports that reference. Every entry has a fixed role/name/MIME type and a captured Buffer; no client path, URL, base64 input, or provider-fetched reference is allowed;
- create and return the canonical plan and private captured authority. Plan returns the public plan only and calls neither the service nor a provider.

The canonical Plan records the ordered `input_reference_roles` but never embeds image bytes. Its context hash covers the target, mask visualization, contact sheet, and optional full-sheet digest in that same role order. The optional parent Processing Recipe reference is recorded as nullable lineage evidence only.

`submitFrameRepair()` validates the live envelope, calls the same resolver again, compares the recomputed full hash, and rejects `can_run: false`. Before enqueue it privately snapshots the exact resolved preset fields required by the adapter—including the selected key and endpoint configuration—and clones every captured Buffer. Queue execution must use that snapshot and may not reread provider environment state. Only the safe generation projection and ordered reference roles can appear in metadata/Context/public results.

`getFrameRepairOperation()` validates route ids and operation id, then calls `frameRepairService.getOperation()` with `{ project_id, asset_id, operation_id }`. It performs no Plan/live POST and no provider action.

- [ ] **Step 4: Add authority-conflict and secret-boundary tests**

Cover stale project, stale active revision, missing/malformed/symlinked artifacts, profile conflict, invalid/repeated clip position, out-of-bounds mask, empty mask, unavailable preset, provider configuration error, parent sheet replacement between Plan/live, instruction normalization, and no secret/base64/path in public results.

Run: `npm run test:focused -- test/editor-project/editorFrameRepairCoordinator.test.js test/editor-project/editorFrameRepairProtocol.test.js test/editor-project/editorFrameRepairPlan.test.js`

Expected: PASS.

- [ ] **Step 5: Commit Plan/live coordination**

```bash
git status --short
git add src/editor-project/frameRepairCoordinator.js src/editor-project/index.js test/editor-project/editorFrameRepairCoordinator.test.js
git commit -m "feat: coordinate frame repair plans and jobs"
```

### Task 9: Specialized Immutable Accept And General-Import Block

**Files:**
- Modify: `src/editor-project/frameRepairCoordinator.js`
- Modify: `src/editor-project/artifactRegistry.js:19-126,430-640`
- Modify: `src/editor-project/index.js`
- Test: `test/editor-project/editorFrameRepairAcceptance.test.js`
- Test: `test/editor-project/editorArtifactRegistry.test.js`

- [ ] **Step 1: Write failing exact Accept and concurrent-mutation tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

test('Accept imports the exact sealed job as one child with no Processing Recipe', async () => {
  const fixture = await completedFrameRepairFixture({ quality: 'pass' })
  const result = await fixture.coordinator.acceptFrameRepair({
    projectId: fixture.project.id,
    assetId: fixture.asset.id,
    jobId: fixture.job.id,
    body: {
      expectedRevision: fixture.project.revision,
      expectedAssetRevisionId: fixture.revision.id,
      expectedPlanHash: fixture.planHash,
      warningConfirmed: false,
    },
  })
  assert.equal(result.accepted, true)
  assert.equal(result.revision.parent_revision_id, fixture.revision.id)
  assert.equal(result.revision.processing_recipe_ref, null)
  assert.equal(result.revision.artifacts.frame_repair_context.endsWith('/editor_frame_repair_context.json'), true)
  assert.equal(result.project.revision, fixture.project.revision + 1)
})

test('two concurrent Accepts produce one child and one conflict', async () => {
  const fixture = await completedFrameRepairFixture({ quality: 'pass' })
  const request = fixture.acceptRequest()
  const results = await Promise.allSettled([
    fixture.coordinator.acceptFrameRepair(request),
    fixture.coordinator.acceptFrameRepair(request),
  ])
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1)
})
```

- [ ] **Step 2: Run focused tests and verify acceptance is missing**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairAcceptance.test.js test/editor-project/editorArtifactRegistry.test.js`

Expected: FAIL because specialized import/Accept does not exist.

- [ ] **Step 3: Extend general-import protection and add specialized import**

In `artifactRegistry.js`, replace the single reprocess context probe with an exact allowlist:

```js
const SPECIALIZED_CONTEXT_FILES = Object.freeze([
  ['editor_reprocess_context.json', 'editor_character_reprocess'],
  ['editor_frame_repair_context.json', 'editor_character_frame_repair'],
])
```

`assertGeneralImportAllowed()` checks both files and rejects either recognized job type with `specialized_accept_required`. The in-memory service check in the API remains a first defense; the generated context marker remains the restart/tamper defense.

Add `importAcceptedFrameRepairAsAsset()` beside the existing reprocess importer. It receives only the already captured verified manifest/context/quality and must:

- accept only registered Frame Repair artifact keys and exact fixed filenames;
- require source, sheet, animations, metadata, editor metadata, debug report, multi-resolution sheets, overlays, inspection index/sheet, Godot/RPG Maker/OCAD ZIPs, main ZIP, plan, context, mask, normalized/composited candidate, difference, quality, and patched sheet;
- verify captured plan/context/quality deep-equal the coordinator-verified values;
- reserve one new revision directory with the existing exclusive no-reuse algorithm;
- write each captured Buffer with `flag: 'wx'`, then stat/hash it;
- derive clips from the captured animations;
- create a child revision with `sourceJobId: jobId`, `parentRevisionId: active revision`, `processingRecipeRef: null`, `qualityStatus` from verified policy, and `productionStatus: ready` for pass or `review_required` for warning;
- set the child active only in the returned cloned project.

Do not copy `raw_provider_output` or `frame_repair_prompt` into the managed child in v1. They remain sealed generated evidence; this minimizes persistent provider payload/prompt retention. Do copy plan, context, mask, normalized/composited candidate, difference, and quality under their registered artifact keys.

- [ ] **Step 4: Implement Accept revalidation inside the project mutation lock**

`acceptFrameRepair()` must call `mutateEditorProject()` first, then inside its mutation callback:

If the in-memory job is absent after restart, resolve only the fixed `editor_frame_repair_context.json` under the route `jobId`, require a contained non-symlink regular file no larger than 128 KiB before reading, parse its exact public shape, and use `{ route projectId, route assetId, context operation_id }` for the ledger lookup. Require the ledger winner's `job_id`, parent revision, and Plan hash to match the route/Context before calling `recoverSealedFrameRepairArtifacts()` with the ledger manifest digest. This recovery performs no directory scan and treats Context as untrusted until ledger and two-level manifest verification both succeed.

1. recheck asset kind and exact active revision;
2. load the job through `frameRepairService.getJob()` or durable operation recovery and require type `editor_character_frame_repair`, status `done`, budget `1`, used `1`, candidate count `1`;
3. call `verifySealedFrameRepairArtifacts()`, require the outer manifest and Context's inner `sealed_artifacts` cross-binding, and parse plain plan/context/quality/metadata/animations;
4. require job, request, plan, context, operation ledger, project, asset, parent revision, implementation revision, ordered reference roles, and parent sheet digest equality;
5. reload the current managed parent sheet through the safe path resolver;
6. decode current parent and sealed patched sheet, recompute non-target and target-outside-mask equality, and reject any mismatch regardless of stored quality;
7. require complete evidence; reject `fail`/`unknown`; bind a warning confirmation to exact job and plan hash;
8. call `importAcceptedFrameRepairAsAsset()` and return the new project.

Every failure occurs before the formal project save. An exclusively reserved orphan directory is preserved and reported; no directory or generated evidence is deleted.

- [ ] **Step 5: Add tamper/warning/failure/import tests and commit**

Cover altered plan/context/quality/manifest/hash, parent sheet replacement, target outside-mask mutation, non-target mutation, wrong job type/status/call count, stale project/asset, warning without/with exact confirmation, fail/unknown, fixed inspection/engine-export retention, general import before/after restart, copy failure, save failure, and the concurrent Accept race.

Run: `npm run test:focused -- test/editor-project/editorFrameRepairAcceptance.test.js test/editor-project/editorArtifactRegistry.test.js test/editor-project/editorCharacterReprocessApi.test.js`

Expected: PASS; existing Character Reprocess remains unchanged.

```bash
git status --short
git add src/editor-project/frameRepairCoordinator.js src/editor-project/artifactRegistry.js src/editor-project/index.js test/editor-project/editorFrameRepairAcceptance.test.js test/editor-project/editorArtifactRegistry.test.js
git commit -m "feat: accept sealed frame repair revisions"
```

### Task 10: Editor API Routes And One-Time Server Wiring

**Files:**
- Modify: `src/editor-project/apiHandler.js:60-108,236-503`
- Modify: `server.js:70-150,2480-2495`
- Modify: `docs/protocols/local-api-boundaries.md:111-235`
- Test: `test/editor-project/editorFrameRepairApi.test.js`
- Test: `test/editor-project/editorFrameRepairServerWiring.test.js`

- [ ] **Step 1: Write failing route/status tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

test('Editor API delegates the four exact Frame Repair routes', async () => {
  const harness = await editorApiHarness({ frameRepairCoordinator: coordinatorStub() })
  const plan = await harness.request('POST', '/api/editor/projects/project_demo/assets/asset_hero/frame-repair/plan', planBody())
  assert.equal(plan.status, 200)
  const live = await harness.request('POST', '/api/editor/projects/project_demo/assets/asset_hero/frame-repair', liveBody())
  assert.equal(live.status, 202)
  const operation = await harness.request('GET', '/api/editor/projects/project_demo/assets/asset_hero/frame-repair/operations/fr_0123456789abcdef')
  assert.equal(operation.status, 200)
  const accepted = await harness.request('POST', '/api/editor/projects/project_demo/assets/asset_hero/frame-repair/job_frame_repair/accept', acceptBody())
  assert.equal(accepted.status, 200)
})

test('unwired and controlled errors keep stable statuses', async () => {
  const harness = await editorApiHarness({ frameRepairCoordinator: null })
  assert.equal((await harness.request('POST', '/api/editor/projects/project_demo/assets/asset_hero/frame-repair/plan', planBody())).body.error, 'frame_repair_unavailable')
  for (const [code, status] of [
    ['invalid_frame_repair_request', 400],
    ['operation_not_found', 404],
    ['stale_plan', 409],
    ['quality_blocked', 422],
    ['provider_unavailable', 503],
    ['provider_configuration_error', 503],
  ]) assert.equal(await statusForInjectedFrameRepairError(code), status)
})
```

- [ ] **Step 2: Run focused API tests and verify they fail**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairApi.test.js test/editor-project/editorFrameRepairServerWiring.test.js`

Expected: FAIL because routes and server constructors are absent.

- [ ] **Step 3: Add four thin route branches and controlled errors**

Extend `handleEditorProjectApi()` options with `frameRepairCoordinator` and `frameRepairService`. Add these exact branches before unlink/delete:

```js
if (req.method === 'POST' && parts[6] === 'frame-repair' && parts[7] === 'plan' && parts.length === 8) {
  if (!frameRepairCoordinator) return sendJson(res, 503, { error: 'frame_repair_unavailable', reason: 'targeted frame repair is unavailable' })
  return sendJson(res, 200, await frameRepairCoordinator.planFrameRepair({ projectId, assetId, body: await readJsonBody(req) }))
}

if (req.method === 'POST' && parts[6] === 'frame-repair' && parts.length === 7) {
  if (!frameRepairCoordinator) return sendJson(res, 503, { error: 'frame_repair_unavailable', reason: 'targeted frame repair is unavailable' })
  return sendJson(res, 202, await frameRepairCoordinator.submitFrameRepair({ projectId, assetId, body: await readJsonBody(req) }))
}

if (req.method === 'GET' && parts[6] === 'frame-repair' && parts[7] === 'operations' && parts[8] && parts.length === 9) {
  if (!frameRepairCoordinator) return sendJson(res, 503, { error: 'frame_repair_unavailable', reason: 'targeted frame repair is unavailable' })
  return sendJson(res, 200, await frameRepairCoordinator.getFrameRepairOperation({ projectId, assetId, operationId: parts[8] }))
}

if (req.method === 'POST' && parts[6] === 'frame-repair' && parts[7] && parts[8] === 'accept' && parts.length === 9) {
  if (!frameRepairCoordinator) return sendJson(res, 503, { error: 'frame_repair_unavailable', reason: 'targeted frame repair is unavailable' })
  return sendJson(res, 200, await frameRepairCoordinator.acceptFrameRepair({ projectId, assetId, jobId: parts[7], body: await readJsonBody(req) }))
}
```

Add the exact new controlled error/status mappings. In general import, reject an in-memory `editor_character_frame_repair` job before calling the artifact importer, parallel to Character Reprocess.

- [ ] **Step 4: Wire one service/coordinator to the existing queue**

In `server.js`:

- move `let runtimeProviderEnv = {}` before service construction without changing `/api/provider-config` behavior;
- construct one ledger with `{ workspaceRoot: editorWorkspaceDir }`, one service, and one coordinator; the ledger module alone derives `.operations/frame-repair` so wiring cannot double-prefix or redirect it;
- inject the existing `jobQueue`, `createJob`, `getJob`, `updateJob`, existing provider adapters through `requestFrameRepairCandidate`, the specialized compositor/packager/writer, `implementationRevision`, and `getProviderEnv: () => ({ ...process.env, ...runtimeProviderEnv })`;
- pass `frameRepairCoordinator` and `frameRepairService` into `handleEditorProjectApi()`;
- do not add another queue, endpoint namespace, dependency, job status, provider fallback, or general import behavior.

The wiring test must assert exactly one `createJobQueue(` call, that the ledger receives `editorWorkspaceDir`, and that no operation root derives from `generatedDir` or `editorGeneratedDir`.

Update `docs/protocols/local-api-boundaries.md` with exact request/response/error/call-budget/recovery/Accept behavior and the non-public ledger boundary.

- [ ] **Step 5: Run focused and full Section 3 verification**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairApi.test.js test/editor-project/editorFrameRepairServerWiring.test.js test/editor-project/editorFrameRepairCoordinator.test.js test/editor-project/editorFrameRepairAcceptance.test.js test/editor-project/editorCharacterReprocessApi.test.js test/editor-project/editorCharacterReprocessServerWiring.test.js`

Expected: all PASS.

Run: `npm test`

Expected: complete guarded suite PASS; existing endpoint and job-state tests unchanged.

- [ ] **Step 6: Commit API/server wiring**

```bash
git status --short
git add src/editor-project/apiHandler.js server.js docs/protocols/local-api-boundaries.md test/editor-project/editorFrameRepairApi.test.js test/editor-project/editorFrameRepairServerWiring.test.js
git commit -m "feat: wire frame repair editor api"
```

### Task 11: Browser API, State Matrix, And Recovery Lifecycle

**Files:**
- Create: `src/ui/editor/frameRepairState.js`
- Create: `src/ui/editor/frameRepairLifecycle.js`
- Modify: `src/ui/editor/api.js:1-210`
- Modify: `src/ui/editor/state.js:1-80`
- Test: `test/editor-project/editorFrameRepairState.test.js`
- Test: `test/editor-project/editorFrameRepairLifecycle.test.js`

- [ ] **Step 1: Write failing complete-state and zero-implicit-live-POST tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { createEmptyFrameRepairState, getFrameRepairUiState } from '../../src/ui/editor/frameRepairState.js'
import { createFrameRepairLifecycle } from '../../src/ui/editor/frameRepairLifecycle.js'

const REQUIRED_STATES = [
  'no_project', 'no_asset', 'unsupported_asset', 'no_frame', 'planning',
  'needs_scope', 'invalid_mask', 'planned', 'provider_unavailable',
  'confirming', 'queued', 'generating', 'post_processing', 'ready',
  'warning', 'blocked_quality', 'failed_model', 'failed_processing',
  'outcome_unknown', 'stale_plan', 'project_conflict',
  'asset_revision_conflict', 'selection_switched', 'accepting', 'accepted',
  'discarded', 'teardown',
]

test('Frame Repair state matrix has one honest message and exact actions for every required state', () => {
  for (const state of REQUIRED_STATES) {
    const model = getFrameRepairUiState(state)
    assert.equal(typeof model.message, 'string')
    assert.equal(model.announcement, model.message)
    assert.equal(Array.isArray(model.actions), true)
    if (state !== 'accepted') assert.equal(model.mutatesProject, false)
  }
  assert.deepEqual(createEmptyFrameRepairState().maskEdits, [])
})

test('selection and local edits never submit Plan or live generation', async () => {
  const calls = []
  const lifecycle = createFrameRepairLifecycle({
    plan: async (payload) => { calls.push(['plan', payload]); return { plan_hash: 'a'.repeat(64) } },
    generate: async (payload) => { calls.push(['generate', payload]); return { id: 'job_frame' } },
    recover: async (payload) => { calls.push(['recover', payload]); return { id: 'job_frame' } },
    fetchJob: async () => ({ id: 'job_frame', status: 'done' }),
    accept: async () => ({ accepted: true }),
    storage: memorySessionStorage(),
    createOperationId: () => 'fr_0123456789abcdef',
    schedule: (callback) => { callback(); return 1 },
    cancel: () => undefined,
  })
  lifecycle.setSelection({ projectId: 'project_demo', projectRevision: 4, assetId: 'asset_hero', revisionId: 'rev_003' })
  lifecycle.invalidatePlan('mask_edit')
  lifecycle.invalidatePlan('instruction_edit')
  assert.deepEqual(calls, [])
  await lifecycle.plan({ request: 'plan' })
  assert.deepEqual(calls.map(([type]) => type), ['plan'])
  await lifecycle.generate({ request: 'live' })
  assert.equal(calls.filter(([type]) => type === 'generate').length, 1)
})
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairState.test.js test/editor-project/editorFrameRepairLifecycle.test.js`

Expected: FAIL with missing modules.

- [ ] **Step 3: Add exact browser API functions and controlled codes**

Add these functions to `src/ui/editor/api.js`:

```js
export function planCharacterFrameRepair(input, { signal } = {}) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/frame-repair/plan`, {
    method: 'POST', signal, body: JSON.stringify(input.body),
  })
}

export function generateCharacterFrameRepair(input, { signal } = {}) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/frame-repair`, {
    method: 'POST', signal, body: JSON.stringify(input.body),
  })
}

export function recoverCharacterFrameRepair(input, { signal } = {}) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/frame-repair/operations/${encodeURIComponent(input.operationId)}`, {
    method: 'GET', signal,
  })
}

export function acceptCharacterFrameRepair(input, { signal } = {}) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/frame-repair/${encodeURIComponent(input.jobId)}/accept`, {
    method: 'POST', signal, body: JSON.stringify(input.body),
  })
}

export function fetchCharacterProviderState({ signal } = {}) {
  return jsonRequest('/api/gemini-state', { method: 'GET', signal })
}
```

Add all new controlled server error codes to `CONTROLLED_EDITOR_ERROR_CODES`; unknown server strings remain `editor_request_failed`.

- [ ] **Step 4: Implement ephemeral state and lifecycle**

`createEmptyFrameRepairState()` returns independent collections and these top-level fields:

```js
{
  active: false,
  selection: null,
  stage: 'target_mask',
  uiState: 'no_frame',
  instruction: '',
  maskMode: 'add_rectangle',
  baseMask: null,
  maskEdits: [],
  selectedEditIndex: null,
  provisionalMask: null,
  plan: null,
  planHash: null,
  planInvalidReason: null,
  providerState: null,
  providerPresetId: '',
  imageSize: '1K',
  operationId: null,
  job: null,
  candidate: null,
  quality: null,
  warningConfirmation: null,
  pointerDraft: null,
  diagnostics: [],
  error: null,
  generation: 0,
}
```

Add `repair.frame: createEmptyFrameRepairState()` to global state and all shell reset paths. Tests must prove edits never enter project JSON/history/dirty state.

`createFrameRepairLifecycle()` owns one selection token, one Plan abort controller, one live abort controller, one poll timer, and one accept operation map. Its public methods are:

```js
{
  setSelection,
  invalidatePlan,
  plan,
  generate,
  recoverFromSession,
  accept,
  stop,
  capture,
}
```

Rules:

- `plan()` is the only Plan POST path.
- `generate()` creates one operation id before the request, writes the minimal session handle, disables duplicate generate synchronously, and reuses that id for transport recovery.
- A network error after live submission calls the operation GET once; it never calls live generation again.
- Poll only the returned job id. Stop on the shared terminal statuses or `recovery_state: 'outcome_unknown'`.
- `recoverFromSession()` reads only `{ projectId, assetId, operationId, jobId, planHash }`, validates exact keys/ids, performs one operation GET, and never performs a POST.
- `accept()` deduplicates exact job/hash/confirmation requests.
- Selection switch, close, blur, teardown, project switch, asset switch, and revision switch abort local fetch/poll work and token-guard late results.
- Blur/close stops pointer work, polling, timers, and local request observation only; it never claims to cancel a provider call already dispatched on the server and never clears an unresolved recovery handle.
- Clear the recovery handle only on accepted, acknowledged discard, or acknowledged controlled not-found.

- [ ] **Step 5: Expand lifecycle tests and commit**

Cover Plan invalidation, late Plan/live/poll/accept results, duplicate click, lost `202`, operation lookup, refresh recovery, outcome unknown, session-handle allowlist, controlled not-found acknowledgement, warning identity, and teardown timer/abort cleanup.

Run: `npm run test:focused -- test/editor-project/editorFrameRepairState.test.js test/editor-project/editorFrameRepairLifecycle.test.js test/editor-project/editorRepairPreviewLifecycle.test.js`

Expected: PASS.

```bash
git status --short
git add src/ui/editor/frameRepairState.js src/ui/editor/frameRepairLifecycle.js src/ui/editor/api.js src/ui/editor/state.js test/editor-project/editorFrameRepairState.test.js test/editor-project/editorFrameRepairLifecycle.test.js
git commit -m "feat: add frame repair browser lifecycle"
```

### Task 12: Frame Repair Canvas And Workbench Controller Adapter

**Files:**
- Create: `src/ui/editor/frameRepairCanvas.js`
- Create: `src/ui/editor/frameRepairController.js`
- Modify: `src/ui/editor/repairWorkbenchController.js:209-330,631-705,1277-1285`
- Test: `test/editor-project/editorFrameRepairCanvas.test.js`
- Test: `test/editor-project/editorFrameRepairController.test.js`

- [ ] **Step 1: Write failing coordinate, mask, and controller tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clientPointToFramePoint,
  rectangleFromFramePoints,
} from '../../src/ui/editor/frameRepairCanvas.js'
import { createFrameRepairController } from '../../src/ui/editor/frameRepairController.js'

test('Canvas pointer coordinates map through the current fit/zoom/pan viewport', () => {
  assert.deepEqual(clientPointToFramePoint({
    clientX: 150,
    clientY: 90,
    canvasRect: { left: 10, top: 10, width: 280, height: 160 },
    frameSize: { w: 96, h: 96 },
    zoom: 1,
    pan: { x: 0, y: 0 },
  }), { x: 48, y: 48 })
  assert.deepEqual(rectangleFromFramePoints({ x: 20, y: 30 }, { x: 10, y: 25 }), {
    x: 10, y: 25, width: 11, height: 6,
  })
})

test('controller entry and edits are local; only Review and Generate call their APIs', async () => {
  const harness = frameControllerHarness()
  const controller = createFrameRepairController(harness.dependencies)
  controller.enter(workbenchSnapshot())
  controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 })
  controller.setInstruction('repair the hand')
  assert.deepEqual(harness.calls, [])
  await controller.reviewCall()
  assert.deepEqual(harness.calls.map(([type]) => type), ['plan'])
  await controller.generateOneCandidate()
  assert.equal(harness.calls.filter(([type]) => type === 'generate').length, 1)
  assert.equal(harness.projectDirty(), false)
  assert.equal(harness.historySnapshot(), harness.originalHistory)
})
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairCanvas.test.js test/editor-project/editorFrameRepairController.test.js`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement cached mask drawing and pointer math outside RAF**

`frameRepairCanvas.js` exports:

```js
export function clientPointToFramePoint({ clientX, clientY, canvasRect, frameSize, zoom, pan }) {
  const viewport = computeRepairViewport({
    canvasWidth: canvasRect.width,
    canvasHeight: canvasRect.height,
    frameSize,
    zoom,
    pan,
  })
  const x = Math.floor(((clientX - canvasRect.left - viewport.x) / viewport.w) * frameSize.w)
  const y = Math.floor(((clientY - canvasRect.top - viewport.y) / viewport.h) * frameSize.h)
  if (x < 0 || y < 0 || x >= frameSize.w || y >= frameSize.h) return null
  return { x, y }
}

export function rectangleFromFramePoints(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x) + 1,
    height: Math.abs(start.y - end.y) + 1,
  }
}
```

Also export `createFrameRepairMaskSource(mask, documentRef)` and `drawFrameRepairOverlay(ctx, command, viewport, pixelRatio)`. The source is a cached 96×96 offscreen Canvas keyed by mask SHA/run signature. It fills canonical/provisional mask pixels with a translucent patterned color, draws Add as solid outline and Remove as dashed outline, and never fetches, decodes, hashes, reads layout, or mutates DOM inside the visible Canvas RAF callback.

- [ ] **Step 4: Implement the dedicated controller and thin Workbench delegation**

The constructor accepts `{ state, lifecycle, artifactClient, profile, requestRender, onProjectAccepted, announce, readFramePixels, createDifference }` and returns this dedicated boundary:

```ts
type FrameRepairController = Readonly<{
  enter(snapshot: RepairWorkbenchSnapshot): void
  close(reason: FrameRepairCloseReason): void
  viewModel(workbenchView: RepairWorkbenchView): FrameRepairViewModel
  decorateWorkbenchView(workbenchView: RepairWorkbenchView): RepairWorkbenchView
  setInstruction(value: string): void
  setProviderPreset(value: string): void
  setImageSize(value: FrameRepairImageSize): void
  setMaskMode(value: 'add' | 'remove'): void
  addRectangle(rectangle: FrameRectangle): void
  removeRectangle(rectangle: FrameRectangle): void
  selectEdit(index: number): void
  updateSelectedEdit(rectangle: FrameRectangle): void
  deleteSelectedEdit(): void
  undoMaskEdit(): void
  reviewCall(): Promise<void>
  generateOneCandidate(): Promise<void>
  acceptCandidate(): Promise<void>
  discardCandidate(): void
  handlePointer(type: FrameRepairPointerEventType, payload: FrameRepairPointerPayload): void
}>
```

Implement these rules:

- `enter()` snapshots project/asset/revision/clip/clip-position/sheet-frame identity plus the existing Workbench mode/zoom/pan/overlay/Recipe state. It reads only the selected frame pixels, derives a provisional base mask with the shared pure mask module, initializes provider defaults from the safe public state, and makes no POST.
- Every mask/instruction/provider/image-size edit clears Plan/job/candidate/warning confirmation and returns to Stage 1; local Undo touches only `maskEdits`.
- `reviewCall()` requires non-empty instruction/mask and saved project state, sends one provider-free Plan, then replaces provisional runs with authoritative canonical runs and enters Stage 2 only when the returned selection/hash still matches.
- `generateOneCandidate()` delegates to lifecycle with the exact Plan hash and one fixed operation id; it cannot run without `can_run`.
- Hydration allowlists and loads only the exact generated patched sheet, animations, metadata, editor metadata, debug report, plan, context, mask, quality, target/candidate/difference images. It validates job/plan/context/selection/hash/call-count/geometry before exposing result review.
- Candidate review decorates the existing Workbench render frame with the patched sheet, current frame rect, cached difference source, mask overlay, and repaired-filmstrip badge. It does not replace the parent revision or base Workbench draft.
- `acceptCandidate()` binds warning confirmation to the exact job/hash and calls specialized Accept. On success it invokes `onProjectAccepted`; no general import.
- `close()` aborts local work, clears pointer capture/timers, restores the saved Workbench view/Recipe state, and keeps only the permitted recovery handle when a submitted outcome is unresolved.

Modify `repairWorkbenchController.js` only to accept a `frameRepairController` dependency, close it on Workbench selection/teardown, provide the current saved Workbench snapshot on entry, add frame-repair methods to `repairWorkbenchContext()`, and pass the base view model through `decorateWorkbenchView()`. Existing Character Reprocess code stays in place.

- [ ] **Step 5: Add stale/hydration/accept/RAF tests and commit**

Cover empty frame, provisional diagnostic/needs-scope, repeated frame position, edit invalidation, Plan stale response, job late response, partial artifact failure, missing clip, integrity fail, warning confirmation, exact Accept, discard, selection/project/asset/revision switch, teardown, and no fetch/decode/layout work during renderer draw.

Run: `npm run test:focused -- test/editor-project/editorFrameRepairCanvas.test.js test/editor-project/editorFrameRepairController.test.js test/editor-project/editorRepairWorkbenchController.test.js test/editor-project/editorRepairComparisonRenderer.test.js`

Expected: PASS.

```bash
git status --short
git add src/ui/editor/frameRepairCanvas.js src/ui/editor/frameRepairController.js src/ui/editor/repairWorkbenchController.js test/editor-project/editorFrameRepairCanvas.test.js test/editor-project/editorFrameRepairController.test.js
git commit -m "feat: add frame repair controller and canvas"
```

### Task 13: Four-Stage Workbench Rail, Filmstrip Badge, Responsive UI

**Files:**
- Create: `src/ui/editor/frameRepairPanel.js`
- Modify: `src/ui/editor/repairWorkbenchPanel.js:503-1213`
- Modify: `src/ui/editor/shell.js:1-430,1000-1170,2820-3000`
- Modify: `src/ui/editor/editor.css`
- Modify: `scripts/smoke-local-ui.mjs:240-280`
- Test: `test/editor-project/editorFrameRepairPanel.test.js`
- Test: `test/editor-project/editorRepairWorkbenchPanel.test.js`
- Test: `test/editor-project/editorShellStructure.test.js`
- Test: `test/localSmokeScript.test.js`

- [ ] **Step 1: Write failing UI-source and interaction tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { createFrameRepairPanel } from '../../src/ui/editor/frameRepairPanel.js'

test('Frame Repair rail exposes the approved four-stage surface and no forbidden active tool', async () => {
  const source = await readFile('src/ui/editor/frameRepairPanel.js', 'utf8')
  for (const marker of [
    'Target & Mask', 'Review AI Call', 'Processing', 'Result & Validation',
    'Add rectangle', 'Remove rectangle', 'Generate one candidate',
    'Discard candidate', 'Accept revision', 'aria-live', 'aria-current',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(source, /brush|lasso|freehand|eraser|multiple candidates|automatic retry/i)
})

test('rail keeps future stages inert and dispatches one declared action per real control', () => {
  const documentRef = fakeDocument()
  const calls = []
  const panel = createFrameRepairPanel({
    documentRef,
    onAction: (type, payload) => calls.push([type, payload]),
  })
  panel.render(frameRepairView({ stage: 'target_mask', uiState: 'needs_scope' }))
  assert.equal(panel.element.querySelector('[data-frame-repair-stage="review_call"]').inert, true)
  panel.element.querySelector('[data-frame-repair-action="add-mode"]').dispatchEvent({ type: 'click' })
  assert.deepEqual(calls.map(([type]) => type), ['set_mask_mode'])
})
```

Reuse the fake DOM utilities already proven in `editorRepairWorkbenchPanel.test.js`; move only genuinely reusable test utilities to `test/helpers/fakeEditorDom.js` if both suites need them, and update both imports in the same commit.

- [ ] **Step 2: Run focused UI tests and verify they fail**

Run: `npm run test:focused -- test/editor-project/editorFrameRepairPanel.test.js test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorShellStructure.test.js test/localSmokeScript.test.js`

Expected: FAIL with missing Frame Repair panel/markers.

- [ ] **Step 3: Build the four-stage rail as a focused component**

`createFrameRepairPanel({ documentRef, onAction })` returns:

```js
{
  element,
  render(viewModel),
  focusFirst(),
  destroy(),
}
```

The element contains:

- one ordered stage list with `aria-current="step"` only on the current stage and inert future-stage bodies;
- Stage 1 read-only target identity, mask source/confidence/pixel count, Add/Remove pressed buttons, instruction textarea, selected rectangle x/y/width/height controls, Delete, Undo, provider preset select, image-size select, and `Review AI Call`;
- Stage 2 exact target/mask/context/provider/model/image config/call estimate/plan-hash summary and one `Generate one candidate` button;
- Stage 3 shared job status, actual used call count, honest close/cancel copy, and no Retry button;
- Stage 4 real integrity/quality rows, warning confirmation, `Discard candidate`, and `Accept revision`;
- one polite `aria-live` region and disabled reasons through standard `title` plus accessible name/description semantics.

Every active control maps to one `onAction` type. Rendering must update existing nodes instead of rebuilding focused controls on filmstrip ticks.

- [ ] **Step 4: Integrate the rail without destroying Recipe or Canvas state**

In `repairWorkbenchPanel.js`:

- add `Repair Frame` to the filmstrip toolbar and enable it only for a real selected frame, saved project, valid managed asset, and no conflicting operation;
- mount `frameRepairPanel.element` inside the existing `editor-repair-recipe` aside;
- when active, hide/inert `recipeBody` and `aiAction`, show the Frame Repair element, change the trigger/aside accessible label to `Frame Repair`, and hide the normal bottom quality actions;
- when inactive, restore the exact prior Recipe/AI Action/quality DOM and drawer state;
- route primary Canvas pointer down/move/up/cancel to frame-repair rectangle actions only while active; keep normal Workbench pan otherwise;
- keep Before/After/Split/Difference/Onion and zoom controls; show only real mask/anchor/bounds overlays supported by the active model;
- mark the exact candidate filmstrip item with a visible `R` badge and accessible text `Repaired candidate`; other items remain unchanged;
- let repaired-clip playback use the candidate sheet while the project/parent revision remains unchanged.

In `shell.js`, construct the lifecycle/controller once, inject them into the Workbench controller/panel, pass the existing accepted-project callback, and reset/stop frame state on project/asset/scene/panel switch and `beforeunload`. Do not add logic to `renderAll()` beyond existing delegation.

- [ ] **Step 5: Add responsive, overflow, focus and reduced-motion CSS**

Use existing Editor tokens. Required selectors include:

```css
.editor-frame-repair-rail {
  min-width: 0;
  display: grid;
  gap: 12px;
}

.editor-frame-repair-steps {
  min-width: 0;
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.editor-frame-repair-step {
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.editor-frame-repair-step[aria-current="step"] {
  border-color: #75f0d3;
  background: rgba(117, 240, 211, 0.1);
}

.editor-frame-repair-mask-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.editor-frame-repair-call-summary,
.editor-frame-repair-quality {
  min-width: 0;
  display: grid;
  gap: 6px;
  overflow-wrap: anywhere;
}

.editor-repair-frame-option[data-repaired="true"] {
  position: relative;
}

.editor-repair-frame-option[data-repaired="true"]::after {
  content: "R";
  position: absolute;
  inset: 3px 3px auto auto;
  min-width: 16px;
  border-radius: 999px;
  color: #101114;
  background: #75f0d3;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
```

Desktop keeps the existing 340 px rail and fills available vertical space. At `max-width: 760px`, use the existing Recipe modal drawer/backdrop/focus trap, not a new overlay. Ensure 390 px has no horizontal overflow, long ids/hash/reasons wrap, the filmstrip scrolls internally, focus rings remain visible, and reduced-motion disables stage/badge transitions.

- [ ] **Step 6: Update smoke markers and run focused/full/smoke verification**

Extend `scripts/smoke-local-ui.mjs` to fetch `frameRepairPanel.js`, `frameRepairController.js`, and `api.js`, and assert the four stage markers plus `/frame-repair/plan`, `/frame-repair/operations/`, and specialized `/accept`. Do not submit a live request.

Run: `npm run test:focused -- test/editor-project/editorFrameRepairPanel.test.js test/editor-project/editorFrameRepairController.test.js test/editor-project/editorFrameRepairLifecycle.test.js test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorRepairWorkbenchController.test.js test/editor-project/editorShellStructure.test.js test/localSmokeScript.test.js`

Expected: PASS.

Run: `npm test`

Expected: complete guarded suite PASS and actual count reported.

Run: `npm run smoke:local`

Expected: PASS with no real provider call; tracked server process exits within the guard.

- [ ] **Step 7: Perform the required real-render design verification**

Use the project-standard in-app Browser control path with one tracked local server. Create/import a real deterministic Character Pack fixture through existing APIs, open `/editor`, enter Repair, then verify:

| Viewport | Required evidence |
| --- | --- |
| `1440×900` | Canvas remains dominant; rail is 340 px; all four stages visible; no page clipping; real selected-frame mask visible. |
| `2048×963` | Canvas centers the 96×96 frame with nearest-neighbor scaling; rail/filmstrip do not stretch incorrectly. |
| `390×844` | Existing drawer fills the safe width; no horizontal overflow; focus trap, Escape/backdrop close, focus return, long error text, and filmstrip scroll work. |

Network/mutation proof:

1. Enter, select frame, edit rectangles/instruction, change comparison/zoom/playback: zero Plan/live/Accept POST and no project/history/dirty mutation.
2. Click Review once: exactly one provider-free Plan POST.
3. Use an injected/deterministic local provider harness for UI verification: exactly one live POST, one operation id, one candidate; no real provider spend.
4. Review all comparison modes and candidate playback.
5. Accept once: exactly one specialized Accept POST, no general import, one child revision, `processing_recipe_ref: null`.
6. Confirm console has zero product errors/warnings and no pending server/browser process remains.

Record every visual/content/interaction deviation from the approved design with a reason. If the rail or mobile drawer cannot match, stop rather than silently redesign.

- [ ] **Step 8: Commit the Workbench UI**

```bash
git status --short
git add src/ui/editor/frameRepairPanel.js src/ui/editor/repairWorkbenchPanel.js src/ui/editor/shell.js src/ui/editor/editor.css scripts/smoke-local-ui.mjs test/editor-project/editorFrameRepairPanel.test.js test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorShellStructure.test.js test/localSmokeScript.test.js
git commit -m "feat: add frame repair workbench ui"
```

### Task 14: Closeout Runbook, Binding Audit, And Final Evidence

**Files:**
- Create: `docs/runbooks/targeted-frame-repair-v1.md`
- Modify: `docs/runbooks/README.md`
- Modify: `docs/roadmap/technology-reference-roadmap.md`
- Modify: `docs/superpowers/specs/2026-07-11-targeted-frame-repair-v1-design.md`

- [ ] **Step 1: Write the runbook from actual evidence, not planned claims**

The runbook must record:

- final commit baseline and branch/worktree lineage;
- approved visual sources and 1:1/deviation log;
- real routes, artifact files, ledger root, job/call states, and specialized Accept;
- complete UI/control-to-request/provider/pipeline binding table;
- capability truth table, including semantic diagnosis and live quality limitations;
- pass/warning/fail/unknown, conflict, provider failure, outcome unknown, reload/restart recovery, and discard behavior;
- exact focused/full/smoke counts, durations, peak RSS, browser viewports, console/network evidence, and stopped process confirmation;
- protected Character Pack/provider/validator/exporter/job-enum files left unchanged;
- missing fields, fallbacks, dependency/attribution status, IP/naming scan, and residual risks.

Do not write pass counts, screenshots, quality rates, or “implemented” claims until they exist.

- [ ] **Step 2: Update governance documents honestly**

After all verification passes:

- mark the design spec `Implemented and verified` and add the implementation commit range;
- update roadmap item #33 to state that deterministic mask/pixel-integrity/acceptance MVP is implemented;
- keep live first-call quality explicitly `Experimental/opt-in` until the separately authorized benchmark reaches the approved threshold;
- add a dated roadmap update-log row;
- link the new runbook from `docs/runbooks/README.md`.

- [ ] **Step 3: Run final guarded verification serially**

Run: `git status --short`

Expected: only intended task files plus the known unrelated untracked files; no generated/browser evidence staged.

Run: `git diff --check`

Expected: no output.

Run: `npm run test:focused -- test/editor-project/editorFrameRepairProtocol.test.js test/editor-project/editorFrameRepairMask.test.js test/editor-project/editorFrameRepairPlan.test.js test/editor-project/editorFrameRepairProvider.test.js test/editor-project/editorFrameRepairComposite.test.js test/editor-project/editorNormalizedCharacterSheetPackage.test.js test/editor-project/editorFrameRepairArtifacts.test.js test/editor-project/editorFrameRepairOperationLedger.test.js test/editor-project/editorFrameRepairService.test.js test/editor-project/editorFrameRepairCoordinator.test.js test/editor-project/editorFrameRepairAcceptance.test.js test/editor-project/editorFrameRepairApi.test.js test/editor-project/editorFrameRepairServerWiring.test.js test/editor-project/editorFrameRepairState.test.js test/editor-project/editorFrameRepairLifecycle.test.js test/editor-project/editorFrameRepairCanvas.test.js test/editor-project/editorFrameRepairController.test.js test/editor-project/editorFrameRepairPanel.test.js`

Expected: all focused tests PASS within 60 seconds and 1536 MiB RSS. If this legitimate focused set exceeds the existing limit, split it into two serial guarded focused commands; do not raise the ceiling without user approval.

Run: `npm test`

Expected: complete guarded suite PASS, actual count/duration/peak RSS recorded.

Run: `npm run smoke:local`

Expected: PASS, no provider call, server exits cleanly.

- [ ] **Step 4: Run final static safety and contract scans**

Run targeted `rg` scans over only changed source/docs/tests for:

- unfinished/mock markers;
- restricted competitor/product names;
- API keys, bearer tokens, base64 data, prompt/request/provider runtime leakage;
- `processSheetBuffer` imports in the normalized packager;
- automatic retry/fallback loops in Frame Repair;
- new dependencies/lockfile/`ATTRIBUTIONS.md` changes;
- direct project JSON writes from UI;
- operation ledger paths under `/generated`;
- fetch/decode/hash/layout reads inside Canvas RAF/draw functions.

Expected: zero unexplained findings. Record any legitimate literal used only in a security test fixture.

- [ ] **Step 5: Review the final diff and commit closeout docs**

```bash
git status --short
git diff --stat
git diff -- src/editor-project src/ui/editor server.js scripts/smoke-local-ui.mjs docs test/editor-project
git add docs/runbooks/targeted-frame-repair-v1.md docs/runbooks/README.md docs/roadmap/technology-reference-roadmap.md docs/superpowers/specs/2026-07-11-targeted-frame-repair-v1-design.md
git commit -m "docs: close targeted frame repair v1"
```

Do not stage local screenshots, `.superpowers/`, generated artifacts, workspace runtime data, or duplicate `* 2.*` files.

## Post-MVP Live Quality Gate — Do Not Run Automatically

This is deliberately outside Tasks 1–14. Before any real call:

1. Ask the user for explicit authorization, exact provider preset, sample ownership confirmation, and a maximum call budget between 8 and 12.
2. Use only user-owned or repository-owned frames; do not import the previously analyzed external package assets.
3. Record first-call results only, with no fallback or retry.
4. Require zero pixel-integrity violations and zero calls above budget.
5. Require at least 70% of completed first-call candidates to be visibly improved and usable or honestly review-required without a new blocker.
6. Publish per-category results and failures. If the threshold fails, keep live entry `Experimental/opt-in`; deterministic local safety may remain shipped.

## Final Definition Of Done

- Exact canonical frame/clip/mask/plan identity is server-authoritative and visible.
- Plan consumes zero provider calls; one confirmation consumes at most one; a successful job has exactly one candidate.
- Replay, lost response, refresh, and server restart never cause an implicit second call.
- Provider changes outside the mask cannot enter the patched sheet.
- Decoded non-target and target-outside-mask RGBA equality is recomputed at generation and Accept.
- The exact patched normalized sheet is packaged without normalization, stabilization, correction, nudge, or fabricated Recipe evidence.
- The accepted child retains the fixed inspection artifacts, multi-resolution sheets, main Character Pack ZIP, and Godot/RPG Maker/OCAD export ZIPs.
- Result review uses real Canvas modes, candidate filmstrip playback, integrity/quality artifacts, and honest state gates.
- Specialized Accept creates one immutable child with `processing_recipe_ref: null`; every failure/discard leaves project JSON/history unchanged.
- Existing Workbench Recipe/AI Action state and all prior product routes remain available.
- Desktop/mobile browser evidence, focused/full tests, smoke, resource limits, static scans, binding audit, deviation log, and runbook are complete.
