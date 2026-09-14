import { initStudioSettings, refreshStudioSettingsLanguage } from './settingsView.js'
import { initStudioCharacter, renderStudioCharacterLanguage } from './characterView.js'
import { initStudioAction, renderStudioActionLanguage } from './actionView.js'
import { initStudioSequence, renderStudioSequenceLanguage } from './sequenceView.js'
import { initStudioTiles, renderStudioTilesLanguage } from './tilesView.js'
import { initStudioScene, renderStudioSceneLanguage } from './sceneView.js'
import { initStudioProject, renderStudioProjectLanguage } from './projectView.js'
import { initStudioQa, renderStudioQaLanguage } from './qaView.js'
import { initStudioPromptAssistants } from './promptAssistantView.js'
import { getCurrentLanguage } from '../i18n.js'

const STUDIO_ROUTES = Object.freeze(['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'])

let routerStarted = false
let characterInitializationPromise = null
let actionInitializationPromise = null
let sequenceInitializationPromise = null
let tilesInitializationPromise = null
let sceneInitializationPromise = null
let projectInitializationPromise = null
let qaInitializationPromise = null

const STUDIO_TITLES = Object.freeze({
  zh: Object.freeze({
    character: 'MoteWeave · 角色工作室',
    action: 'MoteWeave · 动作源',
    sequence: 'MoteWeave · 序列工作室',
    tiles: 'MoteWeave · 图块工作室',
    scene: 'MoteWeave · 场景工坊',
    project: 'MoteWeave · 项目包',
    qa: 'MoteWeave · 验收检查',
    settings: 'MoteWeave · 设置',
  }),
  en: Object.freeze({
    character: 'MoteWeave · Character Studio',
    action: 'MoteWeave · Action Source',
    sequence: 'MoteWeave · Sequence Studio',
    tiles: 'MoteWeave · Tiles Studio',
    scene: 'MoteWeave · Scene Studio',
    project: 'MoteWeave · Project Pack',
    qa: 'MoteWeave · QA Checklist',
    settings: 'MoteWeave · Settings',
  }),
})

export function studioServiceAvailable(locationValue = globalThis.location) {
  return ['http:', 'https:'].includes(locationValue?.protocol)
}

export function renderStudioRuntimeAvailability(available = studioServiceAvailable()) {
  document.documentElement.classList.toggle('studio-file-mode', !available)
  document.querySelectorAll('[data-studio-server-required]').forEach((control) => {
    if (!available) {
      control.setAttribute('aria-disabled', 'true')
      if ('disabled' in control) control.disabled = true
      else control.tabIndex = -1
      return
    }
    control.removeAttribute('aria-disabled')
    if (!('disabled' in control)) control.removeAttribute('tabindex')
  })
  return available
}

export function resolveStudioRoute(hash = globalThis.location?.hash ?? '') {
  const route = String(hash).replace(/^#/, '')
  return STUDIO_ROUTES.includes(route) ? route : 'character'
}

export function renderStudioRoute(route = resolveStudioRoute(), { focus = false } = {}) {
  const activeRoute = STUDIO_ROUTES.includes(route) ? route : 'character'
  const language = getCurrentLanguage() === 'en' ? 'en' : 'zh'
  document.title = STUDIO_TITLES[language][activeRoute]
  document.querySelectorAll('[data-studio-view]').forEach((view) => {
    view.hidden = view.dataset.studioView !== activeRoute
  })
  document.querySelectorAll('[data-studio-route]').forEach((link) => {
    const active = link.dataset.studioRoute === activeRoute
    link.classList.toggle('is-active', active)
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
  if (activeRoute === 'character') renderStudioCharacterLanguage()
  else if (activeRoute === 'action') renderStudioActionLanguage()
  else if (activeRoute === 'sequence') renderStudioSequenceLanguage()
  else if (activeRoute === 'tiles') renderStudioTilesLanguage()
  else if (activeRoute === 'scene') renderStudioSceneLanguage()
  else if (activeRoute === 'project') renderStudioProjectLanguage()
  else if (activeRoute === 'qa') renderStudioQaLanguage()
  else if (activeRoute === 'settings') refreshStudioSettingsLanguage()
  if (focus) {
    const activeView = document.querySelector(`[data-studio-view="${activeRoute}"]`)
    const heading = activeView?.querySelector('h1')
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
  }
  return activeRoute
}

export function initStudioRouter() {
  if (routerStarted) return renderStudioRoute()
  routerStarted = true
  globalThis.addEventListener?.('hashchange', () => renderStudioRoute(resolveStudioRoute(), { focus: true }))
  document.querySelector('#language-select')?.addEventListener('change', () => {
    renderStudioRoute(resolveStudioRoute())
  })
  return renderStudioRoute()
}

export function bootStudio() {
  const serviceAvailable = renderStudioRuntimeAvailability()
  const settingsInitialization = initStudioSettings({ serviceAvailable })
  if (!characterInitializationPromise) {
    characterInitializationPromise = Promise.resolve(initStudioCharacter({ serviceAvailable }))
  }
  if (!actionInitializationPromise) {
    actionInitializationPromise = Promise.resolve(initStudioAction({ serviceAvailable }))
  }
  if (!sequenceInitializationPromise) {
    sequenceInitializationPromise = Promise.resolve(initStudioSequence({ serviceAvailable }))
  }
  if (!tilesInitializationPromise) {
    tilesInitializationPromise = Promise.resolve(initStudioTiles({ serviceAvailable }))
  }
  if (!sceneInitializationPromise) {
    sceneInitializationPromise = Promise.resolve(initStudioScene({ serviceAvailable }))
  }
  if (!projectInitializationPromise) {
    projectInitializationPromise = Promise.resolve(initStudioProject({ serviceAvailable }))
  }
  if (!qaInitializationPromise) {
    qaInitializationPromise = Promise.resolve(initStudioQa())
  }
  initStudioRouter()
  initStudioPromptAssistants()
  return Promise.allSettled([
    settingsInitialization,
    characterInitializationPromise,
    actionInitializationPromise,
    sequenceInitializationPromise,
    tilesInitializationPromise,
    sceneInitializationPromise,
    projectInitializationPromise,
    qaInitializationPromise,
  ])
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootStudio()
  }, { once: true })
} else {
  void bootStudio()
}
