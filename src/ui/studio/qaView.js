import { getCurrentLanguage, setCurrentLanguage } from '../i18n.js'
import { translateStudioDocument } from './settingsView.js'

export const QA_ITEM_COUNT = 5

export const QA_COPY = Object.freeze({
  en: Object.freeze({
    headerTitle: 'Self-check',
    headerCrumb: '· Manual checklist',
    languageLabel: 'Interface language',
    pageTitle: 'Manual checklist',
    pageSubtitle: 'Inspect the asset set you chose for this session. This checklist is not bound to a Job or file.',
    truthBadge: 'Manual · not automatic',
    checklistTitle: 'Manual checks for this session',
    checklistHelp: 'All five items are decided by the operator. This view reads no Job, quality report, download, or Project result.',
    item1Title: 'Grid and character stay stable',
    item1Body: 'Every cell has the same size; the character does not drift or change scale.',
    item1Badge: 'Size / alignment',
    item2Title: 'Animation order is correct',
    item2Body: 'Walk, attack, down, jump, and other previews play in the intended order.',
    item2Badge: 'Animation',
    item3Title: 'No visual residue remains',
    item3Body: 'The background is white or transparent, with no watermark, text, grid, or border.',
    item3Badge: 'Cleanup',
    item4Title: 'Sprite Sheet splits correctly',
    item4Body: 'The column and row counts are correct; inspect duplicate frames when necessary.',
    item4Badge: 'Sequence',
    item5Title: 'Manually confirmed in a target engine',
    item5Body: 'Collision, anchors, facing, and frame rate were checked after you imported the asset into your chosen target environment.',
    item5Badge: 'Runtime',
    unchecked: 'Unchecked',
    checked: 'Checked',
    progressTitle: 'Manual progress',
    sessionCount: 'Session · {count}/5',
    progressCount: '{count} / 5',
    stateDefault: 'Pending · this page session only',
    statePartial: 'In progress · this page session only',
    stateComplete: 'Manually complete · verified-download state unchanged',
    boundaryTitle: 'Capability boundary',
    boundaryHelp: 'This is a manual memo, not an automated acceptance system.',
    boundaryBadge: 'Page session',
    boundaryRule1Title: 'Reads no Job or quality report',
    boundaryRule1Body: 'Every conclusion comes from the current operator.',
    boundaryRule2Title: 'QA checks call no API and make no automatic decision',
    boundaryRule2Body: 'Checking or unchecking triggers no network request, Provider call, or hidden retry.',
    boundaryRule3Title: 'Reloading clears every check',
    boundaryRule3Body: 'State lasts only until this document is reloaded.',
    boundaryRule4Title: 'Completion changes no verified-download or Project state',
    boundaryRule4Body: 'Real gates continue to use each module\'s existing evidence.',
    footerBadge: 'Real capability',
    footerDefaultTitle: 'Manual self-checks do not replace module evidence',
    footerCompleteTitle: 'Manual completion still does not replace module evidence',
    footerBody: 'For real generation, quality-gate, or verified-download state, return to Character, Motion, Sequence, Tiles, Scene, or Project and inspect its current result.',
    footerOrigin: 'Manual only · not bound to an asset or Job',
  }),
  zh: Object.freeze({
    headerTitle: '自检',
    headerCrumb: '· 手工检查表',
    languageLabel: '界面语言',
    pageTitle: '手工检查表',
    pageSubtitle: '逐项检查你为本次会话指定的资产集；清单不绑定任何 Job 或文件。',
    truthBadge: '手工 · 非自动',
    checklistTitle: '本次手工检查',
    checklistHelp: '5 项均由操作者判断；界面不读取 Job、质量报告、下载或 Project 结果。',
    item1Title: '格子与角色稳定',
    item1Body: '每个格子尺寸一致；角色不漂移、不忽大忽小。',
    item1Badge: '尺寸 / 对齐',
    item2Title: '动作顺序正确',
    item2Body: '走路、攻击、倒地、跳跃等动画预览顺序正确。',
    item2Badge: '动画',
    item3Title: '画面无残留',
    item3Body: '背景为纯白或透明；没有水印、文字、网格或边框。',
    item3Badge: '清理',
    item4Title: 'Sprite Sheet 拆分正确',
    item4Body: '列数与行数正确；必要时检查重复帧。',
    item4Badge: '序列',
    item5Title: '在目标引擎中人工确认',
    item5Body: '由你将资产导入所选目标环境后，检查碰撞、锚点、朝向与帧速。',
    item5Badge: '运行时',
    unchecked: '未检查',
    checked: '已检查',
    progressTitle: '手工进度',
    sessionCount: '会话内 · {count}/5',
    progressCount: '{count} / 5',
    stateDefault: '待检查 · 仅当前页面会话',
    statePartial: '检查中 · 仅当前页面会话',
    stateComplete: '手工完成 · 仍不改变已验证下载状态',
    boundaryTitle: '能力边界',
    boundaryHelp: '这是手工备忘录，不是自动验收系统。',
    boundaryBadge: '页面会话',
    boundaryRule1Title: '不会读取任何 Job 或质量报告',
    boundaryRule1Body: '每项结论都由当前操作者给出。',
    boundaryRule2Title: 'QA 勾选不会调用 API，也不会自动判定',
    boundaryRule2Body: '勾选与取消勾选不会触发网络请求、Provider 调用或隐藏重试。',
    boundaryRule3Title: '刷新页面会清空全部勾选',
    boundaryRule3Body: '只保留到当前文档重新载入之前。',
    boundaryRule4Title: '完成后不会改变已验证下载或 Project 状态',
    boundaryRule4Body: '真实门禁仍以各模块现有证据为准。',
    footerBadge: '真实能力',
    footerDefaultTitle: '手工自检不会替代模块证据',
    footerCompleteTitle: '手工完成仍不会替代模块证据',
    footerBody: '如需确认真实生成、质量门禁或已验证下载状态，请回到角色、动作、序列、图块、场景或项目模块查看当前结果。',
    footerOrigin: '仅供手工记录 · 不绑定资产或 Job',
  }),
})

let initialized = false
let qaState = null

function byId(id) {
  return typeof document === 'undefined' ? null : document.getElementById(id)
}

function normalizedChecks(state) {
  const source = Array.isArray(state?.checked) ? state.checked : []
  return Array.from({ length: QA_ITEM_COUNT }, (_, index) => source[index] === true)
}

function replaceCopy(template, replacements = {}) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(replacements[name] ?? ''))
}

export function qaT(key, replacements = {}, language = getCurrentLanguage()) {
  const lang = language === 'en' ? 'en' : 'zh'
  return replaceCopy(QA_COPY[lang][key] ?? QA_COPY.en[key] ?? key, replacements)
}

export function createInitialQaState() {
  return { checked: Array(QA_ITEM_COUNT).fill(false) }
}

export function updateQaItem(state, index, checked) {
  const next = normalizedChecks(state)
  if (Number.isInteger(index) && index >= 0 && index < QA_ITEM_COUNT) {
    next[index] = checked === true
  }
  return { checked: next }
}

export function deriveQaPresentation(state = createInitialQaState()) {
  const checked = normalizedChecks(state)
  const count = checked.filter(Boolean).length
  const remaining = QA_ITEM_COUNT - count
  const phase = count === 0 ? 'default' : count === QA_ITEM_COUNT ? 'complete' : 'in_progress'
  return Object.freeze({
    checked: Object.freeze(checked),
    count,
    remaining,
    phase,
    progressStateKey: phase === 'default' ? 'stateDefault' : phase === 'complete' ? 'stateComplete' : 'statePartial',
  })
}

function renderStaticCopy(root, language) {
  root.querySelectorAll('[data-qa-copy]').forEach((element) => {
    element.textContent = qaT(element.dataset.qaCopy, {}, language)
  })
  root.querySelectorAll('[data-qa-copy-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', qaT(element.dataset.qaCopyAriaLabel, {}, language))
  })
}

export function renderStudioQa(state = qaState) {
  const root = byId('studio-qa-view')
  if (!root || !state) return null
  const language = getCurrentLanguage() === 'en' ? 'en' : 'zh'
  const presentation = deriveQaPresentation(state)
  renderStaticCopy(root, language)
  root.dataset.qaPhase = presentation.phase

  root.querySelectorAll('[data-qa-language]').forEach((button) => {
    const active = button.dataset.qaLanguage === language
    button.classList.toggle('is-current', active)
    button.setAttribute('aria-pressed', String(active))
  })
  root.querySelectorAll('[data-qa-item]').forEach((row, index) => {
    const isChecked = presentation.checked[index]
    row.classList.toggle('is-checked', isChecked)
    const input = row.querySelector('input[type="checkbox"]')
    if (input) input.checked = isChecked
    const stateLabel = row.querySelector('[data-qa-item-state]')
    if (stateLabel) stateLabel.textContent = qaT(isChecked ? 'checked' : 'unchecked', {}, language)
  })

  const replacements = { count: presentation.count, remaining: presentation.remaining }
  const sessionCount = byId('studio-qa-session-count')
  if (sessionCount) sessionCount.textContent = qaT('sessionCount', replacements, language)
  const cardCount = byId('studio-qa-card-count')
  if (cardCount) {
    cardCount.textContent = qaT('progressCount', replacements, language)
    cardCount.dataset.state = presentation.phase === 'complete' ? 'ready' : 'idle'
  }
  const progressCount = byId('studio-qa-progress-count')
  if (progressCount) progressCount.textContent = qaT('progressCount', replacements, language)
  const progress = byId('studio-qa-progress')
  if (progress) {
    progress.setAttribute('aria-valuenow', String(presentation.count))
    progress.setAttribute('aria-valuetext', qaT('progressCount', replacements, language))
  }
  const progressFill = byId('studio-qa-progress-fill')
  if (progressFill) progressFill.style.width = `${(presentation.count / QA_ITEM_COUNT) * 100}%`
  const progressState = byId('studio-qa-progress-state')
  if (progressState) progressState.textContent = qaT(presentation.progressStateKey, replacements, language)
  const footerTitle = byId('studio-qa-footer-title')
  if (footerTitle) footerTitle.textContent = qaT(presentation.phase === 'complete' ? 'footerCompleteTitle' : 'footerDefaultTitle', replacements, language)

  if (!root.hidden && typeof document !== 'undefined') {
    document.title = language === 'en' ? 'MoteWeave · QA Checklist' : 'MoteWeave · 验收检查'
  }
  return presentation
}

function bindEvents(root) {
  root.querySelectorAll('[data-qa-item] input[type="checkbox"]').forEach((input, index) => {
    input.addEventListener('change', () => {
      qaState = updateQaItem(qaState, index, input.checked)
      renderStudioQa(qaState)
    })
  })
  root.querySelectorAll('[data-qa-language]').forEach((button) => {
    button.addEventListener('click', () => {
      setCurrentLanguage(button.dataset.qaLanguage)
      translateStudioDocument(document, getCurrentLanguage())
      renderStudioQa(qaState)
    })
  })
}

export function renderStudioQaLanguage() {
  return renderStudioQa(qaState)
}

export function initStudioQa() {
  if (initialized) return qaState
  const root = byId('studio-qa-view')
  if (!root) return null
  initialized = true
  qaState = createInitialQaState()
  bindEvents(root)
  renderStudioQa(qaState)
  return qaState
}
