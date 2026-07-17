import {
  CHARACTER_PRESETS,
  SCENE_PRESETS,
  buildCharacterPrompt,
  buildScenePrompt,
} from '../pixelPipeline.js'
import { $, fillSelect, showToast } from './dom.js'

function syncPrompts() {
  $('#scene-output').value = buildScenePrompt({
    view: $('#scene-view').value,
    theme: $('#scene-theme').value,
    composition: $('#scene-composition').value,
    style: $('#scene-style').value,
  })
  $('#character-output').value = buildCharacterPrompt({
    preset: $('#character-preset').value,
    character: $('#character-description').value,
    hasReferenceImage: $('#has-reference').checked,
  })
}

function keepActiveModuleTabVisible() {
  const tabs = document.querySelector('.app-header .tabs')
  const active = tabs?.querySelector('.tab-button.active')
  if (!tabs || !active || tabs.scrollWidth <= tabs.clientWidth + 1) return
  const tabsRect = tabs.getBoundingClientRect()
  const activeRect = active.getBoundingClientRect()
  if (activeRect.left < tabsRect.left) {
    tabs.scrollLeft += activeRect.left - tabsRect.left - 8
  } else if (activeRect.right > tabsRect.right) {
    tabs.scrollLeft += activeRect.right - tabsRect.right + 8
  }
}

let activeTabResizeFrame = null

function scheduleActiveModuleTabVisibility() {
  if (activeTabResizeFrame != null) cancelAnimationFrame(activeTabResizeFrame)
  activeTabResizeFrame = requestAnimationFrame(() => {
    activeTabResizeFrame = null
    keepActiveModuleTabVisible()
  })
}

function activateTab(tabId) {
  document.querySelectorAll('.tab-button').forEach((button) => {
    const panelId = button.dataset.tab
    const active = panelId === tabId
    if (!button.id && panelId) button.id = `${panelId}-tab`
    button.classList.toggle('active', active)
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', panelId)
    button.setAttribute('aria-selected', String(active))
  })
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const active = panel.id === tabId
    panel.classList.toggle('active', active)
    panel.hidden = !active
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', `${panel.id}-tab`)
  })
  document.body.dataset.activeTab = tabId
  keepActiveModuleTabVisible()
}

async function copyOutput(id) {
  const value = $(`#${id}`).value
  await navigator.clipboard.writeText(value)
  showToast('已复制')
}

export function initPromptTabs() {
  fillSelect($('#scene-view'), SCENE_PRESETS)
  fillSelect($('#character-preset'), CHARACTER_PRESETS)
  syncPrompts()
  document.querySelector('.tabs')?.setAttribute('role', 'tablist')

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab))
  })
  window.addEventListener('resize', scheduleActiveModuleTabVisibility)
  const activeTab = document.querySelector('.tab-button.active')?.dataset.tab
  if (activeTab) activateTab(activeTab)
  $('#scene-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    syncPrompts()
  })
  $('#character-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    syncPrompts()
  })

  $('#generate-scene-prompts-btn')?.addEventListener('click', (event) => {
    event.preventDefault()
    syncPrompts()
  })
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => copyOutput(button.dataset.copy))
  })
}
