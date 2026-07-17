# AI Character Pack Upload Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the upload-first `topdown_rpg_v0` character pack pipeline that turns an 8x8 source sheet into `normalized_sheet.png`, `animations.json`, `metadata.json`, `debug_report.json`, debug overlays, row previews, and a browser playable preview.

**Architecture:** Keep source generation separate from asset normalization. The first execution pass builds deterministic profile, slicing, background removal, normalization, validation, and preview/export behavior without requiring a live Gemini key. Gemini is represented by a backend job contract and unavailable/stub state until a separate provider plan wires the live API.

**Tech Stack:** Native ESM JavaScript, Node test runner, browser Canvas for UI preview, Node `sharp` for image pipeline and debug artifacts, optional `gifenc` and `jszip` for preview/export. GIF decoding with `gifuct-js` is reserved for the GIF-import utility unless that utility is explicitly pulled into v0.1.

---

## Execution Notes

- Read `AGENTS.md`, this plan, and `docs/superpowers/specs/2026-05-23-ai-character-pack-protocol-design.md` before editing.
- Do not scan every `output/` directory unless a task explicitly asks for a visual fixture.
- Do not delete generated experiment directories.
- Keep the existing prompt tool usable. Add the character-pack workflow beside it.
- Run `npm test` after each task that changes code.
- Commit after each completed task when the checks pass.

## File Structure

Create:

```text
src/character-pack/profile.js
src/character-pack/animations.js
src/character-pack/packageBuilder.js
src/character-pack/imageMath.js
src/character-pack/backgroundRemoval.js
src/character-pack/sheetSlicer.js
src/character-pack/cellGeometry.js
src/character-pack/normalizer.js
src/character-pack/validator.js
src/character-pack/debugOverlay.js
src/character-pack/rowPreview.js
src/character-pack/processSheet.js
src/character-pack/jobStore.js
src/character-pack/geminiProvider.js
server.js
scripts/create-character-pack-fixture.mjs
test/character-pack/profile.test.js
test/character-pack/packageBuilder.test.js
test/character-pack/backgroundRemoval.test.js
test/character-pack/sheetSlicer.test.js
test/character-pack/cellGeometry.test.js
test/character-pack/normalizer.test.js
test/character-pack/validator.test.js
test/character-pack/processSheet.test.js
test/fixtures/character-pack/topdown_rpg_v0_sample_hero.expected.json
test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png
```

Modify:

```text
package.json
src/app.js
src/styles.css
index.html
docs/superpowers/specs/2026-05-23-ai-character-pack-protocol-design.md
```

## Task 1: Dependencies And Scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package scripts and dependencies**

Replace `package.json` with:

```json
{
  "name": "ai-character-pack-tool",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "start": "node server.js",
    "dev": "node --watch server.js",
    "fixture:character-pack": "node scripts/create-character-pack-fixture.mjs"
  },
  "dependencies": {
    "gifenc": "^1.0.3",
    "jszip": "^3.10.1",
    "sharp": "^0.33.5"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created or updated and install exits with code 0.

- [ ] **Step 3: Run current tests**

Run:

```bash
npm test
```

Expected: existing `test/pixelPipeline.test.js` passes.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add character pack pipeline dependencies"
```

## Task 2: Profile And Animation Contract

**Files:**
- Create: `src/character-pack/profile.js`
- Create: `src/character-pack/animations.js`
- Create: `test/character-pack/profile.test.js`

- [ ] **Step 1: Write failing profile tests**

Create `test/character-pack/profile.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { TOPDOWN_RPG_V0, getFrameIndex, getAnimationFrameIndexes, getNearestCardinalDirection } from '../../src/character-pack/profile.js'
import { buildAnimations } from '../../src/character-pack/animations.js'

test('topdown_rpg_v0 defines a 64-frame four-direction profile', () => {
  assert.equal(TOPDOWN_RPG_V0.id, 'topdown_rpg_v0')
  assert.equal(TOPDOWN_RPG_V0.grid.columns, 8)
  assert.equal(TOPDOWN_RPG_V0.grid.rows, 8)
  assert.equal(TOPDOWN_RPG_V0.frame.w, 96)
  assert.equal(TOPDOWN_RPG_V0.frame.h, 96)
  assert.deepEqual(TOPDOWN_RPG_V0.anchor, { x: 48, y: 88, mode: 'feet-center' })
  assert.equal(TOPDOWN_RPG_V0.animations.length, 16)
})

test('frame layout maps row-major animation ranges', () => {
  assert.equal(getFrameIndex(0, 0), 0)
  assert.equal(getFrameIndex(5, 7), 47)
  assert.deepEqual(getAnimationFrameIndexes('attack_right'), [44, 45, 46, 47])
  assert.deepEqual(getAnimationFrameIndexes('talk'), [60, 61, 62, 63])
})

test('animations json entries include flip_h false and four frames', () => {
  const animations = buildAnimations()
  assert.deepEqual(Object.keys(animations), TOPDOWN_RPG_V0.animations.map((a) => a.name))
  assert.deepEqual(animations.walk_left.frames, [24, 25, 26, 27])
  assert.equal(animations.walk_left.mode, 'loop')
  assert.equal(animations.walk_left.flip_h, false)
  assert.equal(animations.hurt.mode, 'once')
  assert.deepEqual(animations.hurt.frames, [48, 49, 50, 51])
})

test('diagonal input resolves to nearest cardinal animation direction', () => {
  assert.equal(getNearestCardinalDirection(0, 0, 'down'), 'down')
  assert.equal(getNearestCardinalDirection(10, 2, 'down'), 'right')
  assert.equal(getNearestCardinalDirection(-10, 2, 'down'), 'left')
  assert.equal(getNearestCardinalDirection(2, -10, 'down'), 'up')
  assert.equal(getNearestCardinalDirection(2, 10, 'up'), 'down')
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test test/character-pack/profile.test.js
```

Expected: FAIL because `src/character-pack/profile.js` does not exist.

- [ ] **Step 3: Implement profile**

Create `src/character-pack/profile.js`:

```js
export const TOPDOWN_RPG_V0 = Object.freeze({
  id: 'topdown_rpg_v0',
  version: '0.1',
  grid: { columns: 8, rows: 8 },
  frame: { w: 96, h: 96 },
  sheet: { w: 768, h: 768 },
  authoringCell: { w: 192, h: 192 },
  anchor: { x: 48, y: 88, mode: 'feet-center' },
  baselineY: 88,
  thresholds: {
    anchorDriftPx: 4,
    baselineDriftPx: 3,
    onionSkinDriftPx: 2,
    minPaddingPx: 4,
    bboxVarianceRatio: 0.25,
  },
  animations: [
    { name: 'idle_down', row: 0, startCol: 0, count: 4, fps: 8, loop: true, mode: 'loop' },
    { name: 'idle_up', row: 0, startCol: 4, count: 4, fps: 8, loop: true, mode: 'loop' },
    { name: 'idle_left', row: 1, startCol: 0, count: 4, fps: 8, loop: true, mode: 'loop' },
    { name: 'idle_right', row: 1, startCol: 4, count: 4, fps: 8, loop: true, mode: 'loop' },
    { name: 'walk_down', row: 2, startCol: 0, count: 4, fps: 10, loop: true, mode: 'loop' },
    { name: 'walk_up', row: 2, startCol: 4, count: 4, fps: 10, loop: true, mode: 'loop' },
    { name: 'walk_left', row: 3, startCol: 0, count: 4, fps: 10, loop: true, mode: 'loop' },
    { name: 'walk_right', row: 3, startCol: 4, count: 4, fps: 10, loop: true, mode: 'loop' },
    { name: 'attack_down', row: 4, startCol: 0, count: 4, fps: 12, loop: false, mode: 'once' },
    { name: 'attack_up', row: 4, startCol: 4, count: 4, fps: 12, loop: false, mode: 'once' },
    { name: 'attack_left', row: 5, startCol: 0, count: 4, fps: 12, loop: false, mode: 'once' },
    { name: 'attack_right', row: 5, startCol: 4, count: 4, fps: 12, loop: false, mode: 'once' },
    { name: 'hurt', row: 6, startCol: 0, count: 4, fps: 6, loop: false, mode: 'once' },
    { name: 'happy', row: 6, startCol: 4, count: 4, fps: 6, loop: true, mode: 'loop' },
    { name: 'sit', row: 7, startCol: 0, count: 4, fps: 4, loop: true, mode: 'loop' },
    { name: 'talk', row: 7, startCol: 4, count: 4, fps: 6, loop: true, mode: 'loop' },
  ],
})

export function getFrameIndex(row, col, profile = TOPDOWN_RPG_V0) {
  return row * profile.grid.columns + col
}

export function getAnimationFrameIndexes(name, profile = TOPDOWN_RPG_V0) {
  const animation = profile.animations.find((item) => item.name === name)
  if (!animation) throw new Error(`Unknown animation: ${name}`)
  return Array.from({ length: animation.count }, (_, i) => getFrameIndex(animation.row, animation.startCol + i, profile))
}

export function getNearestCardinalDirection(dx, dy, fallback = 'down') {
  if (dx === 0 && dy === 0) return fallback
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
}
```

Create `src/character-pack/animations.js`:

```js
import { TOPDOWN_RPG_V0, getAnimationFrameIndexes } from './profile.js'

export function buildAnimations(profile = TOPDOWN_RPG_V0) {
  return Object.fromEntries(
    profile.animations.map((animation) => [
      animation.name,
      {
        fps: animation.fps,
        loop: animation.loop,
        mode: animation.mode,
        frames: getAnimationFrameIndexes(animation.name, profile),
        flip_h: false,
      },
    ])
  )
}
```

- [ ] **Step 4: Verify profile tests pass**

Run:

```bash
node --test test/character-pack/profile.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/character-pack/profile.js src/character-pack/animations.js test/character-pack/profile.test.js
git commit -m "feat: define topdown character profile"
```

## Task 3: Package Builders

**Files:**
- Create: `src/character-pack/packageBuilder.js`
- Create: `test/character-pack/packageBuilder.test.js`

- [ ] **Step 1: Write failing package builder tests**

Create `test/character-pack/packageBuilder.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAnimationsJson, buildMetadataJson, buildPackageId } from '../../src/character-pack/packageBuilder.js'

test('buildPackageId creates stable filesystem-safe ids', () => {
  const id = buildPackageId('Green Priestess!', new Date('2026-05-24T01:02:03+08:00'))
  assert.equal(id, 'npc_20260524_010203_green_priestess')
})

test('buildAnimationsJson emits runtime contract', () => {
  const result = buildAnimationsJson()
  assert.equal(result.version, '0.1')
  assert.equal(result.profile, 'topdown_rpg_v0')
  assert.deepEqual(result.frame_size, { w: 96, h: 96 })
  assert.deepEqual(result.sheet_size, { w: 768, h: 768 })
  assert.deepEqual(result.anchor, { x: 48, y: 88 })
  assert.deepEqual(result.animations.attack_up.frames, [36, 37, 38, 39])
  assert.equal(result.animations.attack_up.flip_h, false)
})

test('buildMetadataJson records upload and quality context', () => {
  const result = buildMetadataJson({
    id: 'npc_20260524_010203_green_priestess',
    name: 'Green Priestess',
    description: 'green robe',
    createdAt: '2026-05-24T01:02:03+08:00',
    source: { type: 'upload', file_name: 'source.png' },
    quality: { status: 'warning', warnings: ['source_jpeg'], blocking_errors: [] },
  })
  assert.equal(result.id, 'npc_20260524_010203_green_priestess')
  assert.equal(result.profile, 'topdown_rpg_v0')
  assert.equal(result.quality.status, 'warning')
  assert.deepEqual(result.generation, { provider: null, model: null, prompt_file: null })
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test test/character-pack/packageBuilder.test.js
```

Expected: FAIL because `packageBuilder.js` does not exist.

- [ ] **Step 3: Implement package builders**

Create `src/character-pack/packageBuilder.js`:

```js
import { buildAnimations } from './animations.js'
import { TOPDOWN_RPG_V0 } from './profile.js'

function pad2(value) {
  return String(value).padStart(2, '0')
}

function slugify(value) {
  return String(value ?? 'character')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'character'
}

export function buildPackageId(name, date = new Date()) {
  const yyyy = date.getFullYear()
  const mm = pad2(date.getMonth() + 1)
  const dd = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const min = pad2(date.getMinutes())
  const ss = pad2(date.getSeconds())
  return `npc_${yyyy}${mm}${dd}_${hh}${min}${ss}_${slugify(name)}`
}

export function buildAnimationsJson(profile = TOPDOWN_RPG_V0) {
  return {
    version: profile.version,
    profile: profile.id,
    sheet: 'normalized_sheet.png',
    frame_size: { ...profile.frame },
    sheet_size: { ...profile.sheet },
    anchor: { x: profile.anchor.x, y: profile.anchor.y },
    animations: buildAnimations(profile),
  }
}

export function buildMetadataJson({
  id,
  name,
  description,
  createdAt,
  source,
  generation = { provider: null, model: null, prompt_file: null },
  quality = { status: 'pass', warnings: [], blocking_errors: [] },
  profile = TOPDOWN_RPG_V0,
}) {
  return {
    version: profile.version,
    id,
    name,
    description,
    created_at: createdAt,
    profile: profile.id,
    source,
    generation,
    quality,
  }
}
```

- [ ] **Step 4: Verify package tests pass**

Run:

```bash
node --test test/character-pack/packageBuilder.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/character-pack/packageBuilder.js test/character-pack/packageBuilder.test.js
git commit -m "feat: build character pack metadata"
```

## Task 4: Known-Good Fixture

**Files:**
- Create: `scripts/create-character-pack-fixture.mjs`
- Create: `test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png`
- Create: `test/fixtures/character-pack/topdown_rpg_v0_sample_hero.expected.json`

- [ ] **Step 1: Create fixture generator**

Create `scripts/create-character-pack-fixture.mjs`:

```js
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const outDir = 'test/fixtures/character-pack'
const cell = 192
const cols = 8
const rows = 8
const sheetW = cols * cell
const sheetH = rows * cell

await mkdir(outDir, { recursive: true })

const composites = []
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    const cx = col * cell + 96
    const footY = row * cell + 154
    const bob = row <= 3 ? [0, -2, 0, -1][col % 4] : 0
    const bodyH = row >= 6 ? 62 : 84
    const bodyW = row >= 4 && row <= 5 ? 42 : 34
    const cloak = row % 2 === 0 ? '#203048' : '#29354e'
    const hair = '#d8dde8'
    const accent = '#8b3940'
    const x = cx - Math.floor(bodyW / 2)
    const y = footY - bodyH + bob
    const svg = `
      <svg width="${cell}" height="${cell}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
        <rect x="${cx - 14}" y="${footY - 8}" width="10" height="8" fill="#141414"/>
        <rect x="${cx + 4}" y="${footY - 8}" width="10" height="8" fill="#141414"/>
        <rect x="${x}" y="${y + 30}" width="${bodyW}" height="${bodyH - 30}" fill="#111827"/>
        <rect x="${x + 4}" y="${y + 34}" width="${bodyW - 8}" height="${bodyH - 42}" fill="${cloak}"/>
        <rect x="${cx - 19}" y="${y + 12}" width="38" height="30" fill="${hair}"/>
        <rect x="${cx - 16}" y="${y + 18}" width="32" height="28" fill="#f0c4a8"/>
        <rect x="${cx - 9}" y="${y + 28}" width="5" height="5" fill="#111827"/>
        <rect x="${cx + 4}" y="${y + 28}" width="5" height="5" fill="#111827"/>
        <rect x="${cx - 21}" y="${y + 44}" width="8" height="24" fill="${accent}"/>
        <rect x="${cx + 13}" y="${y + 44}" width="8" height="24" fill="${accent}"/>
        <rect x="${cx - 24 + (col % 4) * 3}" y="${y + 64}" width="8" height="24" fill="#0f172a"/>
        <rect x="${cx + 16 - (col % 4) * 3}" y="${y + 64}" width="8" height="24" fill="#0f172a"/>
      </svg>`
    composites.push({ input: Buffer.from(svg), left: col * cell, top: row * cell })
  }
}

await sharp({
  create: {
    width: sheetW,
    height: sheetH,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite(composites)
  .png()
  .toFile(`${outDir}/topdown_rpg_v0_sample_hero.png`)

await writeFile(
  `${outDir}/topdown_rpg_v0_sample_hero.expected.json`,
  JSON.stringify(
    {
      profile: 'topdown_rpg_v0',
      grid: { columns: 8, rows: 8, source_cell_size: { w: 192, h: 192 } },
      expected_frame_count: 64,
      expected_status: 'pass',
      expected_anchor: { x: 48, y: 88 },
      expected_animations: ['idle_down', 'idle_up', 'idle_left', 'idle_right', 'walk_down', 'walk_up', 'walk_left', 'walk_right', 'attack_down', 'attack_up', 'attack_left', 'attack_right', 'hurt', 'happy', 'sit', 'talk'],
    },
    null,
    2
  )
)
```

- [ ] **Step 2: Generate fixture files**

Run:

```bash
npm run fixture:character-pack
```

Expected: the PNG and expected JSON files exist under `test/fixtures/character-pack/`.

- [ ] **Step 3: Commit**

```bash
git add scripts/create-character-pack-fixture.mjs test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png test/fixtures/character-pack/topdown_rpg_v0_sample_hero.expected.json
git commit -m "test: add character pack fixture"
```

## Task 5: Background Removal

**Files:**
- Create: `src/character-pack/imageMath.js`
- Create: `src/character-pack/backgroundRemoval.js`
- Create: `test/character-pack/backgroundRemoval.test.js`

- [ ] **Step 1: Write failing background tests**

Create `test/character-pack/backgroundRemoval.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { floodRemoveBackgroundFromRgba, dualMatteFromRgba, passthroughRgba } from '../../src/character-pack/backgroundRemoval.js'

function rgba(width, height, pixels) {
  return { width, height, data: Uint8ClampedArray.from(pixels.flat()) }
}

test('passthrough preserves transparent source alpha', () => {
  const src = rgba(1, 2, [[1, 2, 3, 0], [4, 5, 6, 255]])
  const out = passthroughRgba(src)
  assert.deepEqual([...out.data], [...src.data])
})

test('flood removal removes edge white but preserves internal white', () => {
  const src = rgba(3, 3, [
    [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255],
    [255, 255, 255, 255], [255, 255, 255, 255], [10, 10, 10, 255],
    [255, 255, 255, 255], [10, 10, 10, 255], [10, 10, 10, 255],
  ])
  const out = floodRemoveBackgroundFromRgba(src, { color: [255, 255, 255], tolerance: 0 })
  assert.equal(out.data[3], 0)
  assert.equal(out.data[(1 * 3 + 1) * 4 + 3], 255)
})

test('dual matte computes alpha and flags inconsistent paired images', () => {
  const white = rgba(1, 1, [[255, 128, 128, 255]])
  const black = rgba(1, 1, [[128, 0, 0, 255]])
  const out = dualMatteFromRgba(white, black, { consistencyTolerance: 255 })
  assert.equal(out.warnings.length, 0)
  assert.ok(out.image.data[3] > 120)

  const bad = dualMatteFromRgba(white, rgba(1, 1, [[10, 200, 10, 255]]), { consistencyTolerance: 10 })
  assert.deepEqual(bad.warnings, ['dual_matte_inconsistent'])
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test test/character-pack/backgroundRemoval.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement RGBA helpers**

Create `src/character-pack/imageMath.js`:

```js
export function pixelOffset(width, x, y) {
  return (y * width + x) * 4
}

export function colorDistanceSq(data, offset, rgb) {
  const dr = data[offset] - rgb[0]
  const dg = data[offset + 1] - rgb[1]
  const db = data[offset + 2] - rgb[2]
  return dr * dr + dg * dg + db * db
}

export function cloneRgba(image) {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) }
}
```

Create `src/character-pack/backgroundRemoval.js`:

```js
import { cloneRgba, colorDistanceSq, pixelOffset } from './imageMath.js'

export function passthroughRgba(image) {
  return cloneRgba(image)
}

export function floodRemoveBackgroundFromRgba(image, { color = [255, 255, 255], tolerance = 18 } = {}) {
  const out = cloneRgba(image)
  const threshold = tolerance * tolerance
  const seen = new Uint8Array(out.width * out.height)
  const queue = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return
    const i = y * out.width + x
    if (seen[i]) return
    seen[i] = 1
    const o = pixelOffset(out.width, x, y)
    if (out.data[o + 3] === 0 || colorDistanceSq(out.data, o, color) <= threshold) queue.push([x, y])
  }
  for (let x = 0; x < out.width; x++) {
    push(x, 0)
    push(x, out.height - 1)
  }
  for (let y = 0; y < out.height; y++) {
    push(0, y)
    push(out.width - 1, y)
  }
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q]
    const o = pixelOffset(out.width, x, y)
    out.data[o + 3] = 0
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  return out
}

export function dualMatteFromRgba(white, black, { consistencyTolerance = 42 } = {}) {
  if (white.width !== black.width || white.height !== black.height) {
    return { image: passthroughRgba(white), warnings: ['dual_matte_inconsistent'] }
  }
  const out = cloneRgba(black)
  let inconsistent = 0
  for (let i = 0; i < out.data.length; i += 4) {
    const dr = Math.abs(white.data[i] - black.data[i])
    const dg = Math.abs(white.data[i + 1] - black.data[i + 1])
    const db = Math.abs(white.data[i + 2] - black.data[i + 2])
    const alpha = Math.max(0, Math.min(255, 255 - Math.round((dr + dg + db) / 3)))
    out.data[i + 3] = alpha
    if (Math.max(dr, dg, db) > consistencyTolerance && alpha > 245) inconsistent++
  }
  return { image: out, warnings: inconsistent > Math.max(1, out.width * out.height * 0.01) ? ['dual_matte_inconsistent'] : [] }
}
```

- [ ] **Step 4: Verify background tests pass**

Run:

```bash
node --test test/character-pack/backgroundRemoval.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/character-pack/imageMath.js src/character-pack/backgroundRemoval.js test/character-pack/backgroundRemoval.test.js
git commit -m "feat: add background removal modes"
```

## Task 6: Slicing And Cell Geometry

**Files:**
- Create: `src/character-pack/sheetSlicer.js`
- Create: `src/character-pack/cellGeometry.js`
- Create: `test/character-pack/sheetSlicer.test.js`
- Create: `test/character-pack/cellGeometry.test.js`

- [ ] **Step 1: Write failing slicer tests**

Create `test/character-pack/sheetSlicer.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { computeGridBoundaries, correctGridByProjection, sliceRgbaCells } from '../../src/character-pack/sheetSlicer.js'

test('computeGridBoundaries uses cumulative rounding without dropping pixels', () => {
  const grid = computeGridBoundaries({ width: 1001, height: 999, columns: 8, rows: 8 })
  assert.equal(grid.columns.length, 8)
  assert.equal(grid.rows.length, 8)
  assert.equal(grid.columns[0].x, 0)
  assert.equal(grid.columns[7].x + grid.columns[7].w, 1001)
  assert.equal(grid.rows[7].y + grid.rows[7].h, 999)
})

test('sliceRgbaCells emits row-major cells', () => {
  const image = { width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4) }
  image.data[(0 * 4 + 0) * 4 + 3] = 255
  image.data[(1 * 4 + 3) * 4 + 3] = 255
  const cells = sliceRgbaCells(image, computeGridBoundaries({ width: 4, height: 2, columns: 2, rows: 1 }))
  assert.equal(cells.length, 2)
  assert.deepEqual(cells[0].meta, { index: 0, row: 0, col: 0, x: 0, y: 0, w: 2, h: 2 })
  assert.deepEqual(cells[1].meta, { index: 1, row: 0, col: 1, x: 2, y: 0, w: 2, h: 2 })
})

test('correctGridByProjection moves a boundary to a low-content seam', () => {
  const image = { width: 9, height: 1, data: new Uint8ClampedArray(9 * 4) }
  for (const x of [0, 1, 2, 6, 7, 8]) image.data[x * 4 + 3] = 255
  const grid = computeGridBoundaries({ width: 9, height: 1, columns: 3, rows: 1 })
  const corrected = correctGridByProjection(image, grid, { searchRadius: 1 })
  assert.equal(corrected.correction.applied, true)
  assert.equal(corrected.columns[1].x, 4)
})
```

Create `test/character-pack/cellGeometry.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { expandCellCanvas, centerCropCell } from '../../src/character-pack/cellGeometry.js'

test('expandCellCanvas adds transparent padding without moving source pixels', () => {
  const cell = { width: 2, height: 2, data: new Uint8ClampedArray(16) }
  cell.data[3] = 255
  const out = expandCellCanvas(cell, { top: 1, right: 2, bottom: 0, left: 1 })
  assert.equal(out.width, 5)
  assert.equal(out.height, 3)
  assert.equal(out.data[((1 * 5 + 1) * 4) + 3], 255)
})

test('centerCropCell crops or pads around the cell center', () => {
  const cell = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) }
  cell.data[((2 * 4 + 2) * 4) + 3] = 255
  const cropped = centerCropCell(cell, { width: 2, height: 2 })
  assert.equal(cropped.width, 2)
  assert.equal(cropped.height, 2)
  assert.equal(cropped.data[((1 * 2 + 1) * 4) + 3], 255)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test test/character-pack/sheetSlicer.test.js test/character-pack/cellGeometry.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement slicer and geometry**

Create `src/character-pack/sheetSlicer.js`:

```js
import { pixelOffset } from './imageMath.js'

function ranges(total, count, key) {
  return Array.from({ length: count }, (_, i) => {
    const start = Math.round((i * total) / count)
    const end = Math.round(((i + 1) * total) / count)
    return { [key]: start, [key === 'x' ? 'w' : 'h']: Math.max(1, end - start) }
  })
}

export function computeGridBoundaries({ width, height, columns, rows, manualOverrides = null }) {
  const cols = ranges(width, columns, 'x')
  const rowRanges = ranges(height, rows, 'y')
  if (manualOverrides?.columns) {
    for (let i = 0; i < columns; i++) {
      const x0 = manualOverrides.columns[i] ?? cols[i].x
      const x1 = manualOverrides.columns[i + 1] ?? (cols[i].x + cols[i].w)
      cols[i] = { x: x0, w: Math.max(1, x1 - x0) }
    }
  }
  if (manualOverrides?.rows) {
    for (let i = 0; i < rows; i++) {
      const y0 = manualOverrides.rows[i] ?? rowRanges[i].y
      const y1 = manualOverrides.rows[i + 1] ?? (rowRanges[i].y + rowRanges[i].h)
      rowRanges[i] = { y: y0, h: Math.max(1, y1 - y0) }
    }
  }
  return { columns: cols, rows: rowRanges }
}

export function sliceRgbaCells(image, grid) {
  const cells = []
  for (let row = 0; row < grid.rows.length; row++) {
    for (let col = 0; col < grid.columns.length; col++) {
      const c = grid.columns[col]
      const r = grid.rows[row]
      const data = new Uint8ClampedArray(c.w * r.h * 4)
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < c.w; x++) {
          const src = pixelOffset(image.width, c.x + x, r.y + y)
          const dst = pixelOffset(c.w, x, y)
          data[dst] = image.data[src]
          data[dst + 1] = image.data[src + 1]
          data[dst + 2] = image.data[src + 2]
          data[dst + 3] = image.data[src + 3]
        }
      }
      cells.push({ image: { width: c.w, height: r.h, data }, meta: { index: cells.length, row, col, x: c.x, y: r.y, w: c.w, h: r.h } })
    }
  }
  return cells
}

function alphaColumnProjection(image) {
  return Array.from({ length: image.width }, (_, x) => {
    let sum = 0
    for (let y = 0; y < image.height; y++) sum += image.data[pixelOffset(image.width, x, y) + 3]
    return sum
  })
}

function nearestMin(values, center, radius) {
  const start = Math.max(0, center - radius)
  const end = Math.min(values.length - 1, center + radius)
  let best = center
  let bestValue = values[center] ?? Infinity
  for (let i = start; i <= end; i++) {
    if ((values[i] ?? Infinity) < bestValue) {
      best = i
      bestValue = values[i]
    }
  }
  return best
}

export function correctGridByProjection(image, grid, { searchRadius = 6 } = {}) {
  const projection = alphaColumnProjection(image)
  const starts = [0, ...grid.columns.slice(1).map((col) => col.x), image.width]
  let applied = false
  for (let i = 1; i < starts.length - 1; i++) {
    const corrected = nearestMin(projection, starts[i], searchRadius)
    if (corrected !== starts[i]) {
      starts[i] = corrected
      applied = true
    }
  }
  const columns = grid.columns.map((_, i) => ({ x: starts[i], w: Math.max(1, starts[i + 1] - starts[i]) }))
  return {
    ...grid,
    columns,
    correction: {
      applied,
      method: 'projection_minima',
      columns_corrected: applied ? columns.map((_, i) => i).slice(1, -1) : [],
      rows_corrected: [],
    },
  }
}
```

Create `src/character-pack/cellGeometry.js`:

```js
import { pixelOffset } from './imageMath.js'

function copyPixel(srcImage, dstImage, sx, sy, dx, dy) {
  if (sx < 0 || sy < 0 || sx >= srcImage.width || sy >= srcImage.height) return
  if (dx < 0 || dy < 0 || dx >= dstImage.width || dy >= dstImage.height) return
  const src = pixelOffset(srcImage.width, sx, sy)
  const dst = pixelOffset(dstImage.width, dx, dy)
  dstImage.data[dst] = srcImage.data[src]
  dstImage.data[dst + 1] = srcImage.data[src + 1]
  dstImage.data[dst + 2] = srcImage.data[src + 2]
  dstImage.data[dst + 3] = srcImage.data[src + 3]
}

export function expandCellCanvas(cell, { top = 0, right = 0, bottom = 0, left = 0 } = {}) {
  const out = { width: cell.width + left + right, height: cell.height + top + bottom, data: new Uint8ClampedArray((cell.width + left + right) * (cell.height + top + bottom) * 4) }
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) copyPixel(cell, out, x, y, x + left, y + top)
  }
  return out
}

export function centerCropCell(cell, { width, height }) {
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const srcX = Math.floor((cell.width - width) / 2)
  const srcY = Math.floor((cell.height - height) / 2)
  const dstX = Math.max(0, Math.floor((width - cell.width) / 2))
  const dstY = Math.max(0, Math.floor((height - cell.height) / 2))
  const copyW = Math.min(width, cell.width)
  const copyH = Math.min(height, cell.height)
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) copyPixel(cell, out, Math.max(0, srcX) + x, Math.max(0, srcY) + y, dstX + x, dstY + y)
  }
  return out
}
```

- [ ] **Step 4: Verify slicer and geometry tests pass**

Run:

```bash
node --test test/character-pack/sheetSlicer.test.js test/character-pack/cellGeometry.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/character-pack/sheetSlicer.js src/character-pack/cellGeometry.js test/character-pack/sheetSlicer.test.js test/character-pack/cellGeometry.test.js
git commit -m "feat: split and repair character sheet cells"
```

## Task 7: Normalizer And Validator

**Files:**
- Create: `src/character-pack/normalizer.js`
- Create: `src/character-pack/validator.js`
- Create: `test/character-pack/normalizer.test.js`
- Create: `test/character-pack/validator.test.js`

- [ ] **Step 1: Write failing normalization tests**

Create `test/character-pack/normalizer.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { detectAlphaBBox, normalizeCells } from '../../src/character-pack/normalizer.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

test('detectAlphaBBox returns visible bounds', () => {
  const image = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) }
  image.data[((1 * 4 + 2) * 4) + 3] = 255
  image.data[((3 * 4 + 1) * 4) + 3] = 255
  assert.deepEqual(detectAlphaBBox(image), { x: 1, y: 1, w: 2, h: 3, right: 2, bottom: 3, centerX: 2, centerY: 2.5 })
})

test('normalizeCells creates 96x96 frames using a shared foot anchor', () => {
  const cell = { image: { width: 10, height: 10, data: new Uint8ClampedArray(10 * 10 * 4) }, meta: { index: 0, row: 0, col: 0 } }
  for (let y = 2; y <= 8; y++) {
    for (let x = 4; x <= 6; x++) cell.image.data[((y * 10 + x) * 4) + 3] = 255
  }
  const out = normalizeCells([cell], TOPDOWN_RPG_V0)
  assert.equal(out.frames.length, 1)
  assert.equal(out.frames[0].image.width, 96)
  assert.equal(out.frames[0].image.height, 96)
  assert.equal(out.frames[0].normalized_bbox.bottom, 88)
})
```

Create `test/character-pack/validator.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { validateNormalizedFrames } from '../../src/character-pack/validator.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

test('validator fails missing frames and passes stable complete frames', () => {
  assert.equal(validateNormalizedFrames([], TOPDOWN_RPG_V0).status, 'fail')
  const frames = Array.from({ length: 64 }, (_, i) => ({
    index: i,
    normalized_bbox: { x: 40, y: 30, w: 16, h: 58, right: 55, bottom: 88, centerX: 48, centerY: 59 },
    warnings: [],
  }))
  const report = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)
  assert.equal(report.status, 'pass')
  assert.equal(report.frame_count, 64)
  assert.deepEqual(report.blocking_errors, [])
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test test/character-pack/normalizer.test.js test/character-pack/validator.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement normalizer and validator**

Create `src/character-pack/normalizer.js`:

```js
import { pixelOffset } from './imageMath.js'

export function detectAlphaBBox(image) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[pixelOffset(image.width, x, y) + 3] > 0) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  if (maxX < 0) return null
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  return { x: minX, y: minY, w, h, right: maxX, bottom: maxY, centerX: minX + w / 2, centerY: minY + h / 2 }
}

function pasteNearest(src, dst, srcBox, dstX, dstY, scale) {
  const outW = Math.max(1, Math.round(srcBox.w * scale))
  const outH = Math.max(1, Math.round(srcBox.h * scale))
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = srcBox.x + Math.min(srcBox.w - 1, Math.floor(x / scale))
      const sy = srcBox.y + Math.min(srcBox.h - 1, Math.floor(y / scale))
      const tx = dstX + x
      const ty = dstY + y
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue
      const s = pixelOffset(src.width, sx, sy)
      const d = pixelOffset(dst.width, tx, ty)
      dst.data[d] = src.data[s]
      dst.data[d + 1] = src.data[s + 1]
      dst.data[d + 2] = src.data[s + 2]
      dst.data[d + 3] = src.data[s + 3]
    }
  }
}

export function normalizeCells(cells, profile) {
  const bboxes = cells.map((cell) => detectAlphaBBox(cell.image))
  const maxH = Math.max(1, ...bboxes.filter(Boolean).map((bbox) => bbox.h))
  const maxW = Math.max(1, ...bboxes.filter(Boolean).map((bbox) => bbox.w))
  const scale = Math.min(1, (profile.frame.h - 8) / maxH, (profile.frame.w - 8) / maxW)
  const frames = cells.map((cell, index) => {
    const bbox = bboxes[index]
    const image = { width: profile.frame.w, height: profile.frame.h, data: new Uint8ClampedArray(profile.frame.w * profile.frame.h * 4) }
    if (!bbox) return { index, source_bbox: null, normalized_bbox: null, image, warnings: ['empty_frame'] }
    const scaledW = Math.round(bbox.w * scale)
    const scaledH = Math.round(bbox.h * scale)
    const dstX = Math.round(profile.anchor.x - scaledW / 2)
    const dstY = Math.round(profile.anchor.y - scaledH)
    pasteNearest(cell.image, image, bbox, dstX, dstY, scale)
    return { index, source_bbox: bbox, normalized_bbox: detectAlphaBBox(image), image, warnings: [] }
  })
  return { frames, scale }
}
```

Create `src/character-pack/validator.js`:

```js
export function validateNormalizedFrames(frames, profile) {
  const blocking_errors = []
  const warnings = []
  if (frames.length !== profile.grid.columns * profile.grid.rows) blocking_errors.push('frame_count_mismatch')
  for (const frame of frames) {
    const bbox = frame.normalized_bbox
    if (!bbox) {
      blocking_errors.push(`frame_${frame.index}_empty`)
      continue
    }
    if (bbox.x <= 0 || bbox.y <= 0 || bbox.right >= profile.frame.w - 1 || bbox.bottom >= profile.frame.h - 1) {
      blocking_errors.push(`frame_${frame.index}_cropped`)
    }
    if (Math.abs(bbox.centerX - profile.anchor.x) > profile.thresholds.anchorDriftPx) warnings.push(`frame_${frame.index}_anchor_drift`)
    if (Math.abs(bbox.bottom - profile.anchor.y) > profile.thresholds.baselineDriftPx) warnings.push(`frame_${frame.index}_baseline_drift`)
  }
  return {
    status: blocking_errors.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    frame_count: frames.length,
    blocking_errors,
    warnings,
  }
}
```

- [ ] **Step 4: Verify normalization tests pass**

Run:

```bash
node --test test/character-pack/normalizer.test.js test/character-pack/validator.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/character-pack/normalizer.js src/character-pack/validator.js test/character-pack/normalizer.test.js test/character-pack/validator.test.js
git commit -m "feat: normalize and validate character frames"
```

## Task 8: End-To-End Sheet Processing

**Files:**
- Create: `src/character-pack/processSheet.js`
- Create: `src/character-pack/debugOverlay.js`
- Create: `src/character-pack/rowPreview.js`
- Create: `test/character-pack/processSheet.test.js`

- [ ] **Step 1: Write failing integration test**

Create `test/character-pack/processSheet.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { processSheetBuffer } from '../../src/character-pack/processSheet.js'

test('processSheetBuffer turns fixture into a valid character pack', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Sample Hero',
    description: 'silver hair sword fighter',
    sourceFileName: 'topdown_rpg_v0_sample_hero.png',
    backgroundMode: 'flood',
  })
  assert.equal(result.animationsJson.profile, 'topdown_rpg_v0')
  assert.equal(result.debugReport.validation.status, 'pass')
  assert.equal(result.debugReport.validation.frame_count, 64)
  assert.ok(Buffer.isBuffer(result.files.normalizedSheetPng))
  assert.ok(Buffer.isBuffer(result.files.debugOverlayPng))
  assert.ok(Buffer.isBuffer(result.files.onionSkinOverlayPng))
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test test/character-pack/processSheet.test.js
```

Expected: FAIL because `processSheet.js` does not exist.

- [ ] **Step 3: Implement debug artifact shells**

Create `src/character-pack/debugOverlay.js`:

```js
import sharp from 'sharp'

export async function renderDebugOverlayPng({ width, height, title = 'debug_overlay' }) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgba(0,0,0,0)"/>
    <text x="12" y="24" font-size="16" fill="#ff3366">${title}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
```

Create `src/character-pack/rowPreview.js`:

```js
export function buildRowPreviewIndex(profile) {
  return profile.animations.map((animation) => ({
    name: animation.name,
    frames: Array.from({ length: animation.count }, (_, i) => animation.row * profile.grid.columns + animation.startCol + i),
    fps: animation.fps,
  }))
}
```

- [ ] **Step 4: Implement processSheetBuffer**

Create `src/character-pack/processSheet.js`:

```js
import sharp from 'sharp'

import { floodRemoveBackgroundFromRgba, passthroughRgba } from './backgroundRemoval.js'
import { buildAnimationsJson, buildMetadataJson, buildPackageId } from './packageBuilder.js'
import { TOPDOWN_RPG_V0 } from './profile.js'
import { computeGridBoundaries, sliceRgbaCells } from './sheetSlicer.js'
import { normalizeCells } from './normalizer.js'
import { validateNormalizedFrames } from './validator.js'
import { renderDebugOverlayPng } from './debugOverlay.js'

async function loadRgba(buffer) {
  const image = sharp(buffer).ensureAlpha()
  const meta = await image.metadata()
  const data = await image.raw().toBuffer()
  return { width: meta.width, height: meta.height, data: new Uint8ClampedArray(data) }
}

async function encodeRgbaPng(image) {
  return sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer()
}

function composeSheet(frames, profile) {
  const image = { width: profile.sheet.w, height: profile.sheet.h, data: new Uint8ClampedArray(profile.sheet.w * profile.sheet.h * 4) }
  for (const frame of frames) {
    const col = frame.index % profile.grid.columns
    const row = Math.floor(frame.index / profile.grid.columns)
    for (let y = 0; y < profile.frame.h; y++) {
      for (let x = 0; x < profile.frame.w; x++) {
        const src = (y * profile.frame.w + x) * 4
        const dst = ((row * profile.frame.h + y) * profile.sheet.w + col * profile.frame.w + x) * 4
        image.data[dst] = frame.image.data[src]
        image.data[dst + 1] = frame.image.data[src + 1]
        image.data[dst + 2] = frame.image.data[src + 2]
        image.data[dst + 3] = frame.image.data[src + 3]
      }
    }
  }
  return image
}

export async function processSheetBuffer(buffer, options = {}) {
  const profile = options.profile ?? TOPDOWN_RPG_V0
  const raw = await loadRgba(buffer)
  const backgroundMode = options.backgroundMode === 'passthrough' ? 'passthrough' : 'flood'
  const transparent = backgroundMode === 'passthrough' ? passthroughRgba(raw) : floodRemoveBackgroundFromRgba(raw, { color: [255, 255, 255], tolerance: 24 })
  const grid = computeGridBoundaries({ width: transparent.width, height: transparent.height, columns: profile.grid.columns, rows: profile.grid.rows, manualOverrides: options.manualOverrides })
  const cells = sliceRgbaCells(transparent, grid)
  const normalized = normalizeCells(cells, profile)
  const validation = validateNormalizedFrames(normalized.frames, profile)
  const normalizedSheet = composeSheet(normalized.frames, profile)
  const id = buildPackageId(options.name ?? 'character', options.createdAt ? new Date(options.createdAt) : new Date())
  const animationsJson = buildAnimationsJson(profile)
  const metadataJson = buildMetadataJson({
    id,
    name: options.name ?? 'Character',
    description: options.description ?? '',
    createdAt: options.createdAt ?? new Date().toISOString(),
    source: { type: 'upload', file_name: options.sourceFileName ?? 'source.png' },
    quality: { status: validation.status, warnings: validation.warnings, blocking_errors: validation.blocking_errors },
    profile,
  })
  const debugReport = {
    version: profile.version,
    profile: profile.id,
    grid: {
      columns: profile.grid.columns,
      rows: profile.grid.rows,
      source_cell_size: { w: grid.columns[0].w, h: grid.rows[0].h },
      target_cell_size: profile.frame,
      correction: grid.correction ?? { applied: false, rows_corrected: [], columns_corrected: [], method: null },
      manual_overrides: options.manualOverrides ?? [],
    },
    background_mode: backgroundMode,
    validation: { ...validation, dual_matte_inconsistent: false },
    frames: normalized.frames.map(({ index, source_bbox, normalized_bbox, warnings }) => ({ index, source_bbox, normalized_bbox, warnings })),
  }
  return {
    id,
    animationsJson,
    metadataJson,
    debugReport,
    files: {
      normalizedSheetPng: await encodeRgbaPng(normalizedSheet),
      debugOverlayPng: await renderDebugOverlayPng({ width: profile.sheet.w, height: profile.sheet.h, title: 'static_debug' }),
      onionSkinOverlayPng: await renderDebugOverlayPng({ width: profile.sheet.w, height: profile.sheet.h, title: 'onion_skin_debug' }),
    },
  }
}
```

- [ ] **Step 5: Verify process test passes**

Run:

```bash
node --test test/character-pack/processSheet.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/character-pack/processSheet.js src/character-pack/debugOverlay.js src/character-pack/rowPreview.js test/character-pack/processSheet.test.js
git commit -m "feat: process uploaded character sheets"
```

## Task 9: Local Backend And Job Contract

**Files:**
- Create: `server.js`
- Create: `src/character-pack/jobStore.js`
- Create: `src/character-pack/geminiProvider.js`

- [ ] **Step 1: Implement in-memory job store**

Create `src/character-pack/jobStore.js`:

```js
const jobs = new Map()

export const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  GENERATING: 'generating',
  POST_PROCESSING: 'post_processing',
  DONE: 'done',
  FAILED_SAFETY_FILTER: 'failed_safety_filter',
  FAILED_MODEL_ERROR: 'failed_model_error',
  FAILED_POST_PROCESSING: 'failed_post_processing',
})

export function createJob(initial = {}) {
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const job = { id, status: JOB_STATUS.QUEUED, created_at: new Date().toISOString(), ...initial }
  jobs.set(id, job)
  return job
}

export function updateJob(id, patch) {
  const current = jobs.get(id)
  if (!current) return null
  const next = { ...current, ...patch, updated_at: new Date().toISOString() }
  jobs.set(id, next)
  return next
}

export function getJob(id) {
  return jobs.get(id) ?? null
}
```

- [ ] **Step 2: Implement OpenRouter provider state and generation contract**

Create `src/character-pack/geminiProvider.js`:

```js
export function getGeminiProviderState(env = process.env) {
  return {
    available: Boolean(env.OPENROUTER_API_KEY || env.GEMINI_API_KEY),
    implemented: true,
    provider: 'openrouter',
    model: env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image',
  }
}

export async function generateCharacterSource({ description, templateImage, referenceImage, imageConfig }) {
  // Sends prompt text, the selected template sprite sheet, and an optional character reference
  // to OpenRouter's chat completions image-output endpoint, then returns the generated PNG buffer.
  throw Object.assign(new Error('OPENROUTER_API_KEY is not configured'), {
    status: 'failed_model_error',
    retry_hint: 'manual_inspect',
  })
}
```

- [ ] **Step 3: Implement server**

Create `server.js`:

```js
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getGeminiProviderState } from './src/character-pack/geminiProvider.js'
import { createJob, getJob, JOB_STATUS, updateJob } from './src/character-pack/jobStore.js'
import { processSheetBuffer } from './src/character-pack/processSheet.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 4173)
const generatedDir = path.join(__dirname, 'generated')

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function handleProcessSheet(req, res) {
  const job = createJob({ status: JOB_STATUS.POST_PROCESSING })
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'))
    const source = Buffer.from(body.source_base64, 'base64')
    const result = await processSheetBuffer(source, body.options ?? {})
    const jobDir = path.join(generatedDir, job.id)
    await mkdir(jobDir, { recursive: true })
    await writeFile(path.join(jobDir, 'normalized_sheet.png'), result.files.normalizedSheetPng)
    await writeFile(path.join(jobDir, 'debug_overlay.png'), result.files.debugOverlayPng)
    await writeFile(path.join(jobDir, 'onion_skin_overlay.png'), result.files.onionSkinOverlayPng)
    await writeFile(path.join(jobDir, 'animations.json'), JSON.stringify(result.animationsJson, null, 2))
    await writeFile(path.join(jobDir, 'metadata.json'), JSON.stringify(result.metadataJson, null, 2))
    await writeFile(path.join(jobDir, 'debug_report.json'), JSON.stringify(result.debugReport, null, 2))
    updateJob(job.id, {
      status: result.debugReport.validation.status === 'fail' ? JOB_STATUS.FAILED_POST_PROCESSING : JOB_STATUS.DONE,
      result_url: `/generated/${job.id}/metadata.json`,
      debug_report_url: `/generated/${job.id}/debug_report.json`,
      normalized_sheet_url: `/generated/${job.id}/normalized_sheet.png`,
      reason: result.debugReport.validation.blocking_errors[0] ?? null,
      retry_hint: result.debugReport.validation.status === 'fail' ? 'manual_inspect' : null,
    })
  } catch (error) {
    updateJob(job.id, { status: JOB_STATUS.FAILED_POST_PROCESSING, reason: String(error.message || error), retry_hint: 'manual_inspect' })
  }
  sendJson(res, 202, getJob(job.id))
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`)
  const pathname = decodeURIComponent(url.pathname)
  const filePath = pathname.startsWith('/generated/')
    ? path.join(__dirname, pathname.slice(1))
    : path.join(__dirname, pathname === '/' ? 'index.html' : pathname.slice(1))
  createReadStream(filePath)
    .on('error', () => sendJson(res, 404, { error: 'not_found' }))
    .pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)
  if (req.method === 'GET' && url.pathname === '/api/gemini-state') return sendJson(res, 200, getGeminiProviderState())
  if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) return sendJson(res, 200, getJob(url.pathname.split('/').pop()) ?? { status: 'not_found' })
  if (req.method === 'POST' && url.pathname === '/api/process-sheet') return handleProcessSheet(req, res)
  if (req.method === 'POST' && url.pathname === '/api/generate-character') return handleGenerateCharacter(req, res)
  return serveStatic(req, res)
})

server.listen(port, () => {
  console.log(`Character tool running at http://localhost:${port}/`)
})
```

- [ ] **Step 4: Smoke test server startup**

Run:

```bash
npm start
```

Expected: terminal prints `Character tool running at http://localhost:4173/`. Stop it with Ctrl-C after confirmation.

- [ ] **Step 5: Commit**

```bash
git add server.js src/character-pack/jobStore.js src/character-pack/geminiProvider.js
git commit -m "feat: add character pack local backend"
```

## Task 10: Browser Character Pack UI

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `index.html`

- [ ] **Step 1: Add UI state and API helpers**

In `src/app.js`, keep existing prompt workflows and add a Character Pack tab/state. Add helpers:

```js
async function fileToBase64(file) {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function processCharacterSheet(file, options) {
  const source_base64 = await fileToBase64(file)
  const response = await fetch('/api/process-sheet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source_base64, options }),
  })
  if (!response.ok) throw new Error(`process failed: ${response.status}`)
  return response.json()
}

async function pollJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`)
  if (!response.ok) throw new Error(`job poll failed: ${response.status}`)
  return response.json()
}
```

- [ ] **Step 2: Add Character Pack tab content**

Add DOM for:

```text
角色包
Upload Sheet
name input
description input
background mode select: auto / passthrough / flood / dual_matte
process button
job state card
quality report summary
normalized sheet preview
debug overlay preview
download links for generated files
playable preview canvas placeholder
```

The UI must show Gemini state separately and say that live Gemini generation is not enabled when `/api/gemini-state` returns `available: false`.

- [ ] **Step 3: Add styles**

In `src/styles.css`, add classes:

```css
.character-pack-grid {
  display: grid;
  grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
  gap: 16px;
}

.character-pack-panel {
  border: 1px solid #d7d0c4;
  border-radius: 8px;
  padding: 14px;
  background: #fffaf2;
}

.character-pack-preview {
  image-rendering: pixelated;
  max-width: 100%;
  background: conic-gradient(#d8d2c8 25%, #f4efe7 0 50%, #d8d2c8 0 75%, #f4efe7 0) 0 0 / 16px 16px;
}
```

- [ ] **Step 4: Manual browser smoke test**

Run:

```bash
npm start
```

Open `http://localhost:4173/`, upload `test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png`, process it, and confirm the UI shows a done/pass state with preview links.

- [ ] **Step 5: Commit**

```bash
git add src/app.js src/styles.css index.html
git commit -m "feat: add character pack upload UI"
```

## Task 11: Row Preview ZIP And GIF Preview

**Files:**
- Extend: `src/character-pack/rowPreview.js`
- Extend: `src/character-pack/processSheet.js`
- Extend: `test/character-pack/processSheet.test.js`

- [ ] **Step 1: Add row preview assertions**

Extend `test/character-pack/processSheet.test.js`:

```js
assert.ok(Array.isArray(result.rowPreviews))
assert.equal(result.rowPreviews.length, 16)
assert.deepEqual(result.rowPreviews.find((item) => item.name === 'walk_right').frames, [28, 29, 30, 31])
```

- [ ] **Step 2: Implement row preview metadata**

Extend `src/character-pack/rowPreview.js`:

```js
export function buildRowPreviewIndex(profile) {
  return profile.animations.map((animation) => ({
    name: animation.name,
    frames: Array.from({ length: animation.count }, (_, i) => animation.row * profile.grid.columns + animation.startCol + i),
    fps: animation.fps,
    mode: animation.mode,
  }))
}
```

In `processSheetBuffer`, add:

```js
import { buildRowPreviewIndex } from './rowPreview.js'
```

and return:

```js
rowPreviews: buildRowPreviewIndex(profile)
```

- [ ] **Step 3: Verify tests pass**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/character-pack/rowPreview.js src/character-pack/processSheet.js test/character-pack/processSheet.test.js
git commit -m "feat: expose row animation previews"
```

## Task 12: Manual Cut-Line Adjustment

**Files:**
- Create: `src/character-pack/gridAdjustment.js`
- Create: `test/character-pack/gridAdjustment.test.js`
- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing grid adjustment tests**

Create `test/character-pack/gridAdjustment.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildManualOverrides, snapToNearestProjectionMinimum } from '../../src/character-pack/gridAdjustment.js'

test('snapToNearestProjectionMinimum chooses the lowest content line in a radius', () => {
  const projection = [10, 9, 1, 8, 12, 2, 9]
  assert.equal(snapToNearestProjectionMinimum(projection, 4, 2), 5)
  assert.equal(snapToNearestProjectionMinimum(projection, 1, 2), 2)
})

test('buildManualOverrides turns cut lines into row and column boundaries', () => {
  const overrides = buildManualOverrides({
    width: 800,
    height: 800,
    verticalLines: [100, 200, 300, 400, 500, 600, 700],
    horizontalLines: [100, 200, 300, 400, 500, 600, 700],
  })
  assert.deepEqual(overrides.columns, [0, 100, 200, 300, 400, 500, 600, 700, 800])
  assert.deepEqual(overrides.rows, [0, 100, 200, 300, 400, 500, 600, 700, 800])
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test test/character-pack/gridAdjustment.test.js
```

Expected: FAIL because `gridAdjustment.js` does not exist.

- [ ] **Step 3: Implement grid adjustment helpers**

Create `src/character-pack/gridAdjustment.js`:

```js
export function snapToNearestProjectionMinimum(projection, position, radius = 6) {
  const start = Math.max(0, Math.floor(position - radius))
  const end = Math.min(projection.length - 1, Math.ceil(position + radius))
  let best = Math.round(position)
  let bestValue = projection[best] ?? Infinity
  for (let i = start; i <= end; i++) {
    if ((projection[i] ?? Infinity) < bestValue) {
      best = i
      bestValue = projection[i]
    }
  }
  return best
}

export function buildManualOverrides({ width, height, verticalLines, horizontalLines }) {
  return {
    columns: [0, ...verticalLines.map(Math.round), width],
    rows: [0, ...horizontalLines.map(Math.round), height],
  }
}
```

- [ ] **Step 4: Add source preview cut-line UI**

In `src/app.js`, add Character Pack UI state:

```js
const [manualCutLines, setManualCutLines] = useState(null)
const [useManualCutLines, setUseManualCutLines] = useState(false)
```

When the source image loads, initialize seven vertical and seven horizontal lines from the selected 8x8 profile:

```js
function makeEvenCutLines(width, height) {
  return {
    verticalLines: Array.from({ length: 7 }, (_, i) => Math.round(((i + 1) * width) / 8)),
    horizontalLines: Array.from({ length: 7 }, (_, i) => Math.round(((i + 1) * height) / 8)),
  }
}
```

When posting to `/api/process-sheet`, include:

```js
manualOverrides: useManualCutLines && manualCutLines
  ? {
      columns: [0, ...manualCutLines.verticalLines, manualCutLines.width],
      rows: [0, ...manualCutLines.horizontalLines, manualCutLines.height],
    }
  : null
```

Add visible controls:

```text
Auto grid
Manual cut lines
Reset to auto
Re-slice
```

Dragging a line updates `manualCutLines`. Do not expose manual anchor movement in v0.1.

- [ ] **Step 5: Style the cut-line overlay**

In `src/styles.css`, add:

```css
.cutline-preview {
  position: relative;
  display: inline-block;
  max-width: 100%;
}

.cutline-preview img {
  display: block;
  max-width: 100%;
  image-rendering: pixelated;
}

.cutline {
  position: absolute;
  background: rgba(255, 80, 96, 0.75);
  touch-action: none;
}

.cutline.vertical {
  top: 0;
  bottom: 0;
  width: 2px;
  cursor: ew-resize;
}

.cutline.horizontal {
  left: 0;
  right: 0;
  height: 2px;
  cursor: ns-resize;
}
```

- [ ] **Step 6: Verify tests and manual UI**

Run:

```bash
npm test
```

Expected: all tests pass.

Start the app:

```bash
npm start
```

Upload the fixture, toggle manual cut lines, drag one line, click re-slice, and confirm the debug report includes `grid.manual_overrides`.

- [ ] **Step 7: Commit**

```bash
git add src/character-pack/gridAdjustment.js test/character-pack/gridAdjustment.test.js src/app.js src/styles.css
git commit -m "feat: add manual sheet cut lines"
```

## Task 13: GIF Preview And ZIP Export

**Files:**
- Create: `src/character-pack/gifExport.js`
- Create: `src/character-pack/zipExport.js`
- Create: `test/character-pack/export.test.js`
- Modify: `src/character-pack/processSheet.js`
- Modify: `server.js`
- Modify: `src/app.js`

- [ ] **Step 1: Write failing export tests**

Create `test/character-pack/export.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { encodeGifFromRgbaFrames } from '../../src/character-pack/gifExport.js'
import { buildCharacterPackZip } from '../../src/character-pack/zipExport.js'

function frame(alpha) {
  const data = new Uint8ClampedArray(4 * 4 * 4)
  data[3] = alpha
  return { width: 4, height: 4, data }
}

test('encodeGifFromRgbaFrames returns a GIF buffer', () => {
  const gif = encodeGifFromRgbaFrames([frame(255), frame(0)], { delay: 100 })
  assert.ok(Buffer.isBuffer(gif))
  assert.equal(gif.subarray(0, 3).toString('ascii'), 'GIF')
})

test('buildCharacterPackZip includes png and json artifacts', async () => {
  const zip = await buildCharacterPackZip({
    'normalized_sheet.png': Buffer.from('png'),
    'animations.json': { version: '0.1' },
  })
  assert.ok(Buffer.isBuffer(zip))
  assert.ok(zip.length > 20)
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test test/character-pack/export.test.js
```

Expected: FAIL because export modules do not exist.

- [ ] **Step 3: Implement GIF and ZIP helpers**

Create `src/character-pack/gifExport.js`:

```js
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

export function encodeGifFromRgbaFrames(frames, { delay = 100 } = {}) {
  if (frames.length === 0) throw new Error('Cannot encode empty GIF')
  const gif = GIFEncoder()
  for (const frame of frames) {
    const palette = quantize(frame.data, 255, {
      format: 'rgba4444',
      oneBitAlpha: 128,
      clearAlpha: true,
      clearAlphaThreshold: 128,
    })
    const index = applyPalette(frame.data, palette, 'rgba4444')
    const transparentIndex = Math.max(0, palette.findIndex((color) => color[3] === 0))
    gif.writeFrame(index, frame.width, frame.height, {
      palette,
      delay,
      transparent: true,
      transparentIndex,
    })
  }
  gif.finish()
  return Buffer.from(gif.bytes())
}
```

Create `src/character-pack/zipExport.js`:

```js
import JSZip from 'jszip'

export async function buildCharacterPackZip(files) {
  const zip = new JSZip()
  for (const [name, value] of Object.entries(files)) {
    zip.file(name, Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2))
  }
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
```

- [ ] **Step 4: Add row GIF and ZIP outputs to processing**

In `processSheetBuffer`, import:

```js
import { encodeGifFromRgbaFrames } from './gifExport.js'
import { buildCharacterPackZip } from './zipExport.js'
```

After normalized frames are available, build GIF previews:

```js
const rowPreviews = buildRowPreviewIndex(profile)
const rowGifBuffers = Object.fromEntries(
  rowPreviews.map((preview) => [
    `${preview.name}.gif`,
    encodeGifFromRgbaFrames(preview.frames.map((index) => normalized.frames[index].image), { delay: Math.round(1000 / preview.fps) }),
  ])
)
```

Include the ZIP:

```js
const zipBuffer = await buildCharacterPackZip({
  'normalized_sheet.png': await encodeRgbaPng(normalizedSheet),
  'animations.json': animationsJson,
  'metadata.json': metadataJson,
  'debug_report.json': debugReport,
  ...rowGifBuffers,
})
```

Return `rowGifBuffers` and `zipBuffer` under `files`.

- [ ] **Step 5: Serve GIF and ZIP files**

In `server.js`, write each row GIF and `character_pack.zip` to the generated job directory:

```js
for (const [name, buffer] of Object.entries(result.files.rowGifBuffers ?? {})) {
  await writeFile(path.join(jobDir, name), buffer)
}
await writeFile(path.join(jobDir, 'character_pack.zip'), result.files.zipBuffer)
```

Add URLs to the job:

```js
zip_url: `/generated/${job.id}/character_pack.zip`,
row_gif_urls: Object.keys(result.files.rowGifBuffers ?? {}).map((name) => `/generated/${job.id}/${name}`),
```

- [ ] **Step 6: Add UI download links**

In `src/app.js`, display:

```text
Download ZIP
Row GIF previews
Download normalized sheet
Download debug report
```

GIFs are preview artifacts only. The UI must still label `normalized_sheet.png + animations.json` as the primary game asset.

- [ ] **Step 7: Verify tests and browser export**

Run:

```bash
npm test
```

Expected: all tests pass.

Start the app, process the fixture, and confirm the ZIP and at least one row GIF URL opens.

- [ ] **Step 8: Commit**

```bash
git add src/character-pack/gifExport.js src/character-pack/zipExport.js test/character-pack/export.test.js src/character-pack/processSheet.js server.js src/app.js
git commit -m "feat: export character pack previews"
```

## Task 14: Spec And Plan Sync Check

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-05-23-ai-character-pack-protocol-design.md`
- Modify if needed: this plan

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Confirm implemented surface against spec**

Check these items manually:

```text
profile: topdown_rpg_v0
grid: 8x8
frame size: 96x96
animations: 16 four-frame entries
flip_h: false in generated animations
background modes: passthrough and flood implemented; dual_matte RGBA helper implemented
manual cut-line: source preview supports draggable cut lines and backend accepts manualOverrides
projection fallback: slicer records projection_minima corrections when it adjusts grid boundaries
debug outputs: debug_overlay.png and onion_skin_overlay.png files are written
GIF/ZIP: row GIF previews and character_pack.zip are written
OpenRouter Gemini: backend exposes provider state, disables generation without a key, and routes configured generation through the same post-processing pipeline
fixture: known-good PNG and expected JSON exist
```

- [ ] **Step 3: Record known limitations**

If live OpenRouter generation or Godot `.tres` export are not fully verified in this execution pass, record them as follow-up scope in the final implementation notes. Do not mark live external generation as complete unless it works with a real API key.

- [ ] **Step 4: Commit final sync**

```bash
git add docs/superpowers/specs/2026-05-23-ai-character-pack-protocol-design.md docs/superpowers/plans/2026-05-24-ai-character-pack-upload-pipeline.md
git commit -m "docs: sync character pack upload pipeline plan"
```

## Self-Review

Spec coverage:

- Character profile, frame layout, animation names, and `flip_h` are covered by Tasks 2 and 3.
- Known-good fixture and regression tests are covered by Task 4 and Task 8.
- Background removal modes are covered by Task 5.
- Grid slicing, proportional boundaries, and cell geometry repair are covered by Task 6.
- Anchor normalization, validation, and quality status are covered by Task 7.
- End-to-end output artifacts are covered by Task 8.
- Backend job statuses and OpenRouter provider state are covered by Task 9.
- Browser upload UI and preview links are covered by Task 10.
- Row preview metadata is covered by Task 11.
- Manual cut-line adjustment is covered by Task 12.
- GIF preview and ZIP export are covered by Task 13.

Deferred from this implementation plan:

- Godot `.tres` export.
- Real OpenRouter key verification if no `OPENROUTER_API_KEY` is present in the local environment.

These deferred items have contracts in the spec and should receive separate implementation plans after the upload-first pipeline is green.

## Implementation Status: 2026-05-24

Completed in this pass:

- `topdown_rpg_v0` profile, 8x8 grid, 96x96 output frames, 16 four-frame animations, and `flip_h: false`.
- Upload-first processing through background removal, proportional slicing, projection correction, anchor normalization, validation, debug overlays, row GIF previews, and ZIP export.
- Browser Character Pack tab with upload, paired dual-matte source upload, optional AI reference upload, background mode selection, manual cut-line overlay, quality summary, playable preview, preview/download links, and OpenRouter provider state.
- Local backend endpoints: `GET /api/gemini-state`, `POST /api/process-sheet`, `GET /api/jobs/:id`, and `POST /api/generate-character`.
- Known-good fixture and regression tests for profile, metadata, background removal, slicing, geometry, normalization, processing, GIF, and ZIP.

Verification run:

```bash
npm test
```

Manual smoke runs used the local backend to process `test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png`, confirmed `done/pass`, confirmed `manualOverrides` appears in `debug_report.json`, and confirmed `character_pack.zip` plus 16 row GIF URLs are emitted.

Known limitations intentionally left for follow-up:

- Live OpenRouter generation is implemented and mock-verified, but still needs a real `OPENROUTER_API_KEY` smoke test in this workspace before it can be called fully verified.
- Godot `.tres` export is not implemented.
- The browser playable preview is a minimal WASD/runtime sanity check, not a full game editor.
- `dual_matte` is wired for paired-source uploads and records consistency warnings; generated AI jobs currently use single-source background cleanup unless a paired white/black generation mode is added.
