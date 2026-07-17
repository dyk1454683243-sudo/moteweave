import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import {
  buildWebsiteOgPng,
  buildWebsiteOgRgba,
  WEBSITE_OG_HEIGHT,
  WEBSITE_OG_PATH,
  WEBSITE_OG_WIDTH,
} from '../../scripts/create-website-og.mjs'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..', '..')

test('website OG generation is deterministic and matches the committed pixels', async () => {
  const [first, second, expected, committed] = await Promise.all([
    buildWebsiteOgPng({ rootDir: projectRoot }),
    buildWebsiteOgPng({ rootDir: projectRoot }),
    buildWebsiteOgRgba({ rootDir: projectRoot }),
    readFile(path.join(projectRoot, WEBSITE_OG_PATH)),
  ])
  assert.deepEqual(first, second)

  const actual = await sharp(committed).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(actual.info.width, WEBSITE_OG_WIDTH)
  assert.equal(actual.info.height, WEBSITE_OG_HEIGHT)
  assert.equal(actual.info.channels, 4)
  assert.deepEqual(actual.data, Buffer.from(expected.data))
})

test('website OG provenance binds the committed hash and generator', async () => {
  const [committed, provenance] = await Promise.all([
    readFile(path.join(projectRoot, WEBSITE_OG_PATH)),
    readFile(path.join(projectRoot, 'configs/public-asset-provenance.json'), 'utf8').then(JSON.parse),
  ])
  const asset = provenance.assets.find((item) => item.path === WEBSITE_OG_PATH)
  assert.ok(asset)
  assert.equal(asset.source_rights, 'repository_owned')
  assert.equal(asset.release_status, 'approved')
  assert.equal(asset.generator, 'scripts/create-website-og.mjs')
  assert.equal(asset.sha256, crypto.createHash('sha256').update(committed).digest('hex'))
})
