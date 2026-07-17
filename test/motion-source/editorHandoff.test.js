import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  buildEditorHandoffManifest,
  runOptionalEditorHandoff,
  writeEditorHandoffArtifacts,
} from '../../src/motion-source/editorHandoff.js'
import { buildEditorFramesJson } from '../../src/motion-source/editorJson.js'

test('buildEditorHandoffManifest describes same-size strip re-import contract', () => {
  const manifest = buildEditorHandoffManifest({
    action: 'walk_down',
    stripPath: 'normalized_motion_strip.png',
    editorJsonPath: 'editor_frames.json',
    frameCount: 8,
    cellSize: [96, 96],
    sheetSize: { w: 768, h: 96 },
  })

  assert.equal(manifest.mode, 'motion_source_editor_handoff_manifest_v1')
  assert.equal(manifest.action, 'walk_down')
  assert.deepEqual(manifest.strip.size, { w: 768, h: 96 })
  assert.equal(manifest.reimport_contract.required_same_size, true)
  assert.deepEqual(manifest.reimport_contract.expected_size, { w: 768, h: 96 })
  assert.equal(manifest.local_editor.env_var, 'SPRITE_EDITOR_PATH')
})

test('runOptionalEditorHandoff skips cleanly when local editor path is absent', async () => {
  const result = await runOptionalEditorHandoff({
    env: {},
    inputPaths: ['frame_000.png'],
    sheetPath: 'out.png',
    dataPath: 'out.json',
    sheetWidth: 384,
  })

  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'missing_sprite_editor_path')
  assert.equal(result.command, null)
})

test('runOptionalEditorHandoff calls the configured local editor without shell wrapping', async () => {
  const calls = []
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    queueMicrotask(() => child.emit('close', 0))
    return child
  }

  const result = await runOptionalEditorHandoff({
    env: { SPRITE_EDITOR_PATH: '/Applications/PixelTool.app/Contents/MacOS/pixeltool' },
    inputPaths: ['frame_000.png', 'frame_001.png'],
    sheetPath: 'out.png',
    dataPath: 'out.json',
    sheetWidth: 384,
    cwd: '/tmp/project',
    spawn: fakeSpawn,
  })

  assert.equal(result.status, 'done')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, '/Applications/PixelTool.app/Contents/MacOS/pixeltool')
  assert.deepEqual(calls[0].args.slice(0, 3), ['-b', 'frame_000.png', 'frame_001.png'])
  assert.equal(calls[0].args[calls[0].args.indexOf('--sheet') + 1], 'out.png')
  assert.equal(calls[0].args[calls[0].args.indexOf('--data') + 1], 'out.json')
  assert.equal(calls[0].args[calls[0].args.indexOf('--format') + 1], 'json-array')
  assert.equal(calls[0].args[calls[0].args.indexOf('--sheet-width') + 1], '384')
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.cwd, '/tmp/project')
})

test('writeEditorHandoffArtifacts writes editor JSON and manifest files', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'motion-editor-handoff-'))
  const editorFrames = buildEditorFramesJson({ action: 'idle_down', frameCount: 4 })
  const manifest = buildEditorHandoffManifest({
    action: 'idle_down',
    frameCount: 4,
    cellSize: [96, 96],
    sheetSize: { w: 384, h: 96 },
  })

  const result = await writeEditorHandoffArtifacts({ outDir, editorFramesJson: editorFrames, manifest })
  assert.equal(result.editor_frames_json, path.join(outDir, 'editor_frames.json'))
  assert.equal(result.editor_handoff_manifest_json, path.join(outDir, 'editor_handoff_manifest.json'))
  assert.equal(JSON.parse(await readFile(result.editor_frames_json, 'utf8')).meta.frameTags[0].name, 'idle_down')
  assert.equal(JSON.parse(await readFile(result.editor_handoff_manifest_json, 'utf8')).action, 'idle_down')
})
