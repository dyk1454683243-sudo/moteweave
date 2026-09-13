import {
  CHARACTER_PRESETS,
  SCENE_PRESETS,
  buildCharacterPrompt,
  buildScenePrompt,
} from '../../pixelPipeline.js'
import { getCurrentLanguage } from '../i18n.js'

export const PROMPT_ASSISTANT_DEFAULTS = Object.freeze({
  character: Object.freeze({
    preset: 'character-v2',
    character: '一个披风游侠，深绿斗篷，银色短剑，轮廓清晰。',
    hasReferenceImage: true,
  }),
  scene: Object.freeze({
    view: 'topdown-front',
    theme: '森林遗迹与清晰可通行道路',
    composition: '主体、入口、道路和边界层次清楚',
    style: '清晰像素块、统一调色、明确光源',
  }),
})

export const PROMPT_ASSISTANT_COPY = Object.freeze({
  en: Object.freeze({
    entry: 'Prompt helper',
    characterTitle: 'Character prompt helper',
    sceneTitle: 'Scene prompt helper',
    deterministic: 'DETERMINISTIC LOCAL TEXT · 0 FETCH / 0 STORAGE',
    characterHelp: 'Uses the existing buildCharacterPrompt directly; it never fills the generation form automatically.',
    sceneHelp: 'Uses the existing buildScenePrompt directly; it never fills the import or online-generation form automatically.',
    preset: 'Character preset',
    character: 'Character description',
    reference: 'Reference image is present',
    referenceHelp: 'Only changes the deterministic reference instruction',
    view: 'View preset',
    theme: 'Theme',
    composition: 'Composition',
    style: 'Style',
    output: 'Deterministic prompt',
    outputHelp: 'Parameter order is fixed; identical inputs produce identical text.',
    sceneOutputHelp: 'The same four inputs produce the same text.',
    generate: 'Generate',
    copy: 'Copy',
    reset: 'Reset',
    close: 'Close',
    closeAria: 'Close prompt helper',
    goCharacter: 'Go to Character helper',
    copied: 'Prompt copied.',
    copyFailed: 'Clipboard access failed. Select and copy the prompt manually.',
  }),
  zh: Object.freeze({
    entry: '提示词助手',
    characterTitle: '角色提示词助手',
    sceneTitle: '场景提示词助手',
    deterministic: '确定性本地文本 · 0 fetch / 0 storage',
    characterHelp: '直接使用现有 buildCharacterPrompt；不会自动填充生成表单。',
    sceneHelp: '直接使用现有 buildScenePrompt；不会自动填充导入或在线生成表单。',
    preset: '角色预设',
    character: '角色描述',
    reference: '存在参考图',
    referenceHelp: '只影响确定性提示词中的参考说明',
    view: '视角预设',
    theme: '主题',
    composition: '构图',
    style: '风格',
    output: '确定性提示词',
    outputHelp: '参数顺序固定；相同输入产生相同文本。',
    sceneOutputHelp: '相同四项输入产生相同文本。',
    generate: '生成',
    copy: '复制',
    reset: '重置',
    close: '关闭',
    closeAria: '关闭提示词助手',
    goCharacter: '前往角色助手',
    copied: '提示词已复制。',
    copyFailed: '无法访问剪贴板，请手动选择并复制提示词。',
  }),
})

const PROMPT_ASSISTANT_OPTION_COPY = Object.freeze({
  en: Object.freeze({
    character: Object.freeze({
      'rpgmaker-v1': 'RPG Maker V1',
      'rpgmaker-v3': 'RPG Maker V3',
      'character-v2': 'Character V2',
      'character-v2-2': 'Character V2.2',
      'character-v3': 'Character V3',
      'character-v2-3ot': 'V2.3OT',
      monster: 'Monster',
      animal: 'Animal',
      'horizontal-character': 'Side-view character',
      'topdown-8dir': '8-direction TopDown',
      'horse-riding': 'Horse riding',
      'one-image-all-actions': 'One image · all actions',
    }),
    scene: Object.freeze({
      'topdown-front': 'TopDown front',
      'topdown-45': 'TopDown 45°',
      'terraria-side': 'Side-view exploration',
      'arcade-side': 'Side-view arcade',
    }),
  }),
  zh: Object.freeze({
    character: Object.freeze({ ...CHARACTER_PRESETS }),
    scene: Object.freeze(Object.fromEntries(
      Object.entries(SCENE_PRESETS).map(([key, value]) => [key, value.label]),
    )),
  }),
})

const ASSISTANTS = Object.freeze({
  character: Object.freeze({
    rootId: 'studio-character-view',
    drawerId: 'studio-character-prompt-drawer',
    shadeId: 'studio-character-prompt-shade',
    openerId: 'studio-character-prompt-open',
    titleId: 'studio-character-prompt-title',
  }),
  scene: Object.freeze({
    rootId: 'studio-scene-view',
    drawerId: 'studio-scene-prompt-drawer',
    shadeId: 'studio-scene-prompt-shade',
    openerId: 'studio-scene-prompt-open',
    titleId: 'studio-scene-prompt-title',
  }),
})

let initialized = false
let activeAssistant = null
let returnFocus = null
let hiddenSiblings = []

function byId(id) {
  return document.getElementById(id)
}

function languageCode() {
  return getCurrentLanguage() === 'en' ? 'en' : 'zh'
}

function promptT(key) {
  return PROMPT_ASSISTANT_COPY[languageCode()][key] ?? PROMPT_ASSISTANT_COPY.en[key] ?? key
}

export function buildCharacterAssistantPrompt(values = PROMPT_ASSISTANT_DEFAULTS.character) {
  return buildCharacterPrompt({
    preset: values.preset,
    character: values.character,
    hasReferenceImage: Boolean(values.hasReferenceImage),
  })
}

export function buildSceneAssistantPrompt(values = PROMPT_ASSISTANT_DEFAULTS.scene) {
  return buildScenePrompt({
    view: values.view,
    theme: values.theme,
    composition: values.composition,
    style: values.style,
  })
}

export function promptAssistantRequest(search = '') {
  const values = new URLSearchParams(String(search ?? '')).getAll('open')
  return values.length === 1 && values[0] === 'scene-prompt' ? 'scene' : null
}

export function promptAssistantUrlWithoutRequest(locationValue = globalThis.location) {
  const url = new URL(locationValue.href)
  url.searchParams.delete('open')
  return `${url.pathname}${url.search}${url.hash}`
}

function fillSelect(select, entries) {
  if (!select || select.options.length) return
  for (const [value, definition] of Object.entries(entries)) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = typeof definition === 'string' ? definition : definition.label
    select.append(option)
  }
}

function characterValues() {
  return {
    preset: byId('studio-character-prompt-preset')?.value,
    character: byId('studio-character-prompt-character')?.value,
    hasReferenceImage: byId('studio-character-prompt-reference')?.checked,
  }
}

function sceneValues() {
  return {
    view: byId('studio-scene-prompt-view')?.value,
    theme: byId('studio-scene-prompt-theme')?.value,
    composition: byId('studio-scene-prompt-composition')?.value,
    style: byId('studio-scene-prompt-style')?.value,
  }
}

function setOutput(kind, value) {
  const output = byId(`studio-${kind}-prompt-output`)
  if (output) output.value = value
}

function generate(kind) {
  setOutput(kind, kind === 'character'
    ? buildCharacterAssistantPrompt(characterValues())
    : buildSceneAssistantPrompt(sceneValues()))
}

function reset(kind) {
  if (kind === 'character') {
    const defaults = PROMPT_ASSISTANT_DEFAULTS.character
    byId('studio-character-prompt-preset').value = defaults.preset
    byId('studio-character-prompt-character').value = defaults.character
    byId('studio-character-prompt-reference').checked = defaults.hasReferenceImage
  } else {
    const defaults = PROMPT_ASSISTANT_DEFAULTS.scene
    byId('studio-scene-prompt-view').value = defaults.view
    byId('studio-scene-prompt-theme').value = defaults.theme
    byId('studio-scene-prompt-composition').value = defaults.composition
    byId('studio-scene-prompt-style').value = defaults.style
  }
  generate(kind)
  const live = byId(`studio-${kind}-prompt-live`)
  if (live) {
    delete live.dataset.promptStatus
    live.textContent = ''
  }
}

async function copy(kind) {
  const output = byId(`studio-${kind}-prompt-output`)
  const live = byId(`studio-${kind}-prompt-live`)
  try {
    await navigator.clipboard.writeText(output?.value ?? '')
    if (live) {
      live.dataset.promptStatus = 'copied'
      live.textContent = promptT('copied')
    }
  } catch {
    if (live) {
      live.dataset.promptStatus = 'copyFailed'
      live.textContent = promptT('copyFailed')
    }
    output?.focus()
    output?.select()
  }
}

function setUnderlyingInert(kind, inert) {
  const config = ASSISTANTS[kind]
  const root = byId(config.rootId)
  if (!root) return
  if (inert) {
    hiddenSiblings = [...root.children]
      .filter((element) => ![config.drawerId, config.shadeId].includes(element.id))
      .map((element) => ({
        element,
        ariaHidden: element.getAttribute('aria-hidden'),
        inert: element.inert,
      }))
    for (const { element } of hiddenSiblings) {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
    root.classList.add('has-prompt-assistant')
    return
  }
  for (const { element, ariaHidden, inert } of hiddenSiblings) {
    element.inert = inert
    if (ariaHidden === null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', ariaHidden)
  }
  hiddenSiblings = []
  root.classList.remove('has-prompt-assistant')
}

export function closeStudioPromptAssistant({ restoreFocus = true } = {}) {
  if (!activeAssistant) return false
  const kind = activeAssistant
  const config = ASSISTANTS[kind]
  setUnderlyingInert(kind, false)
  byId(config.drawerId).hidden = true
  byId(config.shadeId).hidden = true
  byId(config.openerId)?.setAttribute('aria-expanded', 'false')
  activeAssistant = null
  const focusTarget = returnFocus
  returnFocus = null
  if (restoreFocus) focusTarget?.focus({ preventScroll: true })
  return true
}

export function openStudioPromptAssistant(kind, { focusTarget = null } = {}) {
  const config = ASSISTANTS[kind]
  if (!config) return false
  if (activeAssistant && activeAssistant !== kind) closeStudioPromptAssistant({ restoreFocus: false })
  const drawer = byId(config.drawerId)
  const shade = byId(config.shadeId)
  if (!drawer || !shade) return false
  activeAssistant = kind
  returnFocus = focusTarget ?? byId(config.openerId) ?? document.activeElement
  drawer.hidden = false
  shade.hidden = false
  byId(config.openerId)?.setAttribute('aria-expanded', 'true')
  setUnderlyingInert(kind, true)
  renderStudioPromptAssistantsLanguage()
  queueMicrotask(() => byId(config.titleId)?.focus({ preventScroll: true }))
  return true
}

function goToCharacterAssistant() {
  closeStudioPromptAssistant({ restoreFocus: false })
  if (globalThis.location.hash === '#character') {
    openStudioPromptAssistant('character')
    return
  }
  globalThis.location.hash = 'character'
  globalThis.addEventListener('hashchange', () => {
    openStudioPromptAssistant('character')
  }, { once: true })
}

export function renderStudioPromptAssistantsLanguage() {
  document.querySelectorAll('[data-prompt-copy]').forEach((element) => {
    element.textContent = promptT(element.dataset.promptCopy)
  })
  document.querySelectorAll('[data-prompt-copy-aria]').forEach((element) => {
    element.setAttribute('aria-label', promptT(element.dataset.promptCopyAria))
  })
  for (const kind of ['character', 'scene']) {
    const labels = PROMPT_ASSISTANT_OPTION_COPY[languageCode()][kind]
    const select = byId(`studio-${kind}-prompt-${kind === 'character' ? 'preset' : 'view'}`)
    for (const option of select?.options ?? []) option.textContent = labels[option.value] ?? option.textContent
    const live = byId(`studio-${kind}-prompt-live`)
    if (live?.dataset.promptStatus) live.textContent = promptT(live.dataset.promptStatus)
  }
}

function bindAssistant(kind) {
  const config = ASSISTANTS[kind]
  byId(config.openerId)?.addEventListener('click', (event) => {
    openStudioPromptAssistant(kind, { focusTarget: event.currentTarget })
  })
  document.querySelectorAll(`[data-prompt-kind="${kind}"][data-prompt-action]`).forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.promptAction
      if (action === 'generate') generate(kind)
      else if (action === 'copy') void copy(kind)
      else if (action === 'reset') reset(kind)
      else if (action === 'close') closeStudioPromptAssistant()
    })
  })
}

function handleRouteChange() {
  if (!activeAssistant) return
  if (globalThis.location.hash !== `#${activeAssistant}`) closeStudioPromptAssistant({ restoreFocus: false })
}

function openRequestedAssistant() {
  const requested = promptAssistantRequest(globalThis.location.search)
  if (!requested) return
  globalThis.history.replaceState(null, '', promptAssistantUrlWithoutRequest(globalThis.location))
  if (globalThis.location.hash !== '#scene') {
    globalThis.location.hash = 'scene'
    globalThis.addEventListener('hashchange', () => openStudioPromptAssistant('scene'), { once: true })
    return
  }
  openStudioPromptAssistant('scene')
}

export function initStudioPromptAssistants() {
  if (initialized) return
  initialized = true
  fillSelect(byId('studio-character-prompt-preset'), CHARACTER_PRESETS)
  fillSelect(byId('studio-scene-prompt-view'), SCENE_PRESETS)
  reset('character')
  reset('scene')
  bindAssistant('character')
  bindAssistant('scene')
  byId('studio-scene-prompt-character')?.addEventListener('click', goToCharacterAssistant)
  globalThis.addEventListener?.('hashchange', handleRouteChange)
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-character-language],[data-scene-language]')) {
      queueMicrotask(renderStudioPromptAssistantsLanguage)
    }
  })
  document.querySelector('#language-select')?.addEventListener('change', renderStudioPromptAssistantsLanguage)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeAssistant) {
      event.preventDefault()
      closeStudioPromptAssistant()
      return
    }
    if (event.key === 'Tab' && activeAssistant) {
      const config = ASSISTANTS[activeAssistant]
      const drawer = byId(config.drawerId)
      const title = byId(config.titleId)
      const focusable = [...drawer.querySelectorAll('button,input,select,textarea,a[href]')]
        .filter((element) => !element.disabled && !element.hidden && element.tabIndex !== -1)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && [title, first].includes(document.activeElement)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  })
  renderStudioPromptAssistantsLanguage()
  openRequestedAssistant()
}
