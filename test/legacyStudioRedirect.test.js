import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LEGACY_STUDIO_TAB_ROUTES,
  legacyStudioRedirectLocation,
} from '../src/server/legacyStudioRedirect.js'

test('already-covered legacy tabs redirect through a fixed Studio whitelist', () => {
  assert.deepEqual(LEGACY_STUDIO_TAB_ROUTES, {
    'motion-source': 'action',
    sprite: 'sequence',
    'two-point-five-d': 'tiles',
    'project-pack': 'project',
    qa: 'qa',
    'character-pack': 'character',
    prompts: 'scene',
  })
  for (const [tab, route] of Object.entries(LEGACY_STUDIO_TAB_ROUTES)) {
    assert.equal(
      legacyStudioRedirectLocation(`?tab=${encodeURIComponent(tab)}`),
      tab === 'prompts'
        ? '/src/ui/studio/studio.html?open=scene-prompt#scene'
        : `/src/ui/studio/studio.html#${route}`,
    )
  }
})

test('unknown, missing, repeated, and illegal tabs use the fixed Character fallback', () => {
  for (const search of [
    '',
    '?tab=',
    '?tab=unknown',
    '?tab=qa&tab=motion-source',
    '?tab=prompts&tab=prompts',
    '?tab=qa%23settings',
    '?tab=%2F%2Fexample.test',
    '?tab=__proto__',
    '?tab=constructor',
    '?tab=toString',
  ]) assert.equal(
    legacyStudioRedirectLocation(search),
    '/src/ui/studio/studio.html#character',
  )
})

test('unrelated query parameters never participate in the fixed redirect location', () => {
  assert.equal(
    legacyStudioRedirectLocation('?next=https%3A%2F%2Fexample.test&tab=qa&open=anything'),
    '/src/ui/studio/studio.html#qa',
  )
  assert.equal(
    legacyStudioRedirectLocation('?next=https%3A%2F%2Fexample.test&tab=prompts&open=anything'),
    '/src/ui/studio/studio.html?open=scene-prompt#scene',
  )
})
