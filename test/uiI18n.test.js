import test from 'node:test'
import assert from 'node:assert/strict'

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
})

test('character pack bilingual dictionary keeps matching key coverage', () => {
  const englishKeys = Object.keys(TRANSLATIONS.en).filter((key) => key.startsWith('character.')).sort()
  const chineseKeys = Object.keys(TRANSLATIONS.zh).filter((key) => key.startsWith('character.')).sort()

  assert.deepEqual(chineseKeys, englishKeys)
})
