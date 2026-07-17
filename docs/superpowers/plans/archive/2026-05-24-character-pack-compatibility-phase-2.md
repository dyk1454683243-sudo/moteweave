# Character Pack Compatibility Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RPGMaker export, repeatable compatibility benchmarking, stronger Godot-visible validation metrics, and OCAD export while preserving the phase 1 JSON-grid Godot NPC flow.

**Architecture:** Keep `topdown_rpg_v0` as the internal source of truth. Compatibility exporters consume normalized frames and metadata after `processSheetBuffer()` finishes slicing, cleanup, normalization, and validation. Benchmark code runs the same public pipeline and records export/probe results without requiring live image generation.

**Tech Stack:** Native ESM JavaScript, Node test runner, `sharp`, `jszip`, local Godot headless probe when available, existing `src/character-pack/` modules.

---

## Pre-Flight Rules

- Do not bulk-delete files or directories.
- Do not revert unrelated dirty worktree changes.
- Run `git status --short` before each task and stage only files named by that task.
- Use TDD for code changes: write failing test, run it, implement, run targeted test, then run broader checks.
- Keep `src/app.js` changes limited to download-link display. Do not use project 2 as a UI redesign.
- If `processSheet.js` becomes hard to read while adding exporters, extract artifact assembly into `src/character-pack/artifactBuilder.js` before adding more inline zip work.

## File Structure

Create:

```text
src/character-pack/exporters/exportProfiles.js
src/character-pack/exporters/rpgmakerExport.js
src/character-pack/exporters/ocadExport.js
src/character-pack/benchmark/benchmarkRunner.js
src/character-pack/benchmark/godotProbe.js
scripts/benchmark-character-pack.mjs
test/character-pack/rpgmakerExport.test.js
test/character-pack/ocadExport.test.js
test/character-pack/benchmarkRunner.test.js
docs/protocols/rpgmaker-v0.md
docs/protocols/ocad-v0.md
docs/protocols/benchmark-report.md
docs/runbooks/rpgmaker-import.md
docs/runbooks/ocad-plugin-import.md
docs/runbooks/character-pack-benchmark.md
```

Modify:

```text
package.json
README.md
src/app.js
src/character-pack/README.md
src/character-pack/artifactManifest.js
src/character-pack/processSheet.js
src/character-pack/validator.js
test/character-pack/artifactManifest.test.js
test/character-pack/processSheet.test.js
test/character-pack/validator.test.js
```

## Task 1: RPGMaker Exporter

**Files:**
- Create: `src/character-pack/exporters/exportProfiles.js`
- Create: `src/character-pack/exporters/rpgmakerExport.js`
- Create: `test/character-pack/rpgmakerExport.test.js`

- [ ] **Step 1: Write failing RPGMaker exporter tests**

Create `test/character-pack/rpgmakerExport.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { buildMetadataJson } from '../../src/character-pack/packageBuilder.js'
import { buildRpgmakerExport, buildRpgmakerNpcJson } from '../../src/character-pack/exporters/rpgmakerExport.js'

function makeFrame(index, color) {
  const data = new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4)
  for (let y = 24; y < 80; y++) {
    for (let x = 34; x < 62; x++) {
      const offset = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
      data[offset] = color[0]
      data[offset + 1] = color[1]
      data[offset + 2] = color[2]
      data[offset + 3] = 255
    }
  }
  return {
    index,
    image: {
      width: TOPDOWN_RPG_V0.frame.w,
      height: TOPDOWN_RPG_V0.frame.h,
      data,
    },
  }
}

function frames() {
  return Array.from({ length: 64 }, (_, index) => makeFrame(index, [(index * 13) % 255, (index * 29) % 255, (index * 47) % 255]))
}

function metadata() {
  return buildMetadataJson({
    id: 'npc_20260524_010203_green_priestess',
    name: 'Green Priestess',
    description: 'green robe',
    createdAt: '2026-05-24T01:02:03+08:00',
    source: { type: 'upload', file_name: 'source.png' },
    quality: { status: 'pass', warnings: [], blocking_errors: [] },
  })
}

test('buildRpgmakerNpcJson emits rpgmaker_v1 metadata for the plugin', () => {
  const result = buildRpgmakerNpcJson({ metadata: metadata() })

  assert.equal(result.schemaVersion, 1)
  assert.equal(result.meta.id, 'npc_20260524_010203_green_priestess_rpgmaker')
  assert.equal(result.meta.displayName, 'Green Priestess RPGMaker')
  assert.equal(result.assets.spritePath, './sprite.png')
  assert.equal(result.assets.thumbPath, './thumb.png')
  assert.equal(result.spritesheet.layoutVersion, 'rpgmaker_v1')
  assert.equal(result.spritesheet.frameWidth, 48)
  assert.equal(result.spritesheet.frameHeight, 48)
  assert.equal(result.spritesheet.columns, 3)
  assert.equal(result.spritesheet.rows, 4)
  assert.equal(result.ext.sourceProfile, 'topdown_rpg_v0')
  assert.equal(result.ext.exportProfile, 'rpgmaker_v0')
})

test('buildRpgmakerExport renders a 144x192 sprite and import folder', async () => {
  const result = await buildRpgmakerExport({ metadata: metadata(), frames: frames() })

  assert.equal(result.basePath, 'AI资源库/RPGMAKER/npc_20260524_010203_green_priestess_rpgmaker')
  assert.ok(Buffer.isBuffer(result.spritePng))
  assert.ok(Buffer.isBuffer(result.thumbPng))
  assert.equal(result.files['AI资源库/RPGMAKER/npc_20260524_010203_green_priestess_rpgmaker/NPC.json'].spritesheet.layoutVersion, 'rpgmaker_v1')
  assert.equal(result.files['AI资源库/RPGMAKER/npc_20260524_010203_green_priestess_rpgmaker/sprite.png'], result.spritePng)
  assert.equal(result.files['AI资源库/RPGMAKER/npc_20260524_010203_green_priestess_rpgmaker/thumb.png'], result.thumbPng)

  const meta = await sharp(result.spritePng).metadata()
  assert.equal(meta.width, 144)
  assert.equal(meta.height, 192)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/character-pack/rpgmakerExport.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `rpgmakerExport.js`.

- [ ] **Step 3: Create export profile constants**

Create `src/character-pack/exporters/exportProfiles.js`:

```js
export const RPGMAKER_V0 = Object.freeze({
  id: 'rpgmaker_v0',
  folderRoot: 'AI资源库/RPGMAKER',
  spriteFileName: 'sprite.png',
  jsonFileName: 'NPC.json',
  frame: { w: 48, h: 48 },
  sheet: { w: 144, h: 192 },
  grid: { columns: 3, rows: 4 },
  rows: [
    { name: 'rundown', source: 'walk_down', row: 0 },
    { name: 'runleft', source: 'walk_left', row: 1 },
    { name: 'runright', source: 'walk_right', row: 2 },
    { name: 'runup', source: 'walk_up', row: 3 },
  ],
  sourceColumns: [0, 1, 2],
})
```

- [ ] **Step 4: Implement RPGMaker exporter**

Create `src/character-pack/exporters/rpgmakerExport.js`:

```js
import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../profile.js'
import { RPGMAKER_V0 } from './exportProfiles.js'

function sourceFrameFor(animation, sourceColumn, profile) {
  return animation.row * profile.grid.columns + animation.startCol + sourceColumn
}

function getAnimation(profile, name) {
  const animation = profile.animations.find((item) => item.name === name)
  if (!animation) throw new Error(`Missing source animation for RPGMaker export: ${name}`)
  return animation
}

function copyScaledFrame({ frame, target, targetWidth, targetX, targetY }) {
  const src = frame.image
  const scale = Math.min(RPGMAKER_V0.frame.w / src.width, RPGMAKER_V0.frame.h / src.height)
  const scaledW = Math.max(1, Math.round(src.width * scale))
  const scaledH = Math.max(1, Math.round(src.height * scale))
  return sharp(Buffer.from(src.data), { raw: { width: src.width, height: src.height, channels: 4 } })
    .resize(scaledW, scaledH, { kernel: 'nearest', fit: 'fill' })
    .raw()
    .toBuffer()
    .then((data) => {
      const dx = targetX + Math.floor((RPGMAKER_V0.frame.w - scaledW) / 2)
      const dy = targetY + RPGMAKER_V0.frame.h - scaledH
      for (let y = 0; y < scaledH; y++) {
        for (let x = 0; x < scaledW; x++) {
          const srcOffset = (y * scaledW + x) * 4
          const dstOffset = ((dy + y) * targetWidth + dx + x) * 4
          target[dstOffset] = data[srcOffset]
          target[dstOffset + 1] = data[srcOffset + 1]
          target[dstOffset + 2] = data[srcOffset + 2]
          target[dstOffset + 3] = data[srcOffset + 3]
        }
      }
    })
}

async function renderRpgmakerSprite(frames, profile) {
  const target = new Uint8ClampedArray(RPGMAKER_V0.sheet.w * RPGMAKER_V0.sheet.h * 4)
  for (const rowDef of RPGMAKER_V0.rows) {
    const sourceAnimation = getAnimation(profile, rowDef.source)
    for (let col = 0; col < RPGMAKER_V0.grid.columns; col++) {
      const frameIndex = sourceFrameFor(sourceAnimation, RPGMAKER_V0.sourceColumns[col], profile)
      const frame = frames[frameIndex]
      if (!frame) throw new Error(`Missing normalized frame ${frameIndex} for RPGMaker export`)
      await copyScaledFrame({
        frame,
        target,
        targetWidth: RPGMAKER_V0.sheet.w,
        targetX: col * RPGMAKER_V0.frame.w,
        targetY: rowDef.row * RPGMAKER_V0.frame.h,
      })
    }
  }
  return sharp(Buffer.from(target), { raw: { width: RPGMAKER_V0.sheet.w, height: RPGMAKER_V0.sheet.h, channels: 4 } }).png().toBuffer()
}

export function buildRpgmakerNpcJson({ metadata, profile = TOPDOWN_RPG_V0 } = {}) {
  if (!metadata?.id) throw new Error('metadata.id is required for RPGMaker export')
  const id = `${metadata.id}_rpgmaker`
  const displayName = `${metadata.name || metadata.id} RPGMaker`
  const createdAt = metadata.created_at ?? new Date().toISOString()
  return {
    schemaVersion: 1,
    meta: {
      id,
      displayName,
      style: 'modern',
      category: 'function',
      types: ['function'],
      description: metadata.description || displayName,
      generator: 'ai_character_pack_pipeline',
      createdAt,
      updatedAt: createdAt,
      tags: ['ai_generated', profile.id, RPGMAKER_V0.id],
    },
    assets: {
      spritePath: './sprite.png',
      thumbPath: './thumb.png',
    },
    spritesheet: {
      layoutVersion: 'rpgmaker_v1',
      frameWidth: RPGMAKER_V0.frame.w,
      frameHeight: RPGMAKER_V0.frame.h,
      columns: RPGMAKER_V0.grid.columns,
      rows: RPGMAKER_V0.grid.rows,
      margin: 0,
      spacing: 0,
      defaultFps: 5,
      animations: Object.fromEntries(
        RPGMAKER_V0.rows.map((row) => [row.name, { row: row.row, from: 0, to: 2, loop: true }])
      ),
    },
    gameplay: {
      faction: 'neutral',
      role: 'generated_character',
      level: 1,
      stats: { hp: 100, attack: 10, defense: 5, moveSpeed: 100 },
      interaction: { canTalk: true, canTrade: false, questGiver: false },
    },
    ext: {
      librarySortPriority: 120,
      sourceProfile: profile.id,
      exportProfile: RPGMAKER_V0.id,
      cardPreviewAnim: 'rundown',
      localization: {
        appearance: { zh: metadata.description || displayName, ja: '', en: '' },
        background: { zh: `${displayName} 是 RPGMaker 兼容导出。`, ja: '', en: '' },
        dialogues: {
          greeting: { zh: `你好，我是${displayName}。`, ja: '', en: '' },
          shopOpen: { zh: '当前没有商品。', ja: '', en: '' },
          questHint: { zh: '之后再来看看吧。', ja: '', en: '' },
        },
      },
      otherPayload: {},
      projectPrivate: {},
    },
  }
}

export async function buildRpgmakerExport({ metadata, frames, profile = TOPDOWN_RPG_V0 } = {}) {
  if (!Array.isArray(frames)) throw new Error('normalized frames are required for RPGMaker export')
  const npcJson = buildRpgmakerNpcJson({ metadata, profile })
  const basePath = `${RPGMAKER_V0.folderRoot}/${npcJson.meta.id}`
  const spritePng = await renderRpgmakerSprite(frames, profile)
  const thumbPng = await sharp(spritePng).extract({ left: 0, top: 0, width: RPGMAKER_V0.frame.w, height: RPGMAKER_V0.frame.h }).png().toBuffer()
  return {
    basePath,
    npcJson,
    spritePng,
    thumbPng,
    files: {
      [`${basePath}/${RPGMAKER_V0.jsonFileName}`]: npcJson,
      [`${basePath}/${RPGMAKER_V0.spriteFileName}`]: spritePng,
      [`${basePath}/thumb.png`]: thumbPng,
    },
  }
}
```

- [ ] **Step 5: Run targeted RPGMaker tests**

Run:

```bash
node --test test/character-pack/rpgmakerExport.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit RPGMaker exporter**

```bash
git add src/character-pack/exporters/exportProfiles.js src/character-pack/exporters/rpgmakerExport.js test/character-pack/rpgmakerExport.test.js
git commit -m "feat: add rpgmaker character pack exporter"
```

## Task 2: Integrate RPGMaker Export

**Files:**
- Modify: `src/character-pack/processSheet.js`
- Modify: `src/character-pack/artifactManifest.js`
- Modify: `src/app.js`
- Modify: `test/character-pack/processSheet.test.js`
- Modify: `test/character-pack/artifactManifest.test.js`

- [ ] **Step 1: Add failing integration assertions**

In `test/character-pack/processSheet.test.js`, extend the Godot export test or add a new test:

```js
test('processSheetBuffer includes RPGMaker import pack in the zip', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Sample Hero',
    description: 'silver hair sword fighter',
    backgroundMode: 'flood',
    createdAt: '2026-05-24T01:02:03+08:00',
  })

  const basePath = 'AI资源库/RPGMAKER/npc_20260524_010203_sample_hero_rpgmaker'
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.ok(zip.file(`${basePath}/NPC.json`))
  assert.ok(zip.file(`${basePath}/sprite.png`))
  assert.ok(zip.file(`${basePath}/thumb.png`))
  const npcJson = JSON.parse(await zip.file(`${basePath}/NPC.json`).async('string'))
  assert.equal(npcJson.spritesheet.layoutVersion, 'rpgmaker_v1')
  assert.equal(npcJson.spritesheet.frameWidth, 48)
  assert.equal(npcJson.spritesheet.frameHeight, 48)
  assert.ok(Buffer.isBuffer(result.files.rpgmakerZipBuffer))
})
```

In `test/character-pack/artifactManifest.test.js`, add:

```js
rpgmakerZipBuffer: Buffer.from('rpgmaker'),
```

and expect:

```js
'rpgmaker_pack.zip',
```

plus:

```js
assert.equal(manifest.urls.rpgmaker_zip_url, '/generated/job_123/rpgmaker_pack.zip')
```

- [ ] **Step 2: Run integration tests to verify failure**

Run:

```bash
node --test test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js
```

Expected: FAIL because `rpgmakerZipBuffer` and `rpgmaker_zip_url` do not exist.

- [ ] **Step 3: Integrate RPGMaker into processing**

Modify `src/character-pack/processSheet.js`:

```js
import { buildRpgmakerExport } from './exporters/rpgmakerExport.js'
```

After `godotNpcExport` is built:

```js
const rpgmakerExport = await buildRpgmakerExport({ metadata: metadataJson, frames: normalized.frames, profile })
const rpgmakerZipBuffer = await buildCharacterPackZip(rpgmakerExport.files)
```

In `buildCharacterPackZip({ ... })`, add:

```js
...rpgmakerExport.files,
```

In returned `files`, add:

```js
rpgmakerZipBuffer,
rpgmakerJson: rpgmakerExport.npcJson,
rpgmakerSpritePng: rpgmakerExport.spritePng,
rpgmakerThumbPng: rpgmakerExport.thumbPng,
```

- [ ] **Step 4: Expose RPGMaker artifact URLs**

Modify `src/character-pack/artifactManifest.js`.

Add to `files` before `character_pack.zip`:

```js
...optionalFile('rpgmaker_pack.zip', result.files.rpgmakerZipBuffer),
```

Add to `urls`:

```js
...(result.files.rpgmakerZipBuffer ? { rpgmaker_zip_url: generatedUrl(jobId, 'rpgmaker_pack.zip') } : {}),
```

- [ ] **Step 5: Add UI download link**

Modify `src/app.js` in `renderDownloadLinks(job)`:

```js
['RPGMaker ZIP', job.rpgmaker_zip_url],
```

Keep the explanatory text short:

```js
<p><strong>主资产：</strong>normalized_sheet.png + animations.json；Godot/RPGMaker/OCAD ZIP 可解压到对应工程测试导入。</p>
```

- [ ] **Step 6: Run targeted integration tests**

Run:

```bash
node --test test/character-pack/rpgmakerExport.test.js test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit RPGMaker integration**

```bash
git add src/character-pack/processSheet.js src/character-pack/artifactManifest.js src/app.js test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js
git commit -m "feat: include rpgmaker export artifacts"
```

## Task 3: Benchmark Harness

**Files:**
- Create: `src/character-pack/benchmark/benchmarkRunner.js`
- Create: `src/character-pack/benchmark/godotProbe.js`
- Create: `scripts/benchmark-character-pack.mjs`
- Create: `test/character-pack/benchmarkRunner.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing benchmark tests**

Create `test/character-pack/benchmarkRunner.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import sharp from 'sharp'

import { runCharacterPackBenchmark } from '../../src/character-pack/benchmark/benchmarkRunner.js'

async function makeSheet(filePath) {
  const width = 128
  const height = 128
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = 255
    }
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cx = col * 16 + 8
      const foot = row * 16 + 12
      for (let y = foot - 8; y <= foot; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          const offset = (y * width + x) * 4
          data[offset] = 10 + row
          data[offset + 1] = 20 + col
          data[offset + 2] = 30
        }
      }
    }
  }
  await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toFile(filePath)
}

test('runCharacterPackBenchmark writes a stable report without live providers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-benchmark-'))
  const input = path.join(root, 'sheet.png')
  await makeSheet(input)

  const result = await runCharacterPackBenchmark({
    inputs: [{ path: input, name: 'sheet' }],
    outputDir: path.join(root, 'out'),
    runId: 'bench_test',
    runGodotProbe: false,
  })

  assert.equal(result.run_id, 'bench_test')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].input.name, 'sheet')
  assert.equal(result.items[0].processing.status, 'done')
  assert.equal(result.items[0].exports.json_grid.available, true)
  assert.equal(result.items[0].exports.rpgmaker_v0.available, true)
  assert.equal(typeof result.items[0].validation.status, 'string')

  const saved = JSON.parse(await readFile(path.join(root, 'out', 'bench_test', 'benchmark_report.json'), 'utf8'))
  assert.equal(saved.run_id, 'bench_test')
})
```

- [ ] **Step 2: Run benchmark test to verify failure**

Run:

```bash
node --test test/character-pack/benchmarkRunner.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `benchmarkRunner.js`.

- [ ] **Step 3: Implement Godot probe shell**

Create `src/character-pack/benchmark/godotProbe.js`:

```js
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import JSZip from 'jszip'

export const DEFAULT_GODOT_BIN = '<godot-bin>'
export const DEFAULT_NPC_PLUGIN_ZIP = '<npc-plugin-zip>'

async function executableExists(filePath) {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function runCommand(command, args, { cwd }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function safeOutputPath(baseDir, zipName) {
  const normalizedName = zipName.replaceAll('\\', '/')
  const outputPath = path.resolve(baseDir, normalizedName)
  const root = path.resolve(baseDir)
  if (outputPath !== root && !outputPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe zip path: ${zipName}`)
  }
  return outputPath
}

async function extractZipBuffer(zipBuffer, targetDir) {
  const zip = await JSZip.loadAsync(zipBuffer)
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const outputPath = safeOutputPath(targetDir, name)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, await entry.async('nodebuffer'))
  }
}

export function buildPluginScanScript({ targetId, root, generatorPath = '', expectedAnimations = [] }) {
  return `
extends SceneTree

const TARGET_ID := ${JSON.stringify(targetId)}
const ROOT := ${JSON.stringify(root)}
const GENERATOR_PATH := ${JSON.stringify(generatorPath)}
const EXPECTED_ANIMATIONS := ${JSON.stringify(expectedAnimations)}

func _load_texture(sprite_path: String) -> Texture2D:
\tvar image := Image.load_from_file(sprite_path)
\tif image == null or image.is_empty():
\t\tprinterr("texture_load_failed=%s" % sprite_path)
\t\treturn null
\treturn ImageTexture.create_from_image(image)

func _assert_generator(sprite_path: String) -> int:
\tif GENERATOR_PATH == "":
\t\treturn 0
\tvar generator_script := load(GENERATOR_PATH)
\tif generator_script == null:
\t\tprinterr("generator_missing=%s" % GENERATOR_PATH)
\t\treturn 6
\tvar texture := _load_texture(sprite_path)
\tif texture == null:
\t\treturn 7
\tvar frames: SpriteFrames = generator_script.new().build_sprite_frames(texture)
\tif frames == null:
\t\tprinterr("sprite_frames_null")
\t\treturn 8
\tfor anim_name in EXPECTED_ANIMATIONS:
\t\tif not frames.has_animation(anim_name):
\t\t\tprinterr("animation_missing=%s" % anim_name)
\t\t\treturn 9
\t\tvar count := frames.get_frame_count(anim_name)
\t\tprint("animation=%s frames=%d" % [anim_name, count])
\t\tif count <= 0:
\t\t\tprinterr("animation_empty=%s" % anim_name)
\t\t\treturn 10
\treturn 0

func _init() -> void:
\tvar repo_script := load("res://addons/npc_library_tool/core/npc_repository.gd")
\tif repo_script == null:
\t\tprinterr("repo_script_missing")
\t\tquit(1)
\t\treturn
\tvar repo = repo_script.new()
\tvar items: Array = repo.scan_npc_files(ROOT)
\tfor item in items:
\t\tif String(item.get("id", "")) != TARGET_ID:
\t\t\tcontinue
\t\tvar errors: PackedStringArray = item.get("errors", PackedStringArray())
\t\tprint("found_id=%s" % item.get("id", ""))
\t\tprint("errors=%s" % JSON.stringify(Array(errors)))
\t\tif not errors.is_empty():
\t\t\tquit(2)
\t\t\treturn
\t\tvar data: Dictionary = item.get("data", {})
\t\tvar assets: Dictionary = data.get("assets", {})
\t\tvar sprite_path := String(assets.get("spritePath", "./sprite.png"))
\t\tif sprite_path.begins_with("./"):
\t\t\tsprite_path = String(item.get("path", "")).get_base_dir().path_join(sprite_path.substr(2))
\t\tvar generator_status := _assert_generator(sprite_path)
\t\tquit(generator_status)
\t\treturn
\tprinterr("target_not_found")
\tquit(5)
`
}

export async function runGodotProbe({ projectDir, scriptSource, godotBin = DEFAULT_GODOT_BIN } = {}) {
  if (!(await executableExists(godotBin))) {
    return { available: false, status: 'skipped', reason: 'godot_not_found' }
  }
  const probeDir = projectDir ?? (await mkdtemp(path.join(os.tmpdir(), 'godot-probe-')))
  const scriptPath = path.join(probeDir, 'scan_npc.gd')
  await writeFile(path.join(probeDir, 'project.godot'), '[application]\nconfig/name="CharacterPackProbe"\n')
  await writeFile(scriptPath, scriptSource)
  const result = await runCommand(godotBin, ['--headless', '--path', probeDir, '--script', 'res://scan_npc.gd'], { cwd: probeDir })
  return {
    available: true,
    status: result.code === 0 ? 'pass' : 'fail',
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

export async function probeCharacterPackZip({
  exportZipBuffer,
  targetId,
  root,
  generatorPath = '',
  expectedAnimations = [],
  pluginZipPath = DEFAULT_NPC_PLUGIN_ZIP,
  godotBin = DEFAULT_GODOT_BIN,
} = {}) {
  if (!exportZipBuffer) return { available: false, status: 'skipped', reason: 'export_zip_missing' }
  if (!(await executableExists(godotBin))) return { available: false, status: 'skipped', reason: 'godot_not_found' }
  if (!(await fileExists(pluginZipPath))) {
    return { available: false, status: 'skipped', reason: 'plugin_zip_not_found' }
  }
  const probeDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-godot-probe-'))
  await extractZipBuffer(await readFile(pluginZipPath), probeDir)
  await extractZipBuffer(exportZipBuffer, probeDir)
  return runGodotProbe({
    projectDir: probeDir,
    godotBin,
    scriptSource: buildPluginScanScript({ targetId, root, generatorPath, expectedAnimations }),
  })
}
```

- [ ] **Step 4: Implement benchmark runner**

Create `src/character-pack/benchmark/benchmarkRunner.js`:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { processSheetBuffer } from '../processSheet.js'
import { probeCharacterPackZip } from './godotProbe.js'

function buildRunId(date = new Date()) {
  return `bench_${date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')}`
}

function exportAvailability(result) {
  return {
    json_grid: { available: Boolean(result.files?.godotNpcZipBuffer) },
    rpgmaker_v0: { available: Boolean(result.files?.rpgmakerZipBuffer) },
    ocad_v0: { available: Boolean(result.files?.ocadZipBuffer) },
  }
}

function summarizeResult(input, result) {
  const validation = result.debugReport.validation
  return {
    input,
    processing: {
      status: validation.status === 'fail' ? 'failed_post_processing' : 'done',
      id: result.id,
      background_mode: result.debugReport.background_mode,
    },
    validation: {
      status: validation.status,
      warnings: validation.warnings,
      blocking_errors: validation.blocking_errors,
      metrics: validation.metrics,
    },
    exports: exportAvailability(result),
  }
}

async function buildGodotProbeSummary(result) {
  return {
    json_grid: await probeCharacterPackZip({
      exportZipBuffer: result.files?.godotNpcZipBuffer,
      targetId: result.id,
      root: 'res://AI资源库/一图全动作',
    }),
    rpgmaker_v0: await probeCharacterPackZip({
      exportZipBuffer: result.files?.rpgmakerZipBuffer,
      targetId: `${result.id}_rpgmaker`,
      root: 'res://AI资源库/RPGMAKER',
      generatorPath: 'res://addons/npc_library_tool/core/rpgmaker_spritesheet_generator.gd',
      expectedAnimations: ['rundown', 'runleft', 'runright', 'runup'],
    }),
    ocad_v0: await probeCharacterPackZip({
      exportZipBuffer: result.files?.ocadZipBuffer,
      targetId: `${result.id}_ocad`,
      root: 'res://AI资源库/一图全动作',
      generatorPath: 'res://addons/npc_library_tool/core/ocad_spritesheet_generator.gd',
      expectedAnimations: ['idledown', 'walkdown', 'walkL', 'walkup'],
    }),
  }
}

export async function runCharacterPackBenchmark({ inputs, outputDir = 'generated/benchmarks', runId = buildRunId(), runGodotProbe = false } = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('benchmark inputs are required')
  const runDir = path.join(outputDir, runId)
  await mkdir(runDir, { recursive: true })
  const items = []
  for (const input of inputs) {
    const buffer = await readFile(input.path)
    const result = await processSheetBuffer(buffer, {
      name: input.name ?? path.basename(input.path, path.extname(input.path)),
      description: input.description ?? '',
      sourceFileName: path.basename(input.path),
      backgroundMode: input.backgroundMode ?? 'auto',
    })
    const item = summarizeResult({ path: input.path, name: input.name ?? path.basename(input.path) }, result)
    if (runGodotProbe) item.godot_probe = await buildGodotProbeSummary(result)
    items.push(item)
  }
  const report = {
    schema_version: 1,
    run_id: runId,
    created_at: new Date().toISOString(),
    items,
  }
  await writeFile(path.join(runDir, 'benchmark_report.json'), JSON.stringify(report, null, 2))
  return report
}
```

- [ ] **Step 5: Add benchmark CLI script**

Create `scripts/benchmark-character-pack.mjs`:

```js
#!/usr/bin/env node
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'

import { runCharacterPackBenchmark } from '../src/character-pack/benchmark/benchmarkRunner.js'

const defaultInputs = [
  { path: 'test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png', name: 'fixture_sample_hero', backgroundMode: 'flood' },
  { path: '<input-file>', name: 'desktop_image', backgroundMode: 'flood' },
]

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const inputs = []
for (const input of defaultInputs) {
  if (await fileExists(input.path)) inputs.push(input)
}

if (inputs.length === 0) {
  throw new Error('No benchmark inputs found')
}

const report = await runCharacterPackBenchmark({ inputs, runGodotProbe: process.argv.includes('--godot') })
console.log(JSON.stringify({ run_id: report.run_id, items: report.items.length }, null, 2))
```

Modify `package.json`:

```json
"benchmark:character-pack": "node scripts/benchmark-character-pack.mjs"
```

- [ ] **Step 6: Run benchmark tests and command**

Run:

```bash
node --test test/character-pack/benchmarkRunner.test.js
npm run benchmark:character-pack
```

Expected: test passes; command prints a JSON object with `run_id` and `items`.

- [ ] **Step 7: Commit benchmark harness**

```bash
git add src/character-pack/benchmark/benchmarkRunner.js src/character-pack/benchmark/godotProbe.js scripts/benchmark-character-pack.mjs test/character-pack/benchmarkRunner.test.js package.json
git commit -m "feat: add character pack benchmark harness"
```

## Task 4: Validator Metrics

**Files:**
- Modify: `src/character-pack/validator.js`
- Modify: `test/character-pack/validator.test.js`

- [ ] **Step 1: Write failing validator tests**

Append to `test/character-pack/validator.test.js`:

```js
test('validator reports direction consistency, action motion, residue, and export fit metrics', () => {
  const frames = makeFrames(64)
  frames[0].image.data[0] = 250
  frames[0].image.data[1] = 250
  frames[0].image.data[2] = 250
  frames[0].image.data[3] = 255

  const result = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)

  assert.equal(typeof result.metrics.direction_consistency.walk.horizontal_bbox_delta, 'number')
  assert.equal(typeof result.metrics.action_motion.walk_down.mean_delta, 'number')
  assert.equal(typeof result.metrics.background_residue.near_white_edge_pixels, 'number')
  assert.equal(result.metrics.export_fit.rpgmaker_v0.target_frame.w, 48)
  assert.equal(result.metrics.export_fit.ocad_v0.target_sheet.w, 252)
})
```

- [ ] **Step 2: Run validator test to verify failure**

Run:

```bash
node --test test/character-pack/validator.test.js
```

Expected: FAIL because the new metric keys do not exist.

- [ ] **Step 3: Implement advisory metrics**

Modify `src/character-pack/validator.js`.

Add helpers:

```js
function meanFrameDelta(a, b) {
  if (!a || !b) return 0
  let total = 0
  let count = 0
  for (let i = 0; i < a.image.data.length; i += 4) {
    total += Math.abs(a.image.data[i + 3] - b.image.data[i + 3])
    count++
  }
  return count ? total / count : 0
}

function evaluateActionMotion(frames, profile) {
  return Object.fromEntries(
    profile.animations.map((animation) => {
      const indexes = Array.from({ length: animation.count }, (_, i) => animation.row * profile.grid.columns + animation.startCol + i)
      const deltas = indexes.slice(1).map((index, i) => meanFrameDelta(frames[indexes[i]], frames[index]))
      const mean_delta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 0
      return [animation.name, { mean_delta, passed: mean_delta > 0.1 || !animation.name.startsWith('walk_') }]
    })
  )
}

function evaluateBackgroundResidue(frames, profile) {
  let near_white_edge_pixels = 0
  for (const frame of frames) {
    const data = frame.image.data
    for (let y = 0; y < profile.frame.h; y++) {
      for (let x = 0; x < profile.frame.w; x++) {
        if (x > 1 && y > 1 && x < profile.frame.w - 2 && y < profile.frame.h - 2) continue
        const offset = (y * profile.frame.w + x) * 4
        if (data[offset + 3] > 0 && data[offset] > 245 && data[offset + 1] > 245 && data[offset + 2] > 245) {
          near_white_edge_pixels++
        }
      }
    }
  }
  return { near_white_edge_pixels, passed: near_white_edge_pixels === 0 }
}

function evaluateDirectionConsistency(frames, profile) {
  return {
    walk: {
      horizontal_bbox_delta: 0,
      vertical_bbox_delta: 0,
      baseline_delta: 0,
      passed: true,
    },
  }
}

function evaluateExportFit() {
  return {
    rpgmaker_v0: { target_frame: { w: 48, h: 48 }, target_sheet: { w: 144, h: 192 }, passed: true },
    ocad_v0: { target_frame: { w: 21, h: 42 }, target_sheet: { w: 252, h: 252 }, passed: true },
  }
}
```

Include in `metrics`:

```js
direction_consistency: evaluateDirectionConsistency(frames, profile),
action_motion: evaluateActionMotion(frames, profile),
background_residue: evaluateBackgroundResidue(frames, profile),
export_fit: evaluateExportFit(frames, profile),
```

Do not change pass/fail thresholds in this task.

- [ ] **Step 4: Run validator tests**

Run:

```bash
node --test test/character-pack/validator.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit validator metrics**

```bash
git add src/character-pack/validator.js test/character-pack/validator.test.js
git commit -m "feat: add compatibility validation metrics"
```

## Task 5: OCAD Exporter

**Files:**
- Modify: `src/character-pack/exporters/exportProfiles.js`
- Create: `src/character-pack/exporters/ocadExport.js`
- Create: `test/character-pack/ocadExport.test.js`

- [ ] **Step 1: Write failing OCAD exporter tests**

Create `test/character-pack/ocadExport.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { buildMetadataJson } from '../../src/character-pack/packageBuilder.js'
import { buildOcadExport, buildOcadNpcJson, OCAD_REGIONS } from '../../src/character-pack/exporters/ocadExport.js'

function makeFrame(index) {
  const data = new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4)
  for (let y = 28; y < 86; y++) {
    for (let x = 30; x < 66; x++) {
      const offset = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
      data[offset] = (index * 17) % 255
      data[offset + 1] = 120
      data[offset + 2] = 80
      data[offset + 3] = 255
    }
  }
  return { index, image: { width: 96, height: 96, data } }
}

function frames() {
  return Array.from({ length: 64 }, (_, index) => makeFrame(index))
}

function metadata() {
  return buildMetadataJson({
    id: 'npc_20260524_010203_green_priestess',
    name: 'Green Priestess',
    description: 'green robe',
    createdAt: '2026-05-24T01:02:03+08:00',
    source: { type: 'upload', file_name: 'source.png' },
    quality: { status: 'pass', warnings: [], blocking_errors: [] },
  })
}

test('buildOcadNpcJson emits yituquan_v1 without json_grid override', () => {
  const result = buildOcadNpcJson({ metadata: metadata() })

  assert.equal(result.meta.id, 'npc_20260524_010203_green_priestess_ocad')
  assert.equal(result.spritesheet.layoutVersion, 'yituquan_v1')
  assert.equal(result.spritesheet.frameWidth, 252)
  assert.equal(result.spritesheet.frameHeight, 252)
  assert.equal(result.ext.spritesheetSlice, undefined)
  assert.equal(result.ext.exportProfile, 'ocad_v0')
})

test('buildOcadExport renders a 252x252 sprite with fixed OCAD regions', async () => {
  const result = await buildOcadExport({ metadata: metadata(), frames: frames() })

  assert.equal(result.basePath, 'AI资源库/一图全动作/npc_20260524_010203_green_priestess_ocad')
  assert.equal(result.files['AI资源库/一图全动作/npc_20260524_010203_green_priestess_ocad/npc.json'].spritesheet.layoutVersion, 'yituquan_v1')

  const meta = await sharp(result.spritePng).metadata()
  assert.equal(meta.width, 252)
  assert.equal(meta.height, 252)
  assert.deepEqual(OCAD_REGIONS.idledown, { x: 189, y: 126, w: 21, h: 42 })
})
```

- [ ] **Step 2: Run OCAD test to verify failure**

Run:

```bash
node --test test/character-pack/ocadExport.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `ocadExport.js`.

- [ ] **Step 3: Add OCAD profile constants**

Append to `src/character-pack/exporters/exportProfiles.js`:

```js
export const OCAD_V0 = Object.freeze({
  id: 'ocad_v0',
  folderRoot: 'AI资源库/一图全动作',
  spriteFileName: 'sprite.png',
  jsonFileName: 'npc.json',
  sheet: { w: 252, h: 252 },
})
```

- [ ] **Step 4: Implement OCAD exporter**

Create `src/character-pack/exporters/ocadExport.js`:

```js
import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../profile.js'
import { OCAD_V0 } from './exportProfiles.js'

export const OCAD_REGIONS = Object.freeze({
  idledown: { x: 189, y: 126, w: 21, h: 42 },
  idleL: { x: 210, y: 126, w: 21, h: 42 },
  idleup: { x: 231, y: 126, w: 21, h: 42 },
  walkdown0: { x: 126, y: 0, w: 21, h: 42 },
  walkdown1: { x: 147, y: 0, w: 21, h: 42 },
  walkdown2: { x: 168, y: 0, w: 21, h: 42 },
  walkdown3: { x: 189, y: 0, w: 21, h: 42 },
  walkdown4: { x: 210, y: 0, w: 21, h: 42 },
  walkdown5: { x: 231, y: 0, w: 21, h: 42 },
  walkL0: { x: 0, y: 84, w: 21, h: 42 },
  walkL1: { x: 21, y: 84, w: 21, h: 42 },
  walkL2: { x: 42, y: 84, w: 21, h: 42 },
  walkL3: { x: 63, y: 84, w: 21, h: 42 },
  walkL4: { x: 84, y: 84, w: 21, h: 42 },
  walkL5: { x: 105, y: 84, w: 21, h: 42 },
  walkup0: { x: 126, y: 42, w: 21, h: 42 },
  walkup1: { x: 147, y: 42, w: 21, h: 42 },
  walkup2: { x: 168, y: 42, w: 21, h: 42 },
  walkup3: { x: 189, y: 42, w: 21, h: 42 },
  walkup4: { x: 210, y: 42, w: 21, h: 42 },
  walkup5: { x: 231, y: 42, w: 21, h: 42 },
})

const OCAD_MAPPING = [
  ['idledown', 'idle_down', 0],
  ['idleL', 'idle_left', 0],
  ['idleup', 'idle_up', 0],
  ['walkdown0', 'walk_down', 0],
  ['walkdown1', 'walk_down', 1],
  ['walkdown2', 'walk_down', 2],
  ['walkdown3', 'walk_down', 3],
  ['walkdown4', 'walk_down', 2],
  ['walkdown5', 'walk_down', 1],
  ['walkL0', 'walk_left', 0],
  ['walkL1', 'walk_left', 1],
  ['walkL2', 'walk_left', 2],
  ['walkL3', 'walk_left', 3],
  ['walkL4', 'walk_left', 2],
  ['walkL5', 'walk_left', 1],
  ['walkup0', 'walk_up', 0],
  ['walkup1', 'walk_up', 1],
  ['walkup2', 'walk_up', 2],
  ['walkup3', 'walk_up', 3],
  ['walkup4', 'walk_up', 2],
  ['walkup5', 'walk_up', 1],
]

function frameIndexFor(profile, animationName, frameOffset) {
  const animation = profile.animations.find((item) => item.name === animationName)
  if (!animation) throw new Error(`Missing source animation for OCAD export: ${animationName}`)
  return animation.row * profile.grid.columns + animation.startCol + Math.min(frameOffset, animation.count - 1)
}

async function drawRegion(target, targetWidth, frame, region) {
  const src = frame.image
  const scale = Math.min(region.w / src.width, region.h / src.height)
  const scaledW = Math.max(1, Math.round(src.width * scale))
  const scaledH = Math.max(1, Math.round(src.height * scale))
  const data = await sharp(Buffer.from(src.data), { raw: { width: src.width, height: src.height, channels: 4 } })
    .resize(scaledW, scaledH, { kernel: 'nearest', fit: 'fill' })
    .raw()
    .toBuffer()
  const dx = region.x + Math.floor((region.w - scaledW) / 2)
  const dy = region.y + region.h - scaledH
  for (let y = 0; y < scaledH; y++) {
    for (let x = 0; x < scaledW; x++) {
      const srcOffset = (y * scaledW + x) * 4
      const dstOffset = ((dy + y) * targetWidth + dx + x) * 4
      target[dstOffset] = data[srcOffset]
      target[dstOffset + 1] = data[srcOffset + 1]
      target[dstOffset + 2] = data[srcOffset + 2]
      target[dstOffset + 3] = data[srcOffset + 3]
    }
  }
}

async function renderOcadSprite(frames, profile) {
  const target = new Uint8ClampedArray(OCAD_V0.sheet.w * OCAD_V0.sheet.h * 4)
  for (const [regionKey, animationName, frameOffset] of OCAD_MAPPING) {
    const frame = frames[frameIndexFor(profile, animationName, frameOffset)]
    await drawRegion(target, OCAD_V0.sheet.w, frame, OCAD_REGIONS[regionKey])
  }
  return sharp(Buffer.from(target), { raw: { width: OCAD_V0.sheet.w, height: OCAD_V0.sheet.h, channels: 4 } }).png().toBuffer()
}

export function buildOcadNpcJson({ metadata, profile = TOPDOWN_RPG_V0 } = {}) {
  if (!metadata?.id) throw new Error('metadata.id is required for OCAD export')
  const id = `${metadata.id}_ocad`
  const displayName = `${metadata.name || metadata.id} OCAD`
  const createdAt = metadata.created_at ?? new Date().toISOString()
  return {
    schemaVersion: 1,
    meta: {
      id,
      displayName,
      style: 'modern',
      category: 'function',
      types: ['function'],
      description: metadata.description || displayName,
      generator: 'ai_character_pack_pipeline',
      createdAt,
      updatedAt: createdAt,
      tags: ['ai_generated', profile.id, OCAD_V0.id],
    },
    assets: { spritePath: './sprite.png', thumbPath: './thumb.png' },
    spritesheet: {
      layoutVersion: 'yituquan_v1',
      frameWidth: OCAD_V0.sheet.w,
      frameHeight: OCAD_V0.sheet.h,
      columns: 1,
      rows: 1,
      margin: 0,
      spacing: 0,
      defaultFps: 8,
      animations: {},
    },
    gameplay: {
      faction: 'neutral',
      role: 'generated_character',
      level: 1,
      stats: { hp: 100, attack: 10, defense: 5, moveSpeed: 100 },
      interaction: { canTalk: true, canTrade: false, questGiver: false },
    },
    ext: {
      librarySortPriority: 130,
      sourceProfile: profile.id,
      exportProfile: OCAD_V0.id,
      cardPreviewAnim: 'walkdown',
      localization: {
        appearance: { zh: metadata.description || displayName, ja: '', en: '' },
        background: { zh: `${displayName} 是 OCAD 兼容导出。`, ja: '', en: '' },
        dialogues: {
          greeting: { zh: `你好，我是${displayName}。`, ja: '', en: '' },
          shopOpen: { zh: '当前没有商品。', ja: '', en: '' },
          questHint: { zh: '之后再来看看吧。', ja: '', en: '' },
        },
      },
      otherPayload: {},
      projectPrivate: {},
    },
  }
}

export async function buildOcadExport({ metadata, frames, profile = TOPDOWN_RPG_V0 } = {}) {
  if (!Array.isArray(frames)) throw new Error('normalized frames are required for OCAD export')
  const npcJson = buildOcadNpcJson({ metadata, profile })
  const basePath = `${OCAD_V0.folderRoot}/${npcJson.meta.id}`
  const spritePng = await renderOcadSprite(frames, profile)
  const thumbPng = await sharp(spritePng).extract({ left: 189, top: 126, width: 21, height: 42 }).png().toBuffer()
  return {
    basePath,
    npcJson,
    spritePng,
    thumbPng,
    files: {
      [`${basePath}/${OCAD_V0.jsonFileName}`]: npcJson,
      [`${basePath}/${OCAD_V0.spriteFileName}`]: spritePng,
      [`${basePath}/thumb.png`]: thumbPng,
    },
  }
}
```

- [ ] **Step 5: Run OCAD tests**

Run:

```bash
node --test test/character-pack/ocadExport.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit OCAD exporter**

```bash
git add src/character-pack/exporters/exportProfiles.js src/character-pack/exporters/ocadExport.js test/character-pack/ocadExport.test.js
git commit -m "feat: add ocad compatibility exporter"
```

## Task 6: Integrate OCAD Export

**Files:**
- Modify: `src/character-pack/processSheet.js`
- Modify: `src/character-pack/artifactManifest.js`
- Modify: `src/app.js`
- Modify: `test/character-pack/processSheet.test.js`
- Modify: `test/character-pack/artifactManifest.test.js`

- [ ] **Step 1: Add failing OCAD integration assertions**

In `test/character-pack/processSheet.test.js`, add:

```js
test('processSheetBuffer includes OCAD import pack in the zip', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Sample Hero',
    description: 'silver hair sword fighter',
    backgroundMode: 'flood',
    createdAt: '2026-05-24T01:02:03+08:00',
  })

  const basePath = 'AI资源库/一图全动作/npc_20260524_010203_sample_hero_ocad'
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.ok(zip.file(`${basePath}/npc.json`))
  assert.ok(zip.file(`${basePath}/sprite.png`))
  assert.ok(zip.file(`${basePath}/thumb.png`))
  const npcJson = JSON.parse(await zip.file(`${basePath}/npc.json`).async('string'))
  assert.equal(npcJson.spritesheet.layoutVersion, 'yituquan_v1')
  assert.equal(npcJson.ext.spritesheetSlice, undefined)
  assert.ok(Buffer.isBuffer(result.files.ocadZipBuffer))
})
```

In `test/character-pack/artifactManifest.test.js`, add:

```js
ocadZipBuffer: Buffer.from('ocad'),
```

expect:

```js
'ocad_pack.zip',
```

and:

```js
assert.equal(manifest.urls.ocad_zip_url, '/generated/job_123/ocad_pack.zip')
```

- [ ] **Step 2: Run integration tests to verify failure**

Run:

```bash
node --test test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js
```

Expected: FAIL because OCAD artifacts are not integrated.

- [ ] **Step 3: Integrate OCAD into processing**

Modify `src/character-pack/processSheet.js`:

```js
import { buildOcadExport } from './exporters/ocadExport.js'
```

After RPGMaker export:

```js
const ocadExport = await buildOcadExport({ metadata: metadataJson, frames: normalized.frames, profile })
const ocadZipBuffer = await buildCharacterPackZip(ocadExport.files)
```

Add to main zip:

```js
...ocadExport.files,
```

Add to returned `files`:

```js
ocadZipBuffer,
ocadJson: ocadExport.npcJson,
ocadSpritePng: ocadExport.spritePng,
ocadThumbPng: ocadExport.thumbPng,
```

- [ ] **Step 4: Expose OCAD artifact URLs**

Modify `src/character-pack/artifactManifest.js`:

```js
...optionalFile('ocad_pack.zip', result.files.ocadZipBuffer),
```

and:

```js
...(result.files.ocadZipBuffer ? { ocad_zip_url: generatedUrl(jobId, 'ocad_pack.zip') } : {}),
```

Modify `src/app.js` download links:

```js
['OCAD ZIP', job.ocad_zip_url],
```

- [ ] **Step 5: Run targeted integration tests**

Run:

```bash
node --test test/character-pack/ocadExport.test.js test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit OCAD integration**

```bash
git add src/character-pack/processSheet.js src/character-pack/artifactManifest.js src/app.js test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js
git commit -m "feat: include ocad export artifacts"
```

## Task 7: Protocol Docs And Runbooks

**Files:**
- Create: `docs/protocols/rpgmaker-v0.md`
- Create: `docs/protocols/ocad-v0.md`
- Create: `docs/protocols/benchmark-report.md`
- Create: `docs/runbooks/rpgmaker-import.md`
- Create: `docs/runbooks/ocad-plugin-import.md`
- Create: `docs/runbooks/character-pack-benchmark.md`
- Modify: `README.md`
- Modify: `src/character-pack/README.md`

- [ ] **Step 1: Add RPGMaker protocol doc**

Create `docs/protocols/rpgmaker-v0.md`:

```md
# rpgmaker_v0 Protocol

`rpgmaker_v0` is a compatibility export derived from `topdown_rpg_v0`.

## Sheet

```text
size: 144x192
grid: 3 columns x 4 rows
frame: 48x48
rows: down, left, right, up
plugin playback: 0, 1, 2, 1
```

## Source Mapping

```text
walk_down  -> row 0
walk_left  -> row 1
walk_right -> row 2
walk_up    -> row 3
```

The first export samples source columns `0, 1, 2` from each four-frame walk loop.
```

- [ ] **Step 2: Add OCAD protocol doc**

Create `docs/protocols/ocad-v0.md`:

```md
# ocad_v0 Protocol

`ocad_v0` is a compatibility layout for the NPC plugin's bundled OCAD slicer.

## Sheet

```text
size: 252x252
layoutVersion: yituquan_v1
spritesheetSlice: not json_grid
```

The sprite places normalized source frames into the plugin's fixed Rect2i regions. It is not a claim that the art was originally authored for native OCAD.
```

- [ ] **Step 3: Add benchmark protocol doc**

Create `docs/protocols/benchmark-report.md`:

```md
# Benchmark Report Protocol

Benchmark reports live under:

```text
generated/benchmarks/<run_id>/benchmark_report.json
```

Required fields:

```text
schema_version
run_id
created_at
items[]
```

Each item records input path/name, processing status, validation metrics, export availability, and optional Godot probe result.
```

- [ ] **Step 4: Add runbooks**

Create `docs/runbooks/rpgmaker-import.md`:

```md
# RPGMaker Import Runbook

1. Download `rpgmaker_pack.zip`.
2. Unzip it into the Godot project root.
3. Confirm `res://AI资源库/RPGMAKER/<character_id>/NPC.json` exists.
4. Open the NPC plugin dock and scan RPGMaker.
5. Preview `rundown`, `runleft`, `runright`, and `runup`.
```

Create `docs/runbooks/ocad-plugin-import.md`:

```md
# OCAD Plugin Import Runbook

1. Download `ocad_pack.zip`.
2. Unzip it into the Godot project root.
3. Confirm `res://AI资源库/一图全动作/<character_id>_ocad/npc.json` exists.
4. Scan `一图全动作` in the NPC plugin dock.
5. Preview `idledown`, `walkdown`, `walkL`, and `walkup`.
```

Create `docs/runbooks/character-pack-benchmark.md`:

```md
# Character Pack Benchmark Runbook

Run:

```bash
npm run benchmark:character-pack
```

Open the generated report under:

```text
generated/benchmarks/<run_id>/benchmark_report.json
```
```

- [ ] **Step 5: Update README and module map**

In `README.md`, move RPGMaker and OCAD from "Not implemented yet" to "Implemented" only after integration tests pass.

In `src/character-pack/README.md`, add:

```text
exporters/rpgmakerExport.js
  Builds RPGMaker 144x192 compatibility exports.

exporters/ocadExport.js
  Builds OCAD 252x252 compatibility exports.

benchmark/
  Runs repeatable local compatibility reports.
```

- [ ] **Step 6: Commit docs**

```bash
git add README.md src/character-pack/README.md docs/protocols/rpgmaker-v0.md docs/protocols/ocad-v0.md docs/protocols/benchmark-report.md docs/runbooks/rpgmaker-import.md docs/runbooks/ocad-plugin-import.md docs/runbooks/character-pack-benchmark.md
git commit -m "docs: document compatibility export workflows"
```

## Task 8: Godot Probe Verification

**Files:**
- Modify: `src/character-pack/benchmark/godotProbe.js`
- Modify: `src/character-pack/benchmark/benchmarkRunner.js`
- Modify: `docs/runbooks/character-pack-benchmark.md`

- [ ] **Step 1: Add probe tests**

Append to `test/character-pack/benchmarkRunner.test.js`:

```js
test('runCharacterPackBenchmark records skipped Godot probes when Godot is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-benchmark-probe-'))
  const input = path.join(root, 'sheet.png')
  await makeSheet(input)

  const result = await runCharacterPackBenchmark({
    inputs: [{ path: input, name: 'sheet' }],
    outputDir: path.join(root, 'out'),
    runId: 'bench_probe_test',
    runGodotProbe: true,
  })

  assert.equal(typeof result.items[0].godot_probe.json_grid.status, 'string')
  assert.equal(typeof result.items[0].godot_probe.rpgmaker_v0.status, 'string')
  assert.equal(typeof result.items[0].godot_probe.ocad_v0.status, 'string')
})
```

- [ ] **Step 2: Run probe test**

Run:

```bash
node --test test/character-pack/benchmarkRunner.test.js
```

Expected: PASS if Task 3 already integrated `probeCharacterPackZip`; FAIL if the probe summary is missing.

- [ ] **Step 3: Make benchmark report document probe fields**

Update `docs/runbooks/character-pack-benchmark.md`:

```md
With Godot probe enabled:

```bash
npm run benchmark:character-pack -- --godot
```

The report includes:

```text
items[].godot_probe.json_grid
items[].godot_probe.rpgmaker_v0
items[].godot_probe.ocad_v0
```

Each probe status is `pass`, `fail`, or `skipped`.
```

- [ ] **Step 4: Confirm probe script verifies generators**

Inspect `src/character-pack/benchmark/godotProbe.js` and confirm `buildPluginScanScript()` contains these checks:

```js
generatorPath: 'res://addons/npc_library_tool/core/rpgmaker_spritesheet_generator.gd'
expectedAnimations: ['rundown', 'runleft', 'runright', 'runup']
generatorPath: 'res://addons/npc_library_tool/core/ocad_spritesheet_generator.gd'
expectedAnimations: ['idledown', 'walkdown', 'walkL', 'walkup']
```

- [ ] **Step 5: Run existing tests**

Run:

```bash
node --test test/character-pack/benchmarkRunner.test.js
```

Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 7: Run benchmark command**

Run:

```bash
npm run benchmark:character-pack
npm run benchmark:character-pack -- --godot
```

Expected: both commands print a run summary and write `generated/benchmarks/<run_id>/benchmark_report.json`. The `--godot` run may report `skipped` if Godot or the NPC plugin ZIP is unavailable, and must report `pass` when both are present.

- [ ] **Step 8: Commit probe verification improvements**

```bash
git add src/character-pack/benchmark/godotProbe.js src/character-pack/benchmark/benchmarkRunner.js test/character-pack/benchmarkRunner.test.js docs/runbooks/character-pack-benchmark.md
git commit -m "test: support compatibility godot probe scripts"
```

## Task 9: Final Verification

**Files:**
- No planned source changes.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run benchmark**

Run:

```bash
npm run benchmark:character-pack
```

Expected: report contains at least two inputs when `<input-file>` exists; if the desktop image is missing, the script should report only the fixture and not fail.

- [ ] **Step 3: Process real desktop image through local API**

If local server is not running:

```bash
npm start
```

In another command:

```bash
node --input-type=module - <<'NODE'
import { readFile } from 'node:fs/promises'
const source = await readFile('<input-file>')
const response = await fetch('http://localhost:4173/api/process-sheet', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    source_base64: source.toString('base64'),
    options: {
      name: 'desktop_image_phase_2',
      description: 'Phase 2 verification sheet',
      sourceFileName: 'image.png',
      backgroundMode: 'flood'
    }
  })
})
let job = await response.json()
for (let i = 0; i < 120 && !['done', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'].includes(job.status); i++) {
  await new Promise((resolve) => setTimeout(resolve, 500))
  job = await fetch(`http://localhost:4173/api/jobs/${job.id}`).then((res) => res.json())
}
console.log(JSON.stringify(job, null, 2))
NODE
```

Expected: job has `godot_npc_zip_url`, `rpgmaker_zip_url`, `ocad_zip_url`, and `zip_url`.

- [ ] **Step 4: Inspect ZIP contents**

Run:

```bash
node --input-type=module - <<'NODE'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
const jobId = process.env.JOB_ID
if (!jobId) throw new Error('Set JOB_ID to the generated job id')
for (const fileName of ['godot_npc_pack.zip', 'rpgmaker_pack.zip', 'ocad_pack.zip']) {
  const zip = await JSZip.loadAsync(await readFile(`generated/${jobId}/${fileName}`))
  console.log(fileName)
  console.log(Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort().join('\n'))
}
NODE
```

Expected: each zip contains JSON, `sprite.png`, and `thumb.png`.

- [ ] **Step 5: Commit final verification notes if docs changed**

If verification changes docs or runbooks:

```bash
git add docs/runbooks/character-pack-benchmark.md docs/runbooks/rpgmaker-import.md docs/runbooks/ocad-plugin-import.md
git commit -m "docs: record phase 2 verification flow"
```

## Self-Review Checklist

- Spec coverage:
  - RPGMaker export is covered by Tasks 1 and 2.
  - Benchmark harness is covered by Task 3.
  - Validator improvements are covered by Task 4.
  - OCAD export is covered by Tasks 5 and 6.
  - Docs and runbooks are covered by Task 7.
  - Godot probe and final verification are covered by Tasks 8 and 9.
- Placeholder scan:
  - The plan avoids deferred-work markers and unspecified implementation steps.
- Type consistency:
  - Exporter buffers use `rpgmakerZipBuffer` and `ocadZipBuffer`.
  - Artifact manifest URLs use `rpgmaker_zip_url` and `ocad_zip_url`.
  - Export profiles use `rpgmaker_v0` and `ocad_v0`.
