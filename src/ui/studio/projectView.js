import { getCurrentLanguage, setCurrentLanguage } from '../i18n.js'
import { getStudioCharacterProjectCandidate } from './characterView.js'
import { getStudioSceneProjectCandidate } from './sceneView.js'
import {
  diagnosticProjectArtifacts,
  normalizeProjectInputs,
  pollProjectJob,
  postProjectPack,
  projectObservationCanResume,
  projectSubmissionIsDefiniteRejection,
  releaseProjectArtifacts,
  verifyProjectResult,
  verifyProjectFailureDiagnostics,
} from './projectApi.js'
import { translateStudioDocument } from './settingsView.js'

export const PROJECT_PHASES = Object.freeze([
  'empty',
  'ready',
  'running',
  'complete',
  'failed',
  'poll_paused',
  'stale',
  'submission_unknown',
])

const PHASE_SET = new Set(PROJECT_PHASES)

export const PROJECT_COPY = Object.freeze({
  en: Object.freeze({
    headerTitle: 'Project Pack',
    headerCrumb: '· Compose',
    languageLabel: 'Interface language',
    export: 'Download project pack',
    currentTask: 'Current task',
    compose: 'Compose',
    flowTitle: 'Combine completed packages',
    flowSummary: 'Select exact Character and Scene Jobs, then build one manifest-bound project ZIP.',
    truthTitle: 'Capability boundary',
    truthBody: 'This workflow only combines existing generated artifacts. It never generates characters, scenes, or Provider work.',
    replacedTitle: 'Project editor replaced truthfully',
    replacedBody: 'The maintained capability is project-pack composition, not a visual multi-asset editor.',
    projectId: 'Project ID',
    projectIdHelp: 'Written to project_manifest.json; 1–160 printable characters.',
    characterTitle: 'Character package',
    characterJob: 'Character Job ID',
    characterPlaceholder: 'accepted_v1_… or job_…',
    characterHelp: 'Must resolve to a complete generated Character artifact directory.',
    sceneTitle: 'Scene package',
    sceneJob: 'Scene Job ID',
    scenePlaceholder: 'job_…',
    sceneHelp: 'Must resolve to a complete generated Scene artifact directory.',
    useCurrent: 'Use current',
    noCurrentCharacter: 'No verified Character result in this Studio session.',
    noCurrentScene: 'No verified Scene result in this Studio session.',
    currentVerified: 'Current session · verified',
    exactInput: 'Exact Job input · server validates on build',
    selected: 'Selected',
    optionsTitle: 'Composition policy',
    manifestLocked: 'Write project_manifest.json',
    manifestLockedHelp: 'Required pipeline output · always enabled',
    strictStyle: 'Strict shared-style contract',
    strictStyleHelp: 'Warnings become a blocking project validation failure.',
    childZipLocked: 'Include original child ZIPs',
    childZipLockedHelp: 'Required archive layout · always enabled',
    bindingTitle: 'Current binding',
    noBinding: 'Character and Scene Job IDs are required',
    bindingReady: 'Inputs ready for server validation',
    bindingJob: 'Project Job {id}',
    noJob: 'No Project Job',
    build: 'Generate project pack',
    rebuild: 'Generate a new Project Job',
    resume: 'Resume this Project Job',
    building: 'Project pack running…',
    candidatesCharacter: 'Character input',
    candidatesScene: 'Scene input',
    candidatesHelp: 'Only a verified current-session result or an exact Job ID is shown. No recent-job list API exists.',
    stageLabel: 'Project Pack composition stage',
    characterCandidatesLabel: 'Character package candidates',
    sceneCandidatesLabel: 'Scene package candidates',
    expectedFilesLabel: 'Expected Project Pack contents',
    artifactListLabel: 'Current verified Project artifacts',
    diagnosticListLabel: 'Current verified Project diagnostics',
    recoveryLabel: 'Project Job recovery state',
    manifestPreview: 'Project pack contents',
    manifestPreviewExpected: 'Expected contract files; they become downloads only after the current Job verifies.',
    resultTitle: 'Current Project result',
    resultPending: 'No verified Project Job output.',
    resultRunning: 'The same Project Job is composing child artifacts and validation evidence.',
    resultComplete: 'Manifest, validation, and ZIP are bound to the current inputs and Project Job.',
    resultFailed: 'Verified download is locked. Only diagnostics verified against the failed Project Job may be opened.',
    resultPollPaused: 'Observation paused. Resume the same Project Job; do not submit replacement work.',
    resultStale: 'The result is stale or the server session lost the Job. Verified download remains locked.',
    resultSubmissionUnknown: 'Submission outcome is unknown. A replacement request could create a duplicate Project Job.',
    statusIdle: 'Waiting for inputs',
    statusReady: 'Ready',
    statusRunning: 'Running',
    statusComplete: 'Complete',
    statusFailed: 'Failed',
    statusPollPaused: 'Observation paused',
    statusStale: 'Stale',
    statusSubmissionUnknown: 'Submission unknown',
    statusServiceUnavailable: 'Local service required',
    metricProject: 'Project',
    metricCharacter: 'Character pack',
    metricScene: 'Scene pack',
    metricValidation: 'Validation',
    metricWarnings: 'Warnings',
    metricPolicy: 'Style policy',
    artifactsTitle: 'Current verified artifacts',
    diagnosticsTitle: 'Current verified diagnostics',
    noArtifacts: 'No current artifacts',
    releaseLocked: 'project_pack.zip locked',
    jobLabel: 'Job',
    reasonLabel: 'Reason',
    retryHintLabel: 'retry_hint',
    releaseLabel: 'Verified download',
    bindingCharacter: 'Character',
    bindingScene: 'Scene',
    unknownError: 'Unknown Project Pack error',
    serviceRequired: 'Run the maintained local service before using Project Pack.',
    invalidInputs: 'Enter a valid Project ID and exact Character and Scene Job IDs.',
    submissionRejected: 'Project Pack submission was rejected before a Job was created.',
    submissionUnknown: 'The request may have created a Project Job, but its identity was not returned.',
    verificationFailed: 'The current Project Job artifacts could not be verified; verified download remains locked.',
    currentCandidateApplied: 'Current verified Job selected.',
    expectedManifest: 'project_manifest.json',
    expectedValidation: 'project_validation.json',
    expectedZip: 'project_pack.zip',
    expectedCharacter: 'character/<pack artifacts>',
    expectedScene: 'scene/<pack artifacts>',
  }),
  zh: Object.freeze({
    headerTitle: '项目包',
    headerCrumb: '· 合成',
    languageLabel: '界面语言',
    export: '下载项目包',
    currentTask: '当前任务',
    compose: '合成',
    flowTitle: '组合已完成产物包',
    flowSummary: '选择精确的角色与场景 Job，生成一个绑定 manifest 的项目 ZIP。',
    truthTitle: '能力边界',
    truthBody: '本流程只组合既有生成产物；不会生成角色、场景，也不会产生任何 Provider 调用。',
    replacedTitle: '如实替换空「项目编辑器」',
    replacedBody: '仓库真实能力是 project pack 合成，不是多资产可视化编辑器。',
    projectId: '项目 ID',
    projectIdHelp: '写入 project_manifest.json；1–160 个可打印字符。',
    characterTitle: '角色包',
    characterJob: '角色 Job ID',
    characterPlaceholder: 'accepted_v1_… 或 job_…',
    characterHelp: '必须指向完整的 generated 角色产物目录。',
    sceneTitle: '场景包',
    sceneJob: '场景 Job ID',
    scenePlaceholder: 'job_…',
    sceneHelp: '必须指向完整的 generated 场景产物目录。',
    useCurrent: '使用当前结果',
    noCurrentCharacter: '当前 Studio 会话没有已验证角色结果。',
    noCurrentScene: '当前 Studio 会话没有已验证场景结果。',
    currentVerified: '当前会话 · 已验证',
    exactInput: '精确 Job 输入 · 构建时由服务器验证',
    selected: '已选',
    optionsTitle: '合成策略',
    manifestLocked: '写入 project_manifest.json',
    manifestLockedHelp: '管线必需产物 · 始终启用',
    strictStyle: '严格共享样式契约',
    strictStyleHelp: '样式警告将升级为阻断性的项目校验失败。',
    childZipLocked: '包含子包原始 ZIP',
    childZipLockedHelp: '固定归档结构 · 始终启用',
    bindingTitle: '当前绑定',
    noBinding: '需要角色与场景 Job ID',
    bindingReady: '输入已就绪，等待服务器验证',
    bindingJob: '项目 Job {id}',
    noJob: '尚无项目 Job',
    build: '生成项目包',
    rebuild: '创建新的项目 Job',
    resume: '继续观察此项目 Job',
    building: '项目包运行中…',
    candidatesCharacter: '角色输入',
    candidatesScene: '场景输入',
    candidatesHelp: '只显示当前会话已验证结果或精确 Job ID；仓库没有最近 Job 列表 API。',
    stageLabel: '项目包合成舞台',
    characterCandidatesLabel: '角色包候选',
    sceneCandidatesLabel: '场景包候选',
    expectedFilesLabel: '预期项目包内容',
    artifactListLabel: '当前已验证项目产物',
    diagnosticListLabel: '当前已验证项目诊断',
    recoveryLabel: '项目 Job 恢复状态',
    manifestPreview: '项目包内容',
    manifestPreviewExpected: '这些是确定的协议文件；只有当前 Job 验证后才会成为下载链接。',
    resultTitle: '当前项目结果',
    resultPending: '没有已验证的项目 Job 产物。',
    resultRunning: '同一项目 Job 正在组合子包与校验证据。',
    resultComplete: 'Manifest、validation 与 ZIP 已绑定当前输入和项目 Job。',
    resultFailed: '已验证下载已锁定；只允许打开与当前失败 Job 核验一致的诊断。',
    resultPollPaused: '观察已暂停；继续同一项目 Job，不创建替代任务。',
    resultStale: '结果已陈旧或服务器会话已丢失 Job；已验证下载保持锁定。',
    resultSubmissionUnknown: '提交结果未知；重新请求可能创建重复的项目 Job。',
    statusIdle: '等待输入',
    statusReady: '可合成',
    statusRunning: '运行中',
    statusComplete: '已完成',
    statusFailed: '失败',
    statusPollPaused: '观察暂停',
    statusStale: '已陈旧',
    statusSubmissionUnknown: '提交未知',
    statusServiceUnavailable: '需要本地服务',
    metricProject: '项目',
    metricCharacter: '角色包',
    metricScene: '场景包',
    metricValidation: '校验',
    metricWarnings: '警告',
    metricPolicy: '样式策略',
    artifactsTitle: '当前已验证产物',
    diagnosticsTitle: '当前已验证诊断',
    noArtifacts: '没有当前产物',
    releaseLocked: 'project_pack.zip 已锁定',
    jobLabel: 'Job',
    reasonLabel: '原因',
    retryHintLabel: 'retry_hint',
    releaseLabel: '已验证下载',
    bindingCharacter: '角色',
    bindingScene: '场景',
    unknownError: '未知项目包错误',
    serviceRequired: '请先运行仓库维护中的本地服务，再使用项目包。',
    invalidInputs: '请输入有效的项目 ID，以及精确的角色与场景 Job ID。',
    submissionRejected: '项目包请求在创建 Job 前被拒绝。',
    submissionUnknown: '请求可能已经创建项目 Job，但没有返回其身份。',
    verificationFailed: '当前项目 Job 产物无法验证；已验证下载保持锁定。',
    currentCandidateApplied: '已选择当前验证 Job。',
    expectedManifest: 'project_manifest.json',
    expectedValidation: 'project_validation.json',
    expectedZip: 'project_pack.zip',
    expectedCharacter: 'character/<子包产物>',
    expectedScene: 'scene/<子包产物>',
  }),
})

const PHASE_COPY = Object.freeze({
  empty: Object.freeze({ status: 'statusIdle', result: 'resultPending' }),
  ready: Object.freeze({ status: 'statusReady', result: 'resultPending' }),
  running: Object.freeze({ status: 'statusRunning', result: 'resultRunning' }),
  complete: Object.freeze({ status: 'statusComplete', result: 'resultComplete' }),
  failed: Object.freeze({ status: 'statusFailed', result: 'resultFailed' }),
  poll_paused: Object.freeze({ status: 'statusPollPaused', result: 'resultPollPaused' }),
  stale: Object.freeze({ status: 'statusStale', result: 'resultStale' }),
  submission_unknown: Object.freeze({ status: 'statusSubmissionUnknown', result: 'resultSubmissionUnknown' }),
})

let initialized = false
let projectState = null

function byId(id) {
  return document.getElementById(id)
}

function setText(id, value) {
  const node = byId(id)
  if (node) node.textContent = value ?? ''
}

function setHidden(id, hidden) {
  const node = byId(id)
  if (node) node.hidden = Boolean(hidden)
}

function languageCode() {
  return getCurrentLanguage() === 'en' ? 'en' : 'zh'
}

function projectT(key, replacements = {}, language = languageCode()) {
  let result = PROJECT_COPY[language]?.[key] ?? PROJECT_COPY.en[key] ?? key
  for (const [name, value] of Object.entries(replacements)) {
    result = result.replaceAll(`{${name}}`, String(value))
  }
  return result
}

function codedError(code, message, options = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, options)
  return error
}

function errorText(error) {
  return error?.message || (error ? String(error) : '')
}

function rawInputsFromDom() {
  return {
    projectId: byId('studio-project-id')?.value ?? '',
    characterJobId: byId('studio-project-character-job')?.value ?? '',
    sceneJobId: byId('studio-project-scene-job')?.value ?? '',
    strictStyleContract: Boolean(byId('studio-project-strict-style')?.checked),
  }
}

function inputKey(inputs) {
  return JSON.stringify(normalizeProjectInputs(inputs))
}

function hasAllRequiredInputs(values) {
  return Boolean(
    String(values.projectId ?? '').trim() &&
    String(values.characterJobId ?? '').trim() &&
    String(values.sceneJobId ?? '').trim()
  )
}

export function createInitialProjectState({ serviceAvailable = true } = {}) {
  return {
    serviceAvailable: Boolean(serviceAvailable),
    phase: 'empty',
    busy: null,
    controller: null,
    inputs: Object.freeze({
      projectId: 'game_project',
      characterJobId: '',
      sceneJobId: '',
      strictStyleContract: false,
    }),
    inputsValid: false,
    inputsKey: null,
    binding: null,
    job: null,
    resultJob: null,
    resultVerified: false,
    diagnosticsVerified: false,
    manifest: null,
    validation: null,
    characterCandidate: null,
    sceneCandidate: null,
    error: null,
  }
}

export function projectResultIsCurrent(state = projectState) {
  return Boolean(
    state?.phase === 'complete' &&
    state?.inputsValid &&
    state?.resultVerified &&
    state?.resultJob?.status === 'done' &&
    state?.binding?.jobId === state.resultJob.id &&
    state?.binding?.inputKey === state.inputsKey,
  )
}

export function deriveProjectPresentation(state = createInitialProjectState()) {
  const phase = PHASE_SET.has(state?.phase) ? state.phase : 'empty'
  let action = 'blocked'
  if (state?.serviceAvailable && !state?.busy) {
    if (phase === 'poll_paused' && state?.job?.id && state?.binding?.inputs) action = 'resume'
    else if (phase !== 'submission_unknown' && state?.inputsValid) action = 'build'
  }
  return Object.freeze({
    phase,
    action,
    busy: Boolean(state?.busy),
    releaseReady: projectResultIsCurrent(state),
  })
}

function refreshSessionCandidates(state) {
  state.characterCandidate = getStudioCharacterProjectCandidate()
  state.sceneCandidate = getStudioSceneProjectCandidate()
}

function invalidateResult(state) {
  state.resultVerified = false
  state.diagnosticsVerified = false
  state.manifest = null
  state.validation = null
}

function updateInputs(state, { announceErrors = false } = {}) {
  const raw = rawInputsFromDom()
  state.inputs = Object.freeze({
    projectId: String(raw.projectId ?? '').trim(),
    characterJobId: String(raw.characterJobId ?? '').trim(),
    sceneJobId: String(raw.sceneJobId ?? '').trim(),
    strictStyleContract: Boolean(raw.strictStyleContract),
  })
  state.inputsValid = false
  state.inputsKey = null
  if (!hasAllRequiredInputs(state.inputs)) {
    if (!state.busy && !['complete', 'poll_paused', 'submission_unknown'].includes(state.phase)) state.phase = 'empty'
    if (announceErrors) state.error = codedError('invalid_project_input', projectT('invalidInputs'))
    return false
  }
  try {
    state.inputs = normalizeProjectInputs(state.inputs)
    state.inputsKey = inputKey(state.inputs)
    state.inputsValid = true
    if (state.binding && state.binding.inputKey !== state.inputsKey) {
      invalidateResult(state)
      state.phase = 'stale'
      state.error = codedError('input_binding_changed', projectT('resultStale'))
    } else if (!state.busy && ['empty', 'ready'].includes(state.phase)) {
      state.phase = 'ready'
      state.error = null
    }
    return true
  } catch (error) {
    if (!state.busy) state.phase = 'empty'
    if (announceErrors) state.error = error
    return false
  }
}

function renderStaticCopy(root) {
  root.querySelectorAll('[data-project-copy]').forEach((node) => {
    node.textContent = projectT(node.dataset.projectCopy)
  })
  root.querySelectorAll('[data-project-copy-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', projectT(node.dataset.projectCopyPlaceholder))
  })
  root.querySelectorAll('[data-project-copy-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', projectT(node.dataset.projectCopyAriaLabel))
  })
  root.querySelectorAll('[data-project-copy-title]').forEach((node) => {
    node.setAttribute('title', projectT(node.dataset.projectCopyTitle))
  })
}

function renderLanguageButtons() {
  const language = languageCode()
  document.querySelectorAll('[data-project-language]').forEach((button) => {
    const current = button.dataset.projectLanguage === language
    button.classList.toggle('is-current', current)
    button.setAttribute('aria-pressed', String(current))
  })
}

function appendCandidateRow(container, {
  title,
  detail,
  selected = false,
  status = null,
  onSelect = null,
} = {}) {
  const row = document.createElement(onSelect ? 'button' : 'div')
  row.className = 'project-candidate-row'
  if (onSelect) {
    row.type = 'button'
    row.addEventListener('click', onSelect)
  }
  if (selected) row.classList.add('is-selected')
  const marker = document.createElement('span')
  marker.className = 'project-candidate-marker'
  marker.setAttribute('aria-hidden', 'true')
  const copy = document.createElement('span')
  copy.className = 'project-candidate-copy'
  const strong = document.createElement('strong')
  strong.textContent = title
  const small = document.createElement('small')
  small.textContent = detail
  copy.append(strong, small)
  row.append(marker, copy)
  if (status) {
    const badge = document.createElement('span')
    badge.className = 'project-candidate-badge'
    badge.textContent = status
    row.append(badge)
  }
  container.append(row)
}

function selectCandidate(kind, candidate) {
  if (!projectState || projectState.busy || !candidate?.jobId) return
  const input = byId(kind === 'character' ? 'studio-project-character-job' : 'studio-project-scene-job')
  if (!input) return
  input.value = candidate.jobId
  projectState.error = null
  updateInputs(projectState)
  renderStudioProject(projectState)
}

function renderCandidatePanel(state, kind) {
  const isCharacter = kind === 'character'
  const container = byId(isCharacter ? 'studio-project-character-candidates' : 'studio-project-scene-candidates')
  if (!container) return
  container.replaceChildren()
  const candidate = isCharacter ? state.characterCandidate : state.sceneCandidate
  const selectedId = isCharacter ? state.inputs.characterJobId : state.inputs.sceneJobId
  const manifestPack = state.manifest?.packs?.[kind]
  if (candidate) {
    appendCandidateRow(container, {
      title: candidate.jobId,
      detail: candidate.profile ? `${projectT('currentVerified')} · ${candidate.profile}` : projectT('currentVerified'),
      selected: selectedId === candidate.jobId,
      status: selectedId === candidate.jobId ? projectT('selected') : null,
      onSelect: () => selectCandidate(kind, candidate),
    })
  }
  if (selectedId && selectedId !== candidate?.jobId) {
    appendCandidateRow(container, {
      title: manifestPack?.id ? `${manifestPack.id} · ${selectedId}` : selectedId,
      detail: manifestPack?.profile ?? projectT('exactInput'),
      selected: true,
      status: projectT('selected'),
    })
  }
  if (!candidate && !selectedId) {
    const empty = document.createElement('p')
    empty.className = 'project-candidate-empty'
    empty.textContent = projectT(isCharacter ? 'noCurrentCharacter' : 'noCurrentScene')
    container.append(empty)
  }
}

function renderArtifactLinks(id, rows, emptyKey = 'noArtifacts') {
  const container = byId(id)
  if (!container) return
  container.replaceChildren()
  if (!rows.length) {
    const empty = document.createElement('span')
    empty.className = 'project-artifact-empty'
    empty.textContent = projectT(emptyKey)
    container.append(empty)
    return
  }
  for (const row of rows) {
    const link = document.createElement('a')
    link.href = row.url
    link.download = row.file
    link.textContent = row.file
    container.append(link)
  }
}

function releaseRows(state) {
  return projectResultIsCurrent(state) ? releaseProjectArtifacts(state.resultJob) : []
}

function diagnosticRows(state) {
  return state?.phase === 'failed' && state?.diagnosticsVerified
    ? diagnosticProjectArtifacts(state.job)
    : []
}

function renderExport(state) {
  const exportLink = byId('studio-project-export')
  if (!exportLink) return
  const zip = releaseRows(state).find((row) => row.file === 'project_pack.zip')
  if (zip) {
    exportLink.href = zip.url
    exportLink.download = zip.file
    exportLink.removeAttribute('aria-disabled')
    exportLink.removeAttribute('tabindex')
  } else {
    exportLink.removeAttribute('href')
    exportLink.removeAttribute('download')
    exportLink.setAttribute('aria-disabled', 'true')
    exportLink.tabIndex = -1
  }
}

function renderMetrics(state) {
  const manifest = state.manifest
  const validation = state.validation
  setText('studio-project-metric-project', manifest?.project_id ?? '—')
  setText('studio-project-metric-character', manifest?.packs?.character?.id ?? state.inputs.characterJobId ?? '—')
  setText('studio-project-metric-scene', manifest?.packs?.scene?.id ?? state.inputs.sceneJobId ?? '—')
  setText('studio-project-metric-validation', validation?.status ?? '—')
  setText('studio-project-metric-warnings', Array.isArray(validation?.warnings) ? String(validation.warnings.length) : '—')
  setText('studio-project-metric-policy', validation?.style_contract?.policy ?? (state.inputs.strictStyleContract ? 'strict' : 'warn'))
}

function renderBinding(state) {
  const valid = state.inputsValid
  const title = state.job?.id
    ? projectT('bindingJob', { id: state.job.id })
    : valid
      ? projectT('bindingReady')
      : projectT('noBinding')
  setText('studio-project-binding-state', title)
  const project = state.inputs.projectId || '—'
  const character = state.inputs.characterJobId || '—'
  const scene = state.inputs.sceneJobId || '—'
  setText('studio-project-binding-detail', `${project}\n${projectT('bindingCharacter')}: ${character}\n${projectT('bindingScene')}: ${scene}`)
}

function renderStatus(state) {
  const presentation = deriveProjectPresentation(state)
  const phaseCopy = PHASE_COPY[presentation.phase] ?? PHASE_COPY.empty
  const status = byId('studio-project-status')
  if (status) {
    status.textContent = state.serviceAvailable ? projectT(phaseCopy.status) : projectT('statusServiceUnavailable')
    status.dataset.state = state.serviceAvailable ? presentation.phase : 'unavailable'
  }
  setText('studio-project-result-summary', projectT(phaseCopy.result))
  setText('studio-project-runtime-status', state.job?.status ?? projectT(phaseCopy.status))
  const root = byId('studio-project-view')
  if (root) root.dataset.projectPhase = presentation.phase
}

function renderRecovery(state) {
  const visible = ['failed', 'poll_paused', 'stale', 'submission_unknown'].includes(state.phase)
  setHidden('studio-project-recovery', !visible)
  const reason = state.job?.reason ?? errorText(state.error) ?? projectT('unknownError')
  setText('studio-project-recovery-reason', reason)
  setText('studio-project-recovery-job', state.job?.id ?? projectT('noJob'))
  setText('studio-project-recovery-retry', state.job?.retry_hint ?? '—')
  setText('studio-project-recovery-release', projectT('releaseLocked'))
}

function renderControls(state) {
  const presentation = deriveProjectPresentation(state)
  const locked = state.busy || !state.serviceAvailable
  for (const id of [
    'studio-project-id',
    'studio-project-character-job',
    'studio-project-scene-job',
    'studio-project-strict-style',
  ]) {
    const control = byId(id)
    if (control) control.disabled = Boolean(locked)
  }
  for (const [id, candidate] of [
    ['studio-project-use-character', state.characterCandidate],
    ['studio-project-use-scene', state.sceneCandidate],
  ]) {
    const button = byId(id)
    if (button) button.disabled = Boolean(locked || !candidate)
  }
  const primary = byId('studio-project-primary')
  if (primary) {
    primary.disabled = presentation.action === 'blocked'
    primary.textContent = state.busy
      ? projectT('building')
      : presentation.action === 'resume'
        ? projectT('resume')
        : ['failed', 'stale'].includes(state.phase)
          ? projectT('rebuild')
          : projectT('build')
  }
  const error = byId('studio-project-error')
  if (error) {
    error.textContent = errorText(state.error)
    error.hidden = !state.error || ['failed', 'poll_paused', 'stale', 'submission_unknown'].includes(state.phase)
  }
}

export function renderStudioProject(state = projectState) {
  if (!state) return null
  const root = byId('studio-project-view')
  if (!root) return state
  refreshSessionCandidates(state)
  renderStaticCopy(root)
  renderLanguageButtons()
  renderStatus(state)
  renderBinding(state)
  renderCandidatePanel(state, 'character')
  renderCandidatePanel(state, 'scene')
  renderMetrics(state)
  renderRecovery(state)
  renderControls(state)
  renderExport(state)
  renderArtifactLinks('studio-project-artifacts', releaseRows(state))
  renderArtifactLinks('studio-project-diagnostics', diagnosticRows(state))
  setHidden('studio-project-result-metrics', !state.manifest && !state.validation)
  return state
}

function beginOperation(state) {
  state.controller?.abort()
  const controller = new AbortController()
  state.controller = controller
  return controller
}

async function loadFailedDiagnostics(state, job, signal) {
  if (job.status !== 'failed_project_pack') return
  const verified = await verifyProjectFailureDiagnostics(job, state.binding.inputs, { signal })
  state.manifest = verified.manifest
  state.validation = verified.validation
  state.diagnosticsVerified = true
}

async function observeProjectJob(state, job, controller) {
  state.phase = 'running'
  state.busy = 'polling'
  state.job = job
  renderStudioProject(state)
  try {
    const terminal = await pollProjectJob(job, {
      expectedInputs: state.binding.inputs,
      signal: controller.signal,
      onUpdate: (current) => {
        state.job = current
        renderStudioProject(state)
      },
    })
    state.job = terminal
    if (terminal.status === 'done') {
      state.busy = 'verifying'
      renderStudioProject(state)
      const verified = await verifyProjectResult(terminal, state.binding.inputs, { signal: controller.signal })
      state.resultJob = verified.job
      state.manifest = verified.manifest
      state.validation = verified.validation
      state.resultVerified = true
      state.diagnosticsVerified = false
      state.phase = 'complete'
      state.error = null
    } else {
      invalidateResult(state)
      state.phase = 'failed'
      state.error = codedError(terminal.status, terminal.reason || terminal.status)
      await loadFailedDiagnostics(state, terminal, controller.signal)
    }
  } catch (error) {
    if (error?.name === 'AbortError') return
    invalidateResult(state)
    state.error = error
    if (
      projectObservationCanResume(error) &&
      state.job?.id &&
      state.binding?.inputs
    ) state.phase = 'poll_paused'
    else if (error?.code === 'job_not_found') state.phase = 'stale'
    else state.phase = 'failed'
  } finally {
    if (state.controller === controller) {
      state.busy = null
      state.controller = null
      renderStudioProject(state)
    }
  }
}

async function submitProjectJob(state) {
  if (!updateInputs(state, { announceErrors: true })) {
    renderStudioProject(state)
    return
  }
  const inputs = state.inputs
  const binding = Object.freeze({ inputs, inputKey: state.inputsKey, jobId: null })
  state.binding = binding
  state.job = null
  state.resultJob = null
  invalidateResult(state)
  state.phase = 'running'
  state.busy = 'submitting'
  state.error = null
  const controller = beginOperation(state)
  renderStudioProject(state)
  let job
  try {
    job = await postProjectPack(inputs, { signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') return
    state.busy = null
    state.controller = null
    state.error = error
    if (projectSubmissionIsDefiniteRejection(error)) {
      state.phase = 'failed'
    } else {
      state.phase = 'submission_unknown'
      state.error = codedError('submission_unknown', projectT('submissionUnknown'), { cause: error })
    }
    renderStudioProject(state)
    return
  }
  state.binding = Object.freeze({ inputs, inputKey: state.inputsKey, jobId: job.id })
  await observeProjectJob(state, job, controller)
}

async function resumeProjectJob(state) {
  if (!state.job?.id || !state.binding?.inputs || state.busy) return
  const controller = beginOperation(state)
  await observeProjectJob(state, state.job, controller)
}

function bindEvents() {
  for (const id of [
    'studio-project-id',
    'studio-project-character-job',
    'studio-project-scene-job',
  ]) {
    byId(id)?.addEventListener('input', () => {
      if (!projectState || projectState.busy) return
      projectState.error = null
      updateInputs(projectState)
      renderStudioProject(projectState)
    })
  }
  byId('studio-project-strict-style')?.addEventListener('change', () => {
    if (!projectState || projectState.busy) return
    projectState.error = null
    updateInputs(projectState)
    renderStudioProject(projectState)
  })
  byId('studio-project-use-character')?.addEventListener('click', () => {
    selectCandidate('character', projectState?.characterCandidate)
  })
  byId('studio-project-use-scene')?.addEventListener('click', () => {
    selectCandidate('scene', projectState?.sceneCandidate)
  })
  byId('studio-project-primary')?.addEventListener('click', () => {
    const presentation = deriveProjectPresentation(projectState)
    if (presentation.action === 'resume') void resumeProjectJob(projectState)
    else if (presentation.action === 'build') void submitProjectJob(projectState)
  })
  document.querySelectorAll('[data-project-language]').forEach((button) => {
    button.addEventListener('click', () => {
      setCurrentLanguage(button.dataset.projectLanguage)
      const select = byId('language-select')
      if (select) {
        select.value = button.dataset.projectLanguage
        select.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        translateStudioDocument(document, button.dataset.projectLanguage)
        renderStudioProjectLanguage()
      }
    })
  })
}

export function renderStudioProjectLanguage() {
  if (!projectState) return null
  return renderStudioProject(projectState)
}

export function initStudioProject({ serviceAvailable = true } = {}) {
  if (initialized) return projectState
  const root = byId('studio-project-view')
  if (!root) return null
  initialized = true
  projectState = createInitialProjectState({ serviceAvailable })
  bindEvents()
  updateInputs(projectState)
  if (!serviceAvailable) projectState.error = codedError('service_required', projectT('serviceRequired'))
  renderStudioProject(projectState)
  return projectState
}
