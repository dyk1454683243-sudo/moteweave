import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import JSZip from 'jszip'
import sharp from 'sharp'

import {
  MOTION_TARGET_FRAME_INDEXES,
  acceptanceLoopbackUrl,
  buildDeterministicMotionZip,
  changedSheetCellIndexes,
} from '../scripts/first-user-acceptance-helpers.mjs'

test('first-user acceptance base URL is restricted to HTTP loopback', () => {
  assert.equal(acceptanceLoopbackUrl('http://127.0.0.1:4173').origin, 'http://127.0.0.1:4173')
  assert.equal(acceptanceLoopbackUrl('http://localhost:4173').origin, 'http://localhost:4173')
  assert.equal(acceptanceLoopbackUrl('http://[::1]:4173').origin, 'http://[::1]:4173')
  assert.throws(() => acceptanceLoopbackUrl('https://127.0.0.1:4173'), /HTTP loopback/)
  assert.throws(() => acceptanceLoopbackUrl('http://example.com:4173'), /HTTP loopback/)
  assert.throws(() => acceptanceLoopbackUrl('http://user:secret@127.0.0.1:4173'), /credentials/)
})

test('first-user Motion ZIP is deterministic and contains six 96x96 frames', async () => {
  const fixture = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const normalizedFixture = await sharp(fixture)
    .resize(768, 768, { kernel: 'nearest' })
    .png()
    .toBuffer()
  const first = await buildDeterministicMotionZip(normalizedFixture)
  const second = await buildDeterministicMotionZip(normalizedFixture)
  assert.deepEqual(first, second)
  const zip = await JSZip.loadAsync(first)
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  assert.deepEqual(entries.map((entry) => entry.name), [
    'frame_01.png',
    'frame_02.png',
    'frame_03.png',
    'frame_04.png',
    'frame_05.png',
    'frame_06.png',
  ])
  for (const entry of entries) {
    const metadata = await sharp(await entry.async('nodebuffer')).metadata()
    assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 96, height: 96 })
  }
})

test('first-user cell comparator reports only changed target cells', async () => {
  const fixture = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const normalizedFixture = await sharp(fixture)
    .resize(768, 768, { kernel: 'nearest' })
    .png()
    .toBuffer()
  const { data, info } = await sharp(normalizedFixture).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const changed = Buffer.from(data)
  for (const frameIndex of MOTION_TARGET_FRAME_INDEXES) {
    const left = (frameIndex % 8) * 96
    const top = Math.floor(frameIndex / 8) * 96
    const offset = (top * info.width + left) * 4
    changed[offset] ^= 1
  }
  const changedPng = await sharp(changed, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer()
  assert.deepEqual(await changedSheetCellIndexes(normalizedFixture, changedPng), MOTION_TARGET_FRAME_INDEXES)
})
