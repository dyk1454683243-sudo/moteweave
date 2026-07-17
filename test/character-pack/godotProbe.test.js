import test from 'node:test'
import assert from 'node:assert/strict'

import {
  probeCharacterPackZip,
  runGodotProbe,
} from '../../src/character-pack/benchmark/godotProbe.js'

test('Godot probe requires explicit configuration instead of a workstation path', async () => {
  const previous = process.env.GODOT_BIN
  delete process.env.GODOT_BIN
  try {
    assert.deepEqual(
      await runGodotProbe({ scriptSource: 'extends SceneTree' }),
      { available: false, status: 'skipped', reason: 'godot_not_configured' }
    )
  } finally {
    if (previous === undefined) delete process.env.GODOT_BIN
    else process.env.GODOT_BIN = previous
  }
})

test('character-pack plugin probe requires an explicit plugin ZIP', async () => {
  const previousGodot = process.env.GODOT_BIN
  const previousPlugin = process.env.NPC_PLUGIN_ZIP
  delete process.env.NPC_PLUGIN_ZIP
  try {
    assert.deepEqual(
      await probeCharacterPackZip({
        exportZipBuffer: Buffer.from('not-read-before-configuration'),
        godotBin: process.execPath,
      }),
      { available: false, status: 'skipped', reason: 'plugin_zip_not_configured' }
    )
  } finally {
    if (previousGodot === undefined) delete process.env.GODOT_BIN
    else process.env.GODOT_BIN = previousGodot
    if (previousPlugin === undefined) delete process.env.NPC_PLUGIN_ZIP
    else process.env.NPC_PLUGIN_ZIP = previousPlugin
  }
})
