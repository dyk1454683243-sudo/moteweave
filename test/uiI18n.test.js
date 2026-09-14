import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

import { LANGUAGE_STORAGE_KEY, TRANSLATIONS, normalizeLanguage, t } from '../src/ui/i18n.js'

test('ui i18n exposes stable Chinese and English labels', () => {
  assert.equal(LANGUAGE_STORAGE_KEY, 'gameToolLanguage')
  assert.equal(normalizeLanguage('zh-CN'), 'zh')
  assert.equal(normalizeLanguage('en-US'), 'en')
  assert.equal(normalizeLanguage('fr-FR'), null)

  assert.equal(t('character.asset.title', {}, 'zh'), '1. 资产定义')
  assert.equal(t('character.asset.title', {}, 'en'), '1. ASSET DEFINITION')
  assert.equal(t('character.export.downloadAvailable', { count: 3 }, 'zh'), '可下载 (3)')
  assert.equal(t('character.export.downloadAvailable', { count: 3 }, 'en'), 'Download Available (3)')
  assert.equal(t('character.animation.idleDown', {}, 'zh'), '待机下')
  assert.equal(t('character.animation.idleDown', {}, 'en'), 'Idle Down')
})

test('character pack bilingual dictionary keeps matching key coverage', () => {
  const englishKeys = Object.keys(TRANSLATIONS.en).filter((key) => key.startsWith('character.')).sort()
  const chineseKeys = Object.keys(TRANSLATIONS.zh).filter((key) => key.startsWith('character.')).sort()

  assert.deepEqual(chineseKeys, englishKeys)
  for (const key of englishKeys) {
    const englishVariables = [...TRANSLATIONS.en[key].matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
      .map((match) => match[1])
      .sort()
    const chineseVariables = [...TRANSLATIONS.zh[key].matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
      .map((match) => match[1])
      .sort()
    assert.deepEqual(chineseVariables, englishVariables, `${key} placeholder mismatch`)
  }
})

test('character pack UI JavaScript keeps user-facing Chinese in the translation dictionary', async () => {
  const featureDirectory = 'src/ui/characterPack'
  const featureModules = (await readdir(featureDirectory))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `${featureDirectory}/${name}`)
  const paths = [
    ...featureModules,
    'src/ui/dom.js',
  ]
  const violations = []
  const missingTranslationKeys = []
  const knownTranslationKeys = new Set(Object.keys(TRANSLATIONS.en))

  for (const path of paths) {
    const source = await readFile(path, 'utf8')
    if (/[\u3400-\u9fff]/u.test(source)) violations.push(path)
    for (const match of source.matchAll(/['"`](character\.[a-zA-Z0-9_.]+)['"`]/g)) {
      if (!knownTranslationKeys.has(match[1])) {
        missingTranslationKeys.push(`${path}: ${match[1]}`)
      }
    }
  }

  assert.deepEqual(violations, [])
  assert.deepEqual(missingTranslationKeys, [])
})
