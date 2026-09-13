import { getCurrentLanguage } from '../i18n.js'
import {
  COMPAT_CHARACTER_DEFAULTS,
  compatCharacterInputFingerprint,
  fetchCompatCharacterDiagnostics,
  isRecoverableCompatObservationError,
  normalizeCompatCharacterSettings,
  pollCompatCharacterJob,
  submitCompatCharacterJob,
  validateCompatCharacterImageFile,
  verifyCompatCharacterRelease,
} from './characterCompatApi.js'

const COMPAT_COPY = Object.freeze({
  en: Object.freeze({
    entry: 'Advanced compat',
    headerCrumb: '· Advanced compatibility',
    configKicker: 'Independent state machine · existing generate-character API',
    configTitle: 'Advanced compatible generation',
    configHelp: 'Does not share Strict Review / Confirm / Accept. Candidate count is the maximum Provider-call count.',
    name: 'Asset name',
    description: 'Character description',
    mode: 'Generation mode',
    preset: 'Character preset',
    layout: 'Generation layout',
    imageSize: 'Image size',
    candidates: 'Candidates / max calls',
    seed: 'Seed',
    seedPlaceholder: 'random',
    optionalImages: 'Optional image bindings',
    reference: 'Reference',
    palette: 'Palette',
    notSelected: 'Not selected',
    clearFile: 'Clear',
    imageHelp: 'PNG / WebP / JPEG · 32 MiB max · bound to the current input',
    cleanupExport: 'Cleanup and export parameters',
    qualityModeBoundary: 'Quality image mode does not use an asset name, sheet layout, component cleanup, motion stabilization, or multi-scale sheets. Pixel finishing always runs; only max colors and outline are submitted.',
    background: 'Background',
    tolerance: 'Background tolerance',
    minAlpha: 'Minimum alpha',
    minArea: 'Minimum area',
    minAreaRatio: 'Minimum-area ratio',
    motionShift: 'Maximum stabilization shift',
    maxColors: 'Maximum colors',
    outlineMode: 'Outline mode',
    componentCleanup: 'Component cleanup',
    autoCorrect: 'Auto correction',
    motionStabilize: 'Motion stabilization',
    pixelFinishing: 'Pixel finishing',
    outline: 'Outline',
    scalesAria: 'Export scales',
    matrixTitle: 'Compatibility matrix',
    matrixCompat: 'Advanced compatible Character',
    matrixScene: 'Scene online generation',
    sharedProvider: 'Shared Provider',
    nativeGemini: 'Native Gemini',
    noLiveCall: 'No live Provider call is made during this acceptance run.',
    run: 'Run compatible generation',
    resume: 'Resume this Job',
    returnConfig: 'Return to config',
    openExport: 'Open compatible export',
    stageLabel: 'Compatible generation stage',
    stopObserve: 'Stop observing',
    configPhase: 'not run',
    configStatus: 'compat_ready · 0 calls',
    configStageKicker: 'Terminal · current input binding',
    configStageTitle: 'Wait for a real Job',
    configStageHelp: 'Verified downloads open only after the current Job, download disposition, quality gates, and exact artifact URLs all pass.',
    runningPhase: 'same Job · no automatic retry',
    runningStatus: 'compat_running · same Job',
    runningStageKicker: 'Same Job · no automatic retry',
    runningStageTitle: 'Compatible generation in progress',
    runningStageHelp: 'Polling may be resumed after interruption and always reads the same Job.',
    runningKicker: 'One-call task in progress',
    runningTitle: 'Waiting for real Job evidence',
    runningHelp: 'No second Job is created and Strict manual acceptance is never used.',
    pausedPhase: 'observation paused',
    pausedStatus: 'compat_poll_paused',
    pausedStageKicker: 'Same Job retained',
    pausedStageTitle: 'Observation was interrupted',
    pausedStageHelp: 'Resume only this Job. No generate-character POST is repeated.',
    diagnosticPhase: 'terminal · diagnostic only',
    diagnosticStatus: 'compat_diagnostic_only',
    diagnosticStageKicker: 'Terminal · downloads locked',
    diagnosticStageTitle: 'Real diagnostics only',
    diagnosticStageHelp: 'Review-required and diagnostic-only output cannot use Strict Accept.',
    diagnosticKicker: 'Real diagnostics · URL bound',
    diagnosticTitle: 'Candidate needs review',
    diagnosticHelp: 'This Job has no sealed Strict Review, so it cannot be manually accepted.',
    diagnosticLock: 'No Accept · no export · no Project candidate',
    releasePhase: 'verified · quality pass',
    releaseStatus: 'verified · download available',
    releaseStageKicker: 'Terminal · current input bound',
    releaseStageTitle: 'Compatible result is verified and downloadable',
    releaseStageHelp: 'The current Job, download disposition, quality gates, and exact artifact URLs are verified.',
    releaseKicker: 'verified · quality pass',
    releaseTitle: 'Compatible download artifacts verified',
    releaseHelp: 'Only exact artifact URLs for this Job are shown. Any file or parameter change locks them immediately.',
    releaseImageAria: 'Verified compatible Character result',
    unknownPhase: 'submission unknown',
    unknownStatus: 'compat_submission_unknown',
    unknownStageKicker: 'No Job receipt',
    unknownStageTitle: 'Submission outcome is unknown',
    unknownStageHelp: 'A replacement POST could duplicate Provider work, so this screen stays locked.',
    failedPhase: 'integrity blocked',
    failedStatus: 'compat_failed',
    failedStageKicker: 'Terminal · downloads locked',
    failedStageTitle: 'Compatibility evidence failed verification',
    failedStageHelp: 'Fix the input or configuration before creating a new Job.',
    policyTitle: 'Verified download conditions',
    policyDiagnostic: 'Real diagnostics only; no Accept, export, or Project candidate.',
    policyRelease: 'Quality gates and exact Job artifact URLs must all pass.',
    job: 'Job',
    status: 'Status',
    disposition: 'artifact_disposition',
    releaseReady: 'release_ready',
    qualityGate: 'Quality gate',
    projectCandidate: 'Project candidate',
    projectCandidateReady: 'Available · production sheet',
    projectCandidateExportOnly: 'Unavailable · quality image exports only',
    providerCalls: 'Provider calls',
    candidate: 'Selected candidate',
    retryHint: 'retry_hint',
    reason: 'Reason',
    generationEvidence: 'Generation evidence',
    gateEvidence: 'Download-gate evidence',
    qualityEvidence: 'Quality evidence',
    pack: 'Character ZIP',
    source: 'Source PNG',
    normalized: 'Normalized sheet',
    resultImage: 'Generated result',
    metadata: 'Metadata',
    errorPrefix: 'Compatible generation stopped: {detail}',
    pausedMessage: 'Observation stopped locally. The server Job was not cancelled.',
  }),
  zh: Object.freeze({
    entry: '高级兼容',
    headerCrumb: '· 高级兼容',
    configKicker: '独立状态机 · generate-character 现有 API',
    configTitle: '高级兼容生成',
    configHelp: '不混用 Strict Review / Confirm / Accept；候选数就是最大 Provider 调用数。',
    name: '资源名称',
    description: '角色描述',
    mode: '生成模式',
    preset: '角色预设',
    layout: '生成布局',
    imageSize: '图像尺寸',
    candidates: '候选 / 最大调用',
    seed: 'Seed',
    seedPlaceholder: '随机',
    optionalImages: '可选图像绑定',
    reference: '参考图',
    palette: 'Palette',
    notSelected: '未选择',
    clearFile: '清除',
    imageHelp: 'PNG / WebP / JPEG · 最大 32 MiB · 当前输入绑定',
    cleanupExport: '清理与导出参数',
    qualityModeBoundary: '质量单图不使用资源名称、精灵表布局、组件清理、运动稳定或多倍率精灵表；像素精修固定执行，仅最大颜色与描边会提交。',
    background: '背景',
    tolerance: '背景容差',
    minAlpha: '最小 Alpha',
    minArea: '最小面积',
    minAreaRatio: '最小面积比例',
    motionShift: '稳定最大位移',
    maxColors: '最大颜色',
    outlineMode: '描边模式',
    componentCleanup: '组件清理',
    autoCorrect: '自动校正',
    motionStabilize: '运动稳定',
    pixelFinishing: '像素精修',
    outline: '描边',
    scalesAria: '导出倍率',
    matrixTitle: '兼容矩阵',
    matrixCompat: '高级兼容 Character',
    matrixScene: 'Scene 在线生成',
    sharedProvider: '共享 Provider',
    nativeGemini: '原生 Gemini',
    noLiveCall: '本次验收不发起真实 Provider 调用。',
    run: '运行兼容生成',
    resume: '继续观察当前 Job',
    returnConfig: '返回配置',
    openExport: '打开兼容导出',
    stageLabel: '兼容生成舞台',
    stopObserve: '停止观察',
    configPhase: '尚未运行',
    configStatus: 'compat_ready · 0 次调用',
    configStageKicker: '终态 · 当前输入绑定',
    configStageTitle: '等待真实 Job',
    configStageHelp: '当前 Job、下载处置、质量门与精确产物 URL 全部通过后才开放已验证下载。',
    runningPhase: '同一 Job · 无自动重试',
    runningStatus: 'compat_running · 同一 Job',
    runningStageKicker: '同一 Job · 无自动重试',
    runningStageTitle: '兼容生成进行中',
    runningStageHelp: '观察中断后可 Resume，并且始终只读取同一 Job。',
    runningKicker: '一次调用任务进行中',
    runningTitle: '等待真实 Job 证据',
    runningHelp: '不会创建第二个 Job，也不会使用 Strict 的人工验收。',
    pausedPhase: '观察已暂停',
    pausedStatus: 'compat_poll_paused',
    pausedStageKicker: '同一 Job 已保留',
    pausedStageTitle: '观察被中断',
    pausedStageHelp: '只继续当前 Job，不会重复 generate-character POST。',
    diagnosticPhase: '终态 · 仅诊断',
    diagnosticStatus: 'compat_diagnostic_only',
    diagnosticStageKicker: '终态 · 下载锁定',
    diagnosticStageTitle: '仅诊断结果',
    diagnosticStageHelp: 'review_required 与 diagnostic_only 不能借用 Strict Accept。',
    diagnosticKicker: '真实诊断 · URL 已绑定',
    diagnosticTitle: '候选需要复核',
    diagnosticHelp: '此 Job 没有封存 Strict Review，因此不能人工 Accept。',
    diagnosticLock: '无 Accept · 无导出 · 无 Project candidate',
    releasePhase: 'verified · 质量通过',
    releaseStatus: '已验证 · 可下载',
    releaseStageKicker: '终态 · 当前输入绑定',
    releaseStageTitle: '兼容结果已验证，可下载',
    releaseStageHelp: '当前 Job、下载处置、质量门与精确产物 URL 已全部核验。',
    releaseKicker: 'verified · quality pass',
    releaseTitle: '兼容下载产物已验证',
    releaseHelp: '仅展示当前 Job 的精确 artifact URL；切换文件或参数后立即锁定。',
    releaseImageAria: '已核验的兼容 Character 结果',
    unknownPhase: '提交结果未知',
    unknownStatus: 'compat_submission_unknown',
    unknownStageKicker: '未收到 Job 回执',
    unknownStageTitle: '提交结果未知',
    unknownStageHelp: '替换 POST 可能重复消耗 Provider，因此当前页面保持锁定。',
    failedPhase: '完整性阻断',
    failedStatus: 'compat_failed',
    failedStageKicker: '终态 · 下载锁定',
    failedStageTitle: '兼容证据核验失败',
    failedStageHelp: '修正输入或配置后，才能创建新的 Job。',
    policyTitle: '已验证下载条件',
    policyDiagnostic: '只显示真实诊断；不提供 Accept、导出或 Project candidate。',
    policyRelease: '质量门和精确 Job artifact URL 必须全部通过。',
    job: 'Job',
    status: '状态',
    disposition: 'artifact_disposition',
    releaseReady: 'release_ready',
    qualityGate: '质量门',
    projectCandidate: 'Project candidate',
    projectCandidateReady: '可用 · production sheet',
    projectCandidateExportOnly: '不可用 · quality 单图仅可导出',
    providerCalls: 'Provider 调用',
    candidate: '选中候选',
    retryHint: 'retry_hint',
    reason: '原因',
    generationEvidence: '生成证据',
    gateEvidence: '下载门证据',
    qualityEvidence: '质量证据',
    pack: 'Character ZIP',
    source: '源 PNG',
    normalized: '标准化精灵表',
    resultImage: '生成结果',
    metadata: 'Metadata',
    errorPrefix: '兼容生成已停止：{detail}',
    pausedMessage: '仅停止本地观察；服务端 Job 未被取消。',
  }),
})

const FORM_CONTROL_IDS = Object.freeze([
  'character-compat-name',
  'character-compat-description',
  'character-compat-mode',
  'character-compat-preset',
  'character-compat-layout',
  'character-compat-image-size',
  'character-compat-candidates',
  'character-compat-seed',
  'character-compat-reference',
  'character-compat-reference-clear',
  'character-compat-palette',
  'character-compat-palette-clear',
  'character-compat-background',
  'character-compat-tolerance',
  'character-compat-min-alpha',
  'character-compat-min-area',
  'character-compat-min-area-ratio',
  'character-compat-motion-shift',
  'character-compat-max-colors',
  'character-compat-outline-mode',
  'character-compat-component-cleanup',
  'character-compat-auto-correct',
  'character-compat-motion-stabilize',
  'character-compat-pixel-finishing',
  'character-compat-outline',
  'character-compat-export-1x',
  'character-compat-export-2x',
  'character-compat-export-3x',
  'character-compat-export-4x',
])

const SETTINGS_CONTROL_IDS = FORM_CONTROL_IDS.filter((id) => ![
  'character-compat-reference',
  'character-compat-reference-clear',
  'character-compat-palette',
  'character-compat-palette-clear',
].includes(id))

let initialized = false
let compatActive = false
let serviceConnectionAvailable = true
let operationEpoch = 0
let activeController = null
let state = createInitialCompatCharacterState()

function byId(id) {
  return document.getElementById(id)
}

function compatT(key, replacements = {}) {
  const language = getCurrentLanguage() === 'en' ? 'en' : 'zh'
  const template = COMPAT_COPY[language][key] ?? COMPAT_COPY.en[key] ?? key
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(replacements[name] ?? ''))
}

function setText(id, value) {
  const node = byId(id)
  if (node) node.textContent = String(value ?? '')
}

function setHidden(id, hidden) {
  const node = byId(id)
  if (node) node.hidden = hidden
}

export function createInitialCompatCharacterState() {
  return {
    phase: 'config',
    busy: null,
    settings: { ...COMPAT_CHARACTER_DEFAULTS },
    referenceFile: null,
    paletteFile: null,
    inputEpoch: 0,
    binding: null,
    job: null,
    result: null,
    diagnostics: null,
    error: null,
  }
}

function readSettingsFromControls() {
  return {
    name: byId('character-compat-name')?.value ?? '',
    description: byId('character-compat-description')?.value ?? '',
    t2iMode: byId('character-compat-mode')?.value,
    characterPreset: byId('character-compat-preset')?.value,
    generationLayout: byId('character-compat-layout')?.value,
    imageSize: byId('character-compat-image-size')?.value,
    candidateCount: Number(byId('character-compat-candidates')?.value),
    seed: byId('character-compat-seed')?.value ?? '',
    backgroundMode: byId('character-compat-background')?.value,
    backgroundTolerance: Number(byId('character-compat-tolerance')?.value),
    componentCleanup: Boolean(byId('character-compat-component-cleanup')?.checked),
    minAlpha: Number(byId('character-compat-min-alpha')?.value),
    minArea: Number(byId('character-compat-min-area')?.value),
    minAreaRatio: Number(byId('character-compat-min-area-ratio')?.value),
    autoCorrect: Boolean(byId('character-compat-auto-correct')?.checked),
    motionStabilize: Boolean(byId('character-compat-motion-stabilize')?.checked),
    motionMaxShift: Number(byId('character-compat-motion-shift')?.value),
    pixelFinishing: Boolean(byId('character-compat-pixel-finishing')?.checked),
    pixelFinishingMaxColors: Number(byId('character-compat-max-colors')?.value),
    pixelFinishingOutline: Boolean(byId('character-compat-outline')?.checked),
    pixelFinishingOutlineMode: byId('character-compat-outline-mode')?.value,
    export1x: Boolean(byId('character-compat-export-1x')?.checked),
    export2x: Boolean(byId('character-compat-export-2x')?.checked),
    export3x: Boolean(byId('character-compat-export-3x')?.checked),
    export4x: Boolean(byId('character-compat-export-4x')?.checked),
  }
}

function currentInputKey(value = state) {
  return compatCharacterInputFingerprint({
    settings: value.settings,
    referenceFile: value.referenceFile,
    paletteFile: value.paletteFile,
    inputEpoch: value.inputEpoch,
  })
}

function currentInputIsValid(value = state) {
  try {
    normalizeCompatCharacterSettings(value.settings)
    validateCompatCharacterImageFile(value.referenceFile)
    validateCompatCharacterImageFile(value.paletteFile)
    return true
  } catch {
    return false
  }
}

export function compatCharacterResultIsCurrent(value = state) {
  if (value?.phase !== 'release' || value?.result?.job?.status !== 'done' || !value?.binding?.inputKey) return false
  try {
    return value.binding.inputKey === currentInputKey(value) &&
      value.result.job.release_ready === true &&
      value.result.job.artifact_disposition === 'release' &&
      Boolean(value.result.job.zip_url)
  } catch {
    return false
  }
}

export function compatCharacterProjectCandidateIsCurrent(value = state) {
  return compatCharacterResultIsCurrent(value) && value?.binding?.settings?.t2iMode === 'production_sheet_v0'
}

export function compatCharacterExportUrl(value = state) {
  return compatCharacterResultIsCurrent(value) ? String(value.result.job.zip_url) : null
}

export function deriveCompatCharacterPresentation(value = state) {
  const valid = currentInputIsValid(value)
  const phase = ['config', 'running', 'poll_paused', 'diagnostic', 'release', 'submission_unknown', 'failed'].includes(value?.phase)
    ? value.phase
    : 'failed'
  const copy = {
    config: ['configPhase', 'configStatus', 'configStageKicker', 'configStageTitle', 'configStageHelp', valid ? 'run' : 'run', valid ? 'run' : 'blocked'],
    running: ['runningPhase', 'runningStatus', 'runningStageKicker', 'runningStageTitle', 'runningStageHelp', 'run', 'running'],
    poll_paused: ['pausedPhase', 'pausedStatus', 'pausedStageKicker', 'pausedStageTitle', 'pausedStageHelp', 'resume', 'resume'],
    diagnostic: ['diagnosticPhase', 'diagnosticStatus', 'diagnosticStageKicker', 'diagnosticStageTitle', 'diagnosticStageHelp', 'returnConfig', 'config'],
    release: ['releasePhase', 'releaseStatus', 'releaseStageKicker', 'releaseStageTitle', 'releaseStageHelp', 'openExport', 'export'],
    submission_unknown: ['unknownPhase', 'unknownStatus', 'unknownStageKicker', 'unknownStageTitle', 'unknownStageHelp', 'run', 'blocked'],
    failed: ['failedPhase', 'failedStatus', 'failedStageKicker', 'failedStageTitle', 'failedStageHelp', 'returnConfig', 'config'],
  }[phase]
  return Object.freeze({
    phase,
    phaseKey: copy[0],
    statusKey: copy[1],
    kickerKey: copy[2],
    titleKey: copy[3],
    helpKey: copy[4],
    primaryKey: copy[5],
    action: copy[6],
    valid,
    releaseReady: compatCharacterResultIsCurrent(value),
  })
}

function beginOperation() {
  activeController?.abort()
  activeController = new AbortController()
  operationEpoch += 1
  return { epoch: operationEpoch, signal: activeController.signal }
}

function isCurrentOperation(epoch) {
  return epoch === operationEpoch
}

function errorDetail(error) {
  return compatT('errorPrefix', { detail: String(error?.message || error || 'unknown error') })
}

function setState(patch, { focus = false } = {}) {
  state = { ...state, ...patch }
  renderStudioCharacterCompat()
  if (focus) queueMicrotask(() => byId('character-compat-stage-title')?.focus({ preventScroll: true }))
}

function invalidateInput(patch = {}) {
  if (state.phase !== 'config') return
  activeController?.abort()
  operationEpoch += 1
  state = {
    ...state,
    ...patch,
    phase: 'config',
    busy: null,
    inputEpoch: state.inputEpoch + 1,
    binding: null,
    job: null,
    result: null,
    diagnostics: null,
    error: null,
  }
  renderStudioCharacterCompat()
}

function updateSettingsFromControls() {
  invalidateInput({ settings: readSettingsFromControls() })
}

function selectCompatFile(kind, file) {
  if (state.phase !== 'config') return
  try {
    validateCompatCharacterImageFile(file, { required: true, label: kind === 'referenceFile' ? 'Reference image' : 'Palette image' })
    invalidateInput({ [kind]: file })
  } catch (error) {
    setState({ error: errorDetail(error) })
  }
}

function clearCompatFile(kind, inputId) {
  if (state.phase !== 'config') return
  const input = byId(inputId)
  if (input) input.value = ''
  invalidateInput({ [kind]: null })
}

function renderRows(containerId, rows) {
  const container = byId(containerId)
  if (!container) return
  container.replaceChildren()
  for (const [label, value] of rows) {
    const row = document.createElement('div')
    const term = document.createElement('dt')
    const detail = document.createElement('dd')
    term.textContent = label
    detail.textContent = String(value ?? '—')
    row.append(term, detail)
    container.append(row)
  }
}

function renderLinks(containerId, links) {
  const container = byId(containerId)
  if (!container) return
  container.replaceChildren()
  for (const [label, url] of links) {
    if (!url) continue
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.target = '_blank'
    anchor.rel = 'noopener'
    anchor.textContent = label
    container.append(anchor)
  }
}

function callSummary(job = state.job) {
  const budget = job?.provider_call_budget
  if (!budget) return 'Provider —'
  return `Provider ${budget.used_provider_calls ?? '—'}/${budget.max_provider_calls ?? '—'}`
}

function renderDiagnostic() {
  const visible = state.phase === 'diagnostic'
  setHidden('character-compat-diagnostic', !visible)
  if (!visible) return
  const job = state.job ?? {}
  const selection = job.candidate_selection ?? {}
  renderRows('character-compat-diagnostic-rows', [
    [compatT('job'), job.id],
    [compatT('status'), job.failure_status || job.status],
    [compatT('disposition'), job.artifact_disposition || selection.artifact_disposition],
    [compatT('releaseReady'), String(job.release_ready ?? selection.release_ready ?? false)],
    [compatT('providerCalls'), callSummary(job).replace('Provider ', '')],
    [compatT('candidate'), selection.release_selected_index ?? '—'],
    [compatT('retryHint'), job.retry_hint ?? '—'],
    [compatT('reason'), job.reason ?? job.release_gate?.blocking_errors?.[0] ?? '—'],
  ])
  renderLinks('character-compat-diagnostic-links', [
    [compatT('generationEvidence'), job.generation_url],
    [compatT('gateEvidence'), job.generation_release_gate_url],
    [compatT('qualityEvidence'), job.debug_report_url || job.result_url],
  ])
}

function renderRelease() {
  const visible = compatCharacterResultIsCurrent()
  setHidden('character-compat-release', !visible)
  const job = visible ? state.result.job : null
  const image = byId('character-compat-release-image')
  if (image) {
    if (job) image.src = job.normalized_sheet_url || job.t2i_result_url
    else image.removeAttribute('src')
  }
  if (!job) return
  renderRows('character-compat-release-rows', [
    [compatT('job'), job.id],
    [compatT('disposition'), job.artifact_disposition],
    [compatT('releaseReady'), String(job.release_ready)],
    [compatT('qualityGate'), state.result.releaseGate?.status],
    [compatT('projectCandidate'), compatT(
      compatCharacterProjectCandidateIsCurrent() ? 'projectCandidateReady' : 'projectCandidateExportOnly',
    )],
    [compatT('providerCalls'), callSummary(job).replace('Provider ', '')],
    [compatT('candidate'), state.result.selection?.release_selected_index],
  ])
  renderLinks('character-compat-release-links', [
    [compatT('pack'), job.zip_url],
    [compatT('source'), job.source_url],
    [compatT('normalized'), job.normalized_sheet_url],
    [compatT('resultImage'), job.t2i_result_url],
    [compatT('metadata'), job.metadata_url || job.result_url],
    [compatT('generationEvidence'), job.generation_url],
    [compatT('gateEvidence'), job.generation_release_gate_url],
    ...state.result.multiResolutionSheetUrls
      .slice()
      .sort((left, right) => left.frame_size - right.frame_size)
      .map((entry) => {
        const baseFrameSize = Number(state.result.animations?.frame_size?.w)
        const scale = Number.isFinite(baseFrameSize) && baseFrameSize > 0
          ? entry.frame_size / baseFrameSize
          : null
        return [`PNG ${Number.isInteger(scale) ? `${scale}× · ` : ''}${entry.frame_size}px`, entry.url]
      }),
  ])
}

function renderFileBindings() {
  setText('character-compat-reference-name', state.referenceFile?.name || compatT('notSelected'))
  setText('character-compat-palette-name', state.paletteFile?.name || compatT('notSelected'))
}

function renderControlAvailability(presentation) {
  const locked = state.phase !== 'config' || Boolean(state.busy)
  for (const id of FORM_CONTROL_IDS) {
    const control = byId(id)
    if (control) control.disabled = !serviceConnectionAvailable || locked
  }
  const qualityImageMode = state.settings.t2iMode === 'quality_character_v0'
  document.querySelectorAll('[data-character-compat-production-only]').forEach((node) => {
    node.hidden = qualityImageMode
    if (qualityImageMode) {
      node.querySelectorAll('input, select, textarea, button').forEach((control) => {
        control.disabled = true
      })
    }
  })
  setHidden('character-compat-quality-boundary', !qualityImageMode)
  const primary = byId('character-compat-primary')
  if (primary) {
    primary.dataset.action = presentation.action
    primary.textContent = compatT(presentation.primaryKey)
    primary.disabled = !serviceConnectionAvailable || Boolean(state.busy) ||
      ['blocked', 'running', 'config'].includes(presentation.action) ||
      (presentation.action === 'export' && !presentation.releaseReady)
  }
  setHidden('character-compat-return', !['diagnostic', 'failed', 'release'].includes(state.phase))
  const returnButton = byId('character-compat-return')
  if (returnButton) returnButton.disabled = Boolean(state.busy)
  setHidden('character-compat-stop', state.phase !== 'running' || !state.job?.id)
}

function renderTopbar(presentation) {
  setText('character-header-crumb', compatT('headerCrumb'))
  const topStatus = byId('character-top-status')
  if (topStatus) {
    topStatus.textContent = compatT(presentation.statusKey)
    topStatus.dataset.state = presentation.releaseReady
      ? 'ready'
      : ['failed', 'submission_unknown', 'diagnostic'].includes(state.phase)
        ? 'error'
        : state.phase === 'running' || state.busy
          ? 'loading'
          : 'idle'
    topStatus.setAttribute('aria-busy', String(state.phase === 'running' || Boolean(state.busy)))
  }
  const exportLink = byId('character-export-link')
  if (!exportLink) return
  if (presentation.releaseReady) {
    exportLink.href = state.result.job.zip_url
    exportLink.removeAttribute('aria-disabled')
    exportLink.removeAttribute('tabindex')
    exportLink.textContent = compatT('openExport')
  } else {
    exportLink.removeAttribute('href')
    exportLink.setAttribute('aria-disabled', 'true')
    exportLink.tabIndex = -1
    exportLink.textContent = compatT('diagnosticLock')
  }
}

export function renderStudioCharacterCompat() {
  const workspace = byId('character-compat-workspace')
  if (!workspace) return
  const presentation = deriveCompatCharacterPresentation()
  workspace.dataset.characterCompatPhase = state.phase
  setText('character-compat-stage-phase', compatT(presentation.phaseKey))
  setText('character-compat-stage-kicker', compatT(presentation.kickerKey))
  setText('character-compat-stage-title', compatT(presentation.titleKey))
  setText('character-compat-stage-help', state.error || compatT(presentation.helpKey))
  setText('character-compat-job', state.job?.id ?? '—')
  setText('character-compat-calls', callSummary())
  const progress = byId('character-compat-progress-bar')
  if (progress) progress.value = { queued: 18, generating: 44, post_processing: 76 }[state.job?.status] ?? 18
  setHidden('character-compat-progress', !['running', 'poll_paused'].includes(state.phase))
  renderFileBindings()
  renderDiagnostic()
  renderRelease()
  renderControlAvailability(presentation)
  const error = byId('character-compat-error')
  if (error) {
    error.hidden = !state.error
    error.textContent = state.error || ''
  }
  if (compatActive) renderTopbar(presentation)
}

export function renderStudioCharacterCompatLanguage() {
  const language = getCurrentLanguage() === 'en' ? 'en' : 'zh'
  document.querySelectorAll('[data-character-compat-copy]').forEach((element) => {
    const key = element.dataset.characterCompatCopy
    element.textContent = COMPAT_COPY[language][key] ?? COMPAT_COPY.en[key] ?? key
  })
  document.querySelectorAll('[data-character-compat-aria]').forEach((element) => {
    const key = element.dataset.characterCompatAria
    element.setAttribute('aria-label', COMPAT_COPY[language][key] ?? COMPAT_COPY.en[key] ?? key)
  })
  document.querySelectorAll('[data-character-compat-placeholder]').forEach((element) => {
    const key = element.dataset.characterCompatPlaceholder
    element.setAttribute('placeholder', COMPAT_COPY[language][key] ?? COMPAT_COPY.en[key] ?? key)
  })
  renderStudioCharacterCompat()
}

function currentBindingStillValid(binding) {
  try {
    return Boolean(binding?.inputKey) && binding.inputKey === currentInputKey()
  } catch {
    return false
  }
}

async function resolveTerminalJob(job, binding, operation) {
  if (!isCurrentOperation(operation.epoch) || !currentBindingStillValid(binding)) return
  const claimsRelease = job.status === 'done' && job.release_ready === true && job.artifact_disposition === 'release'
  try {
    if (claimsRelease) {
      const result = await verifyCompatCharacterRelease(job, {
        settings: binding.settings,
        referenceFile: binding.referenceFile,
        paletteFile: binding.paletteFile,
        signal: operation.signal,
      })
      if (!isCurrentOperation(operation.epoch) || !currentBindingStillValid(binding)) return
      setState({ phase: 'release', busy: null, job, result, diagnostics: null, error: null }, { focus: true })
      return
    }
    const diagnostics = await fetchCompatCharacterDiagnostics(job, {
      settings: binding.settings,
      referenceFile: binding.referenceFile,
      paletteFile: binding.paletteFile,
      signal: operation.signal,
    })
    if (!isCurrentOperation(operation.epoch) || !currentBindingStillValid(binding)) return
    setState({ phase: 'diagnostic', busy: null, job, result: null, diagnostics, error: null }, { focus: true })
  } catch (error) {
    if (!isCurrentOperation(operation.epoch) || error?.name === 'AbortError') return
    if (isRecoverableCompatObservationError(error)) {
      setState({ phase: 'poll_paused', busy: null, job, error: errorDetail(error) }, { focus: true })
      return
    }
    setState({ phase: 'failed', busy: null, job, result: null, diagnostics: null, error: errorDetail(error) }, { focus: true })
  }
}

async function observeCompatJob(initialJob, binding, operation) {
  try {
    const terminal = await pollCompatCharacterJob(initialJob, {
      signal: operation.signal,
      onUpdate: (job) => {
        if (!isCurrentOperation(operation.epoch) || !currentBindingStillValid(binding)) return
        state = { ...state, phase: 'running', busy: 'observe', job, error: null }
        renderStudioCharacterCompat()
      },
    })
    await resolveTerminalJob(terminal, binding, operation)
  } catch (error) {
    if (!isCurrentOperation(operation.epoch) || error?.name === 'AbortError') return
    if (isRecoverableCompatObservationError(error)) {
      const retainedJob = error?.payload?.id === initialJob.id ? error.payload : state.job ?? initialJob
      setState({ phase: 'poll_paused', busy: null, job: retainedJob, error: errorDetail(error) }, { focus: true })
      return
    }
    setState({ phase: 'failed', busy: null, result: null, diagnostics: null, error: errorDetail(error) }, { focus: true })
  }
}

async function runCompatCharacter() {
  if (state.phase !== 'config' || state.busy || !serviceConnectionAvailable) return
  let settings
  let inputKey
  try {
    settings = normalizeCompatCharacterSettings(readSettingsFromControls())
    state = { ...state, settings }
    inputKey = currentInputKey()
  } catch (error) {
    setState({ error: errorDetail(error) })
    return
  }
  const referenceFile = state.referenceFile
  const paletteFile = state.paletteFile
  const binding = Object.freeze({ inputKey, settings, referenceFile, paletteFile })
  const operation = beginOperation()
  setState({
    phase: 'running',
    busy: 'submit',
    binding,
    job: null,
    result: null,
    diagnostics: null,
    error: null,
  }, { focus: true })
  try {
    const job = await submitCompatCharacterJob({ settings, referenceFile, paletteFile }, { signal: operation.signal })
    if (!isCurrentOperation(operation.epoch) || !currentBindingStillValid(binding)) return
    state = { ...state, phase: 'running', busy: 'observe', job }
    renderStudioCharacterCompat()
    await observeCompatJob(job, binding, operation)
  } catch (error) {
    if (!isCurrentOperation(operation.epoch) || error?.name === 'AbortError') return
    const submissionUnknown = ['request_failed', 'request_timeout', 'fetch_unavailable'].includes(error?.code)
    setState({
      phase: submissionUnknown ? 'submission_unknown' : 'failed',
      busy: null,
      job: null,
      error: errorDetail(error),
    }, { focus: true })
  }
}

async function resumeCompatObservation() {
  if (state.phase !== 'poll_paused' || !state.job?.id || !currentBindingStillValid(state.binding)) return
  const operation = beginOperation()
  const job = state.job
  const binding = state.binding
  setState({ phase: 'running', busy: 'observe', error: null }, { focus: true })
  if (['done', 'failed', 'failed_quality_gate', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'].includes(job.status)) {
    await resolveTerminalJob(job, binding, operation)
  } else {
    await observeCompatJob(job, binding, operation)
  }
}

function stopCompatObservation() {
  if (state.phase !== 'running' || !state.job?.id) return
  activeController?.abort()
  operationEpoch += 1
  setState({ phase: 'poll_paused', busy: null, error: compatT('pausedMessage') }, { focus: true })
}

function returnToCompatConfig() {
  if (!['diagnostic', 'release', 'failed'].includes(state.phase) || state.busy) return
  activeController?.abort()
  operationEpoch += 1
  setState({
    phase: 'config',
    busy: null,
    inputEpoch: state.inputEpoch + 1,
    binding: null,
    job: null,
    result: null,
    diagnostics: null,
    error: null,
  })
  queueMicrotask(() => byId('character-compat-title')?.focus({ preventScroll: true }))
}

function handlePrimaryAction() {
  const action = byId('character-compat-primary')?.dataset.action
  if (action === 'run') void runCompatCharacter()
  else if (action === 'resume') void resumeCompatObservation()
  else if (action === 'export') {
    const url = compatCharacterExportUrl()
    if (!url) return
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = ''
    anchor.rel = 'noopener'
    anchor.click()
  }
}

export function setStudioCharacterCompatActive(active) {
  compatActive = Boolean(active)
  renderStudioCharacterCompatLanguage()
}

export function getStudioCompatCharacterProjectCandidate() {
  if (!compatCharacterProjectCandidateIsCurrent()) return null
  const job = state.result.job
  return Object.freeze({
    kind: 'character',
    jobId: job.id,
    sourceJobId: job.id,
    status: 'done',
    profile: `compat_${state.binding.settings.t2iMode}`,
    zipUrl: job.zip_url,
  })
}

export function initStudioCharacterCompat({ serviceAvailable = true } = {}) {
  if (initialized) return
  initialized = true
  serviceConnectionAvailable = Boolean(serviceAvailable)
  state = createInitialCompatCharacterState()
  state.settings = readSettingsFromControls()
  for (const id of SETTINGS_CONTROL_IDS) {
    const control = byId(id)
    const eventName = control?.matches('input[type="text"], input[type="number"], textarea') ? 'input' : 'change'
    control?.addEventListener(eventName, updateSettingsFromControls)
  }
  byId('character-compat-reference')?.addEventListener('change', (event) => {
    const file = event.currentTarget?.files?.[0]
    if (file) selectCompatFile('referenceFile', file)
  })
  byId('character-compat-palette')?.addEventListener('change', (event) => {
    const file = event.currentTarget?.files?.[0]
    if (file) selectCompatFile('paletteFile', file)
  })
  byId('character-compat-reference-clear')?.addEventListener('click', () => clearCompatFile('referenceFile', 'character-compat-reference'))
  byId('character-compat-palette-clear')?.addEventListener('click', () => clearCompatFile('paletteFile', 'character-compat-palette'))
  byId('character-compat-primary')?.addEventListener('click', handlePrimaryAction)
  byId('character-compat-stop')?.addEventListener('click', stopCompatObservation)
  byId('character-compat-return')?.addEventListener('click', returnToCompatConfig)
  renderStudioCharacterCompatLanguage()
}
