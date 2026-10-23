const STUDIO_ENTRY_PATH = '/src/ui/studio/studio.html'

export const LEGACY_STUDIO_TAB_ROUTES = Object.freeze({
  'motion-source': 'action',
  sprite: 'sequence',
  'two-point-five-d': 'tiles',
  'project-pack': 'project',
  qa: 'qa',
  'character-pack': 'character',
  prompts: 'tiles',
})

export function legacyStudioRedirectLocation(search = '') {
  const tabs = new URLSearchParams(String(search ?? '')).getAll('tab')
  const tab = tabs.length === 1 && Object.hasOwn(LEGACY_STUDIO_TAB_ROUTES, tabs[0])
    ? tabs[0]
    : null
  const route = tab ? LEGACY_STUDIO_TAB_ROUTES[tab] : 'character'
  return `${STUDIO_ENTRY_PATH}#${route}`
}
