import { applyPixelStyleCorrection } from '../../character-pack/stylePipeline.js'
import { buildScenePackFromTileSheet } from '../../scene-pack/tileSheetIngestion.js'
import { conditionTileSheetEdges } from '../../scene-pack/tileEdgeConditioning.js'
import { getCurrentLanguage, setCurrentLanguage } from '../i18n.js'
import { translateStudioDocument } from './settingsView.js'
import {
  SCENE_MAX_CANDIDATES,
  SCENE_SOURCE_MAX_BYTES,
  diagnosticSceneArtifacts,
  fetchSceneJsonArtifact,
  normalizeSceneOptions,
  pollSceneJob,
  postSceneGeneration,
  postSceneImport,
  releaseSceneArtifacts,
  sceneSubmissionIsDefiniteRejection,
} from './sceneApi.js'

export const SCENE_PHASES = Object.freeze([
  'empty',
  'ready',
  'running',
  'complete',
  'quality_failed',
  'failed',
  'poll_paused',
  'stale',
  'submission_unknown',
])

const PHASE_SET = new Set(SCENE_PHASES)

export const SCENE_COPY = Object.freeze({
  en: Object.freeze({
    headerTitle: 'Scene Studio',
    modeLabel: 'Tile source',
    modeLocal: 'Import tiles',
    modeLive: 'Generate tiles',
    export: 'Export pack',
    languageLabel: 'Interface language',
    flowEyebrow: 'Current task',
    stepsLabel: 'Scene workflow',
    stepSource: 'Source',
    stepQuality: 'Quality',
    stepPreview: 'Preview',
    stepExport: 'Export',
    localSourceTitle: 'Dual-grid atlas',
    localSourceChoose: 'Drop or choose a tile atlas',
    localSourceHelp: 'PNG / WebP / JPEG · 192×192 · 8 MB maximum',
    localSourceProfile: '4×4 cells · 48px source cell · 32px runtime tile',
    liveSourceTitle: 'Generate a tile source',
    liveDescriptionLabel: 'Scene description',
    liveDescriptionPlaceholder: 'Example: muted mossy stone path, crisp pixel blocks, top-down scene',
    candidateCount: 'Candidates',
    providerNote: 'Uses the shared Provider from Settings. Each candidate is exactly one call.',
    mapOptionsTitle: 'Preview parameters',
    fieldWidth: 'Width',
    fieldHeight: 'Height',
    fieldPattern: 'Arrangement',
    fieldSeed: 'Seed',
    fieldDensity: 'Density',
    advancedTitle: 'Advanced / experimental',
    styleSnap: 'Palette snap',
    maxColors: 'Maximum colors',
    edgeCondition: 'Edge condition',
    edgeBand: 'Edge band',
    edgeMode: 'Mode',
    rawPolicy: 'Raw-tile policy',
    bindingTitle: 'Current binding',
    canvasLabel: 'Current Scene dual-grid preview',
    qualityTitle: 'Quality gate',
    qualityCoverage: 'Tile coverage',
    qualitySeams: 'Seam failures',
    qualityWarnings: 'Warnings',
    artifactListLabel: 'Current Scene artifacts',
    runningRecovery: 'Interrupted polling pauses observation only; it never creates another Job.',
    recoveryAction: 'Recovery action',
    recoveryOutputs: 'Verified downloads',
    diagnosticListLabel: 'Current Scene diagnostics',
    willTitle: 'Will do',
    willBody: 'tile ingest · quality gate · dual-grid preview · single-level LDtk · scene_pack.zip',
    wontTitle: 'Not provided',
    wontBody: 'full map editor · WFC · multi-layer world · automatic layer rules',
    nextTitle: 'Next boundary',
    nextBody: 'After export, Project can combine this with a character pack. This module does not enter Project.',
    shellNoteTitle: 'Shell note',
    exportDialogTitle: 'Current available artifacts',
    exportDialogTruth: 'Only same-origin URLs returned by the current verified done Job are listed.',
    exportListLabel: 'Current downloadable Scene artifacts',
    close: 'Close',
    download: 'Download',
    locked: 'Locked',
    unavailable: 'Unavailable',
    noArtifacts: 'No current artifacts',
    candidateBinding: '{count} candidate(s)',
    confirmCalls: 'I confirm at most {count} Provider call(s) for this run',
    phaseEmptyTitle: 'From source tiles to an exportable scene',
    phaseEmptySummary: 'Tiles are Scene input. Real artifacts unlock only after the current result passes its quality gate.',
    phaseReadyTitle: 'Current Scene input is ready',
    phaseReadySummary: 'The browser preview is derived from the selected atlas. It is not a server artifact.',
    phaseRunningTitle: 'Scene pipeline is running',
    phaseRunningSummary: 'The same Job advances through queued, generating, and post_processing.',
    phaseCompleteTitle: 'Current Scene pack is complete',
    phaseCompleteSummary: 'The quality artifact passed and every download is bound to this Job.',
    phaseQualityFailedTitle: 'Quality gate blocked verified downloads',
    phaseQualityFailedSummary: 'Diagnostics remain available, but verified downloads stay locked.',
    phaseFailedTitle: 'Scene processing did not complete',
    phaseFailedSummary: 'Read the current reason and retry_hint. Nothing is retried automatically.',
    phasePausedTitle: 'Job observation paused',
    phasePausedSummary: 'Resume polling the same Job. Do not submit a replacement.',
    phaseStaleTitle: 'Current input and result differ',
    phaseStaleSummary: 'The previous result is reference-only; preview and downloads stay locked.',
    phaseUnknownTitle: 'Submission receipt is unknown',
    phaseUnknownSummary: 'A live call may have been accepted. Automatic resubmission is blocked.',
    crumbEmpty: '· Tile source',
    crumbReady: '· Local preview',
    crumbRunning: '· Running',
    crumbComplete: '· Preview & export',
    crumbRecovery: '· Recovery',
    statusEmpty: 'Waiting for source',
    statusReady: 'Ready',
    statusRunning: 'Running',
    statusComplete: 'Complete',
    statusQualityFailed: 'Quality failed',
    statusFailed: 'Failed',
    statusPaused: 'Observation paused',
    statusStale: 'Stale',
    statusUnknown: 'Receipt unknown',
    pillMain: 'Main path',
    pillReady: 'Local preview',
    pillRunning: 'Running',
    pillDone: 'Done',
    pillRecovery: 'Recovery',
    stagePreview: 'Stage · Scene preview',
    stageRunning: 'Stage · Pipeline status',
    stageResult: 'Stage · Current result',
    stageRecovery: 'Stage · Recovery',
    stageBoundary: 'No full map editor · pipeline preview only',
    runtimeWaiting: 'Waiting for source',
    runtimeLocal: 'Local preview · 0 Provider',
    runtimeRunning: 'Same Job · no auto-retry',
    runtimeComplete: 'done · export ready',
    runtimeLocked: 'downloads locked',
    truthDefaultTitle: 'Capability boundary',
    truthDefault: 'Import and live generation use the same Scene pipeline. Provider calls are never retried automatically.',
    truthRunningTitle: 'Current stage · {status}',
    truthRunning: 'Keep the same Job. Observation does not add Provider calls.',
    truthCompleteTitle: 'Complete · runtime-bound',
    truthComplete: 'Only the local input or current Job is rendered. No example result is backfilled.',
    truthRecoveryTitle: 'Recovery boundary · no auto-retry',
    truthRecovery: 'Failures, paused observation, stale input, and unknown receipt remain distinct.',
    bindingEmpty: 'No tile source selected',
    bindingReady: 'Current input is ready',
    bindingRunning: 'Current Job binding sealed',
    bindingComplete: 'Current Job and inputs match',
    bindingFailed: 'Current failure receipt retained',
    bindingPaused: 'Same Job retained for resume',
    bindingStale: 'Previous result is stale',
    bindingUnknown: 'No authoritative Job receipt',
    primaryChooseSource: 'Choose a source atlas',
    primaryProcess: 'Import and run quality gate',
    primaryConfirmLive: 'Confirm description and call budget',
    primaryGenerate: 'Generate with {count} confirmed call(s)',
    primaryRunning: 'Scene pipeline running…',
    primaryResume: 'Resume observing this Job',
    primaryReprocess: 'Process current input again',
    primaryRegenerate: 'Confirm a new live generation',
    primaryUnavailable: 'Local service required',
    primaryUnknown: 'Automatic resubmission blocked',
    localPreviewCaption: 'Current-input local preview · not a server artifact',
    currentJobCaption: 'Preview rebuilt from the current Job tileset artifact',
    localResultNote: 'Server completion has not occurred. All downloads remain locked.',
    completeResultNote: 'Only artifacts returned by this verified Job are shown.',
    previewUnavailable: 'The Job completed, but no tileset preview could be rendered.',
    qualityWaiting: 'Waiting',
    qualityEvidenceMissing: 'Quality evidence unavailable',
    recoveryQualityAction: 'Inspect diagnostics; a new run requires an explicit action.',
    recoveryFailedAction: 'Read reason / retry_hint; start a new run explicitly.',
    recoveryPausedAction: 'Resume polling this same Job.',
    recoveryStaleAction: 'Run the current input to create a new Job.',
    recoveryUnknownAction: 'Do not resubmit automatically; reload or use local import.',
    recoveryOutputsLocked: 'Locked',
    sourceProfileError: 'The tile atlas must be exactly 192×192 pixels.',
    sourceTypeError: 'Choose a PNG, WebP, or JPEG tile atlas.',
    sourceSizeError: 'The tile atlas must be 8 MiB or smaller.',
    serviceRequired: 'Start the local service before submitting a Scene Job.',
    unknownError: 'Unknown Scene workflow error',
    qualityBindingError: 'The current Job quality artifact is unavailable or inconsistent; export remains locked.',
    submissionUnknown: 'The live submission receipt was not returned. A Provider call may already have been consumed.',
    jobLabel: 'Job',
    noJob: 'No Job',
    outputLocked: 'export locked',
    outputReady: 'export ready',
    previewEmptyTitle: 'Scene preview · waiting for source tiles',
    previewEmptyCopy: 'Complete Step 1 to render the current dual-grid map preview here.',
    previewEmptyNext: 'Next: import or generate tiles',
    stageNoteDefault: 'Scene is the only target; input, state, preview, and artifacts stay bound to this workflow.',
    stageNoteRunning: 'queued / generating / post_processing share this state; polling recovery never creates a new Job.',
    stageNoteComplete: 'Export is enabled only for a verified done Job whose binding still matches current input.',
    stageNoteRecovery: 'Quality failure, terminal failure, polling pause, stale input, and unknown receipt remain separate.',
  }),
  zh: Object.freeze({
    headerTitle: '场景工坊',
    modeLabel: '图块来源',
    modeLocal: '导入图块',
    modeLive: '生成图块',
    export: '导出资源包',
    languageLabel: '界面语言',
    flowEyebrow: '当前任务',
    stepsLabel: '场景工作流',
    stepSource: '图块源',
    stepQuality: '质检',
    stepPreview: '预览',
    stepExport: '导出',
    localSourceTitle: '双网格图集',
    localSourceChoose: '拖入或选择图块图集',
    localSourceHelp: 'PNG / WebP / JPEG · 192×192 · 最大 8 MB',
    localSourceProfile: '4×4 cells · 48px source cell · 32px runtime tile',
    liveSourceTitle: '在线生成图块源',
    liveDescriptionLabel: '场景描述',
    liveDescriptionPlaceholder: '例如：低饱和苔藓石径、清晰像素块、俯视场景',
    candidateCount: '候选数',
    providerNote: '使用“设置”中的共享 Provider；每个候选恰好一次调用。',
    mapOptionsTitle: '预览参数',
    fieldWidth: '宽度',
    fieldHeight: '高度',
    fieldPattern: '排布',
    fieldSeed: '种子',
    fieldDensity: '密度',
    advancedTitle: '高级 / 实验参数',
    styleSnap: 'Palette snap',
    maxColors: '最大颜色数',
    edgeCondition: 'Edge condition',
    edgeBand: '边缘带',
    edgeMode: '模式',
    rawPolicy: '原始图块策略',
    bindingTitle: '当前绑定',
    canvasLabel: '当前 Scene dual-grid 预览',
    qualityTitle: '质量门禁',
    qualityCoverage: '图块覆盖',
    qualitySeams: '接缝失败',
    qualityWarnings: '警告',
    artifactListLabel: '当前 Scene 产物',
    runningRecovery: '轮询中断只暂停观察，不创建新的 Job。',
    recoveryAction: '恢复动作',
    recoveryOutputs: '已验证下载',
    diagnosticListLabel: '当前 Scene 诊断',
    willTitle: '会做',
    willBody: 'tile ingest · quality gate · dual-grid 预览 · LDtk 单级 · scene_pack.zip',
    wontTitle: '不做（暂）',
    wontBody: '完整地图编辑器 · WFC · 多层 world · 自动图层规则',
    nextTitle: '下一步出口',
    nextBody: '导出后可由“项目”与角色包合成；本模块不会进入项目。',
    shellNoteTitle: '壳说明',
    exportDialogTitle: '当前可用产物',
    exportDialogTruth: '只列出当前已验证 done Job 返回且通过同源路径校验的 URL。',
    exportListLabel: '当前可下载的 Scene 产物',
    close: '关闭',
    download: '下载',
    locked: '锁定',
    unavailable: '不可用',
    noArtifacts: '没有当前产物',
    candidateBinding: '{count} 个候选',
    confirmCalls: '我确认本次最多 {count} 次 Provider 调用',
    phaseEmptyTitle: '从源图块到可导出场景',
    phaseEmptySummary: '图块是场景输入；只有当前结果通过质量门禁后才解锁真实产物。',
    phaseReadyTitle: '当前 Scene 输入已就绪',
    phaseReadySummary: '浏览器预览由所选图集推导，不是服务器产物。',
    phaseRunningTitle: 'Scene 管线运行中',
    phaseRunningSummary: '同一 Job 依次经过 queued、generating 与 post_processing。',
    phaseCompleteTitle: '当前 Scene 包已完成',
    phaseCompleteSummary: '质量证据已通过，每个下载都绑定本次 Job。',
    phaseQualityFailedTitle: '质量门禁阻止已验证下载',
    phaseQualityFailedSummary: '诊断仍可查看，但已验证下载保持锁定。',
    phaseFailedTitle: 'Scene 处理未完成',
    phaseFailedSummary: '读取当前 reason 与 retry_hint；不会自动重试。',
    phasePausedTitle: 'Job 观察已暂停',
    phasePausedSummary: '继续轮询同一 Job，不提交替代任务。',
    phaseStaleTitle: '当前输入与结果不一致',
    phaseStaleSummary: '旧结果只作参考；预览与下载保持锁定。',
    phaseUnknownTitle: '提交回执未知',
    phaseUnknownSummary: '在线调用可能已被接受；自动重新提交已阻断。',
    crumbEmpty: '· 图块源',
    crumbReady: '· 本地预览',
    crumbRunning: '· 运行中',
    crumbComplete: '· 预览与导出',
    crumbRecovery: '· 恢复',
    statusEmpty: '待源图块',
    statusReady: '已就绪',
    statusRunning: '运行中',
    statusComplete: '完成',
    statusQualityFailed: '质检失败',
    statusFailed: '失败',
    statusPaused: '观察暂停',
    statusStale: '已过期',
    statusUnknown: '回执未知',
    pillMain: '主路径',
    pillReady: '本地预览',
    pillRunning: '运行中',
    pillDone: '完成',
    pillRecovery: '恢复',
    stagePreview: '舞台 · 场景预览',
    stageRunning: '舞台 · 管线状态',
    stageResult: '舞台 · 当前结果',
    stageRecovery: '舞台 · 恢复状态',
    stageBoundary: '无完整地图编辑 · 仅 pipeline 预览',
    runtimeWaiting: '等待源图块',
    runtimeLocal: '本地预览 · 0 Provider',
    runtimeRunning: '同一 Job · 不自动重试',
    runtimeComplete: 'done · 可导出',
    runtimeLocked: '下载已锁定',
    truthDefaultTitle: '能力边界',
    truthDefault: '导入与在线生成共用同一 Scene 管线；不会自动重试或追加 Provider 调用。',
    truthRunningTitle: '当前阶段 · {status}',
    truthRunning: '保留同一 Job；观察过程不会追加 Provider 调用。',
    truthCompleteTitle: '完成态 · runtime-bound',
    truthComplete: '只渲染本地输入或当前 Job；不会回填示例结果。',
    truthRecoveryTitle: '恢复边界 · no auto retry',
    truthRecovery: '失败、观察暂停、输入过期与未知回执保持独立。',
    bindingEmpty: '尚未选择源图块',
    bindingReady: '当前输入已就绪',
    bindingRunning: '当前 Job 绑定已封存',
    bindingComplete: '当前 Job 与输入一致',
    bindingFailed: '当前失败回执已保留',
    bindingPaused: '保留同一 Job 以继续观察',
    bindingStale: '旧结果已过期',
    bindingUnknown: '没有权威 Job 回执',
    primaryChooseSource: '选择源图块',
    primaryProcess: '导入并运行质量门禁',
    primaryConfirmLive: '确认描述与调用预算',
    primaryGenerate: '按已确认的 {count} 次调用生成',
    primaryRunning: 'Scene 管线运行中…',
    primaryResume: '继续观察同一 Job',
    primaryReprocess: '按当前输入重新处理',
    primaryRegenerate: '确认一次新的在线生成',
    primaryUnavailable: '需要本地服务',
    primaryUnknown: '已阻断自动重新提交',
    localPreviewCaption: '当前输入的本地预览 · 不是服务器产物',
    currentJobCaption: '由当前 Job 的 tileset 产物重建预览',
    localResultNote: '服务器尚未完成；所有下载保持锁定。',
    completeResultNote: '只显示本次已验证 Job 返回的产物。',
    previewUnavailable: 'Job 已完成，但无法渲染 tileset 预览。',
    qualityWaiting: '等待',
    qualityEvidenceMissing: '质量证据不可用',
    recoveryQualityAction: '检查诊断；新运行必须显式触发。',
    recoveryFailedAction: '读取 reason / retry_hint；显式开始新运行。',
    recoveryPausedAction: '继续轮询同一 Job。',
    recoveryStaleAction: '按当前输入创建新的 Job。',
    recoveryUnknownAction: '不要自动重交；可刷新页面或改用本地导入。',
    recoveryOutputsLocked: '锁定',
    sourceProfileError: '图块图集必须恰好为 192×192 像素。',
    sourceTypeError: '请选择 PNG、WebP 或 JPEG 图块图集。',
    sourceSizeError: '图块图集必须不大于 8 MiB。',
    serviceRequired: '提交 Scene Job 前请先启动本地服务。',
    unknownError: '未知 Scene 工作流错误',
    qualityBindingError: '当前 Job 的质量证据不可用或不一致；导出保持锁定。',
    submissionUnknown: '在线提交未返回回执，Provider 调用可能已经消耗。',
    jobLabel: 'Job',
    noJob: '没有 Job',
    outputLocked: '导出锁定',
    outputReady: '可导出',
    previewEmptyTitle: '场景预览 · 等待源图块',
    previewEmptyCopy: '完成 Step 1 后，这里显示当前 dual-grid 小地图预览。',
    previewEmptyNext: '下一步：导入或生成图块',
    stageNoteDefault: '场景是唯一目标；输入、状态、预览与产物都绑定当前工作流。',
    stageNoteRunning: 'queued / generating / post_processing 共用此状态；轮询恢复不会创建新 Job。',
    stageNoteComplete: '只有已验证 done Job 且绑定仍匹配当前输入时，导出才启用。',
    stageNoteRecovery: '质量失败、执行终态、轮询暂停、输入过期与未知回执保持独立。',
  }),
})

const PHASE_PRESENTATION_KEYS = Object.freeze({
  empty: Object.freeze({ title: 'phaseEmptyTitle', summary: 'phaseEmptySummary', crumb: 'crumbEmpty', status: 'statusEmpty', pill: 'pillMain', stage: 'stagePreview', runtime: 'runtimeWaiting' }),
  ready: Object.freeze({ title: 'phaseReadyTitle', summary: 'phaseReadySummary', crumb: 'crumbReady', status: 'statusReady', pill: 'pillReady', stage: 'stagePreview', runtime: 'runtimeLocal' }),
  running: Object.freeze({ title: 'phaseRunningTitle', summary: 'phaseRunningSummary', crumb: 'crumbRunning', status: 'statusRunning', pill: 'pillRunning', stage: 'stageRunning', runtime: 'runtimeRunning' }),
  complete: Object.freeze({ title: 'phaseCompleteTitle', summary: 'phaseCompleteSummary', crumb: 'crumbComplete', status: 'statusComplete', pill: 'pillDone', stage: 'stageResult', runtime: 'runtimeComplete' }),
  quality_failed: Object.freeze({ title: 'phaseQualityFailedTitle', summary: 'phaseQualityFailedSummary', crumb: 'crumbRecovery', status: 'statusQualityFailed', pill: 'pillRecovery', stage: 'stageRecovery', runtime: 'runtimeLocked' }),
  failed: Object.freeze({ title: 'phaseFailedTitle', summary: 'phaseFailedSummary', crumb: 'crumbRecovery', status: 'statusFailed', pill: 'pillRecovery', stage: 'stageRecovery', runtime: 'runtimeLocked' }),
  poll_paused: Object.freeze({ title: 'phasePausedTitle', summary: 'phasePausedSummary', crumb: 'crumbRecovery', status: 'statusPaused', pill: 'pillRecovery', stage: 'stageRecovery', runtime: 'runtimeLocked' }),
  stale: Object.freeze({ title: 'phaseStaleTitle', summary: 'phaseStaleSummary', crumb: 'crumbRecovery', status: 'statusStale', pill: 'pillRecovery', stage: 'stageRecovery', runtime: 'runtimeLocked' }),
  submission_unknown: Object.freeze({ title: 'phaseUnknownTitle', summary: 'phaseUnknownSummary', crumb: 'crumbRecovery', status: 'statusUnknown', pill: 'pillRecovery', stage: 'stageRecovery', runtime: 'runtimeLocked' }),
})

let initialized = false
let sceneState = null
let operationEpoch = 0

function byId(id) {
  return document.getElementById(id)
}

function setText(id, value) {
  const node = byId(id)
  if (node) node.textContent = String(value ?? '')
}

function languageCode() {
  return getCurrentLanguage() === 'en' ? 'en' : 'zh'
}

function sceneT(key, replacements = {}, language = languageCode()) {
  let result = SCENE_COPY[language]?.[key] ?? SCENE_COPY.en[key] ?? key
  for (const [name, value] of Object.entries(replacements)) result = result.replaceAll(`{${name}}`, String(value ?? ''))
  return result
}

function renderStaticCopy(root) {
  if (!root) return
  root.querySelectorAll('[data-scene-copy]').forEach((node) => {
    node.textContent = sceneT(node.dataset.sceneCopy)
  })
  root.querySelectorAll('[data-scene-copy-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', sceneT(node.dataset.sceneCopyPlaceholder))
  })
  root.querySelectorAll('[data-scene-copy-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', sceneT(node.dataset.sceneCopyAriaLabel))
  })
}

export function sceneOptionsKey(options = normalizeSceneOptions()) {
  return JSON.stringify(options)
}

export function createInitialSceneState({ serviceAvailable = true } = {}) {
  const options = normalizeSceneOptions()
  return {
    serviceAvailable: Boolean(serviceAvailable),
    mode: 'local',
    phase: 'empty',
    busy: null,
    controller: null,
    options,
    optionsValid: true,
    optionsKey: sceneOptionsKey(options),
    sourceFile: null,
    sourceRgba: null,
    sourceEpoch: 0,
    description: '',
    candidateCount: 1,
    liveConfirmed: false,
    lockedUnknownSubmission: false,
    binding: null,
    job: null,
    resultJob: null,
    resultVerified: false,
    previewBundle: null,
    previewKind: null,
    previewError: null,
    qualityGate: null,
    error: null,
    pollPaused: false,
  }
}

function normalizedPhase(phase) {
  return PHASE_SET.has(phase) ? phase : 'empty'
}

function currentInputKey(state) {
  return JSON.stringify(state.mode === 'local'
    ? { mode: 'local', sourceEpoch: state.sourceEpoch, optionsKey: state.optionsKey }
    : {
        mode: 'live',
        description: String(state.description).trim(),
        candidateCount: state.candidateCount,
        optionsKey: state.optionsKey,
      })
}

export function sceneResultIsCurrent(state = sceneState) {
  return Boolean(
    state?.phase === 'complete' &&
    state?.optionsValid !== false &&
    state?.resultVerified &&
    state?.resultJob?.status === 'done' &&
    state?.binding?.jobId === state.resultJob.id &&
    state?.binding?.inputKey === currentInputKey(state),
  )
}

export function getStudioSceneProjectCandidate() {
  if (!sceneResultIsCurrent(sceneState)) return null
  return Object.freeze({
    kind: 'scene',
    jobId: sceneState.resultJob.id,
    status: sceneState.resultJob.status,
    profile: sceneState.qualityGate?.profile ?? null,
    zipUrl: sceneState.resultJob.scene_pack_zip_url ?? sceneState.resultJob.zip_url ?? null,
  })
}

function liveInputReady(state) {
  return Boolean(String(state.description ?? '').trim())
}

export function deriveScenePresentation(state = createInitialSceneState()) {
  const phase = normalizedPhase(state.phase)
  let action = 'blocked'
  if (state.serviceAvailable && state.optionsValid !== false && state.busy === null) {
    if (phase === 'poll_paused' && state.job) action = 'resume'
    else if (phase !== 'running' && phase !== 'submission_unknown') {
      if (state.mode === 'local' && state.sourceFile) action = 'process'
      else if (state.mode === 'live' && liveInputReady(state) && state.liveConfirmed) action = 'generate'
    }
  }
  return Object.freeze({ phase, action, busy: state.busy !== null, mode: state.mode })
}

function sourceForLocalPipeline(source, options) {
  const corrected = options.styleSnap
    ? applyPixelStyleCorrection(source, { mode: 'palette_snap', maxColors: options.styleMaxColors })
    : null
  const beforeEdge = corrected?.image ?? source
  const conditioned = options.edgeCondition
    ? conditionTileSheetEdges(beforeEdge, { enabled: true, band: options.edgeBand, mode: options.edgeConditionMode })
    : null
  return {
    source: conditioned?.source ?? beforeEdge,
    styleCorrectionReport: corrected?.report,
    edgeConditioningReport: conditioned?.report,
  }
}

export function buildSceneLocalPreview(source, options = normalizeSceneOptions()) {
  const prepared = sourceForLocalPipeline(source, options)
  return buildScenePackFromTileSheet({
    source: prepared.source,
    projectId: options.projectId,
    identifier: options.identifier,
    width: options.width,
    height: options.height,
    pattern: options.pattern,
    seed: options.seed,
    density: options.density,
    tilesetRelPath: options.tilesetRelPath,
    rawTilePolicy: options.rawTilePolicy,
    styleCorrectionReport: prepared.styleCorrectionReport,
    edgeConditioningReport: prepared.edgeConditioningReport,
  })
}

function readOptions() {
  return normalizeSceneOptions({
    width: byId('studio-scene-width')?.value,
    height: byId('studio-scene-height')?.value,
    pattern: byId('studio-scene-pattern')?.value,
    seed: byId('studio-scene-seed')?.value,
    density: byId('studio-scene-density')?.value,
    styleSnap: byId('studio-scene-style-snap')?.checked,
    styleMaxColors: byId('studio-scene-style-max-colors')?.value,
    edgeCondition: byId('studio-scene-edge-condition')?.checked,
    edgeBand: byId('studio-scene-edge-band')?.value,
    edgeConditionMode: byId('studio-scene-edge-mode')?.value,
    rawTilePolicy: byId('studio-scene-raw-policy')?.value,
  })
}

function decodeImageSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : null
    const timer = globalThis.setTimeout(() => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      reject(new Error('scene image decode timed out'))
    }, 15_000)
    image.onload = () => {
      clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, canvas.width, canvas.height)
      resolve({ width: canvas.width, height: canvas.height, data: data.data })
    }
    image.onerror = () => {
      clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      reject(new Error('scene image could not be decoded'))
    }
    image.src = objectUrl ?? String(source)
  })
}

function drawBundle(bundle) {
  const canvas = byId('studio-scene-canvas')
  if (!canvas || !bundle?.map || !bundle?.tiles) return false
  const tileSize = 32
  canvas.width = bundle.map.width * tileSize
  canvas.height = bundle.map.height * tileSize
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = false
  context.fillStyle = '#0b0e13'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const tileCanvases = new Map()
  for (const cell of bundle.map.cells) {
    const tile = bundle.tiles[cell.mask]
    if (!tile) return false
    let tileCanvas = tileCanvases.get(cell.mask)
    if (!tileCanvas) {
      tileCanvas = document.createElement('canvas')
      tileCanvas.width = tile.width
      tileCanvas.height = tile.height
      tileCanvas.getContext('2d').putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0)
      tileCanvases.set(cell.mask, tileCanvas)
    }
    context.drawImage(tileCanvas, cell.x * tileSize, cell.y * tileSize, tileSize, tileSize)
    context.strokeStyle = 'rgba(255,255,255,.08)'
    context.strokeRect(cell.x * tileSize + .5, cell.y * tileSize + .5, tileSize - 1, tileSize - 1)
  }
  return true
}

function taxonomyCount(qualityGate, fragment) {
  return (qualityGate?.failure_taxonomy ?? [])
    .filter((item) => String(item?.category ?? '').includes(fragment))
    .reduce((sum, item) => sum + Number(item?.count ?? 0), 0)
}

function renderQuality(state) {
  const gate = state.qualityGate ?? state.previewBundle?.qualityGate ?? null
  const status = String(gate?.status ?? (state.phase === 'complete' ? 'pass' : sceneT('qualityWaiting')))
  const statusNode = byId('studio-scene-quality-status')
  if (statusNode) {
    statusNode.textContent = status
    statusNode.dataset.state = ['pass', 'warning', 'fail'].includes(status) ? status : 'waiting'
  }
  const observed = Number(gate?.metrics?.metadata_seams?.observed?.tile_count)
  const expected = Number(state.previewBundle?.metrics?.tile_count)
  const hasObserved = Number.isFinite(observed)
  const hasExpected = Number.isFinite(expected)
  setText('studio-scene-quality-coverage', hasObserved && hasExpected ? `${observed}/${expected}` : hasExpected ? `${expected}/${expected}` : '—')
  setText('studio-scene-quality-seams', gate ? taxonomyCount(gate, 'seam') : '—')
  setText('studio-scene-quality-warnings', Array.isArray(gate?.warnings) ? gate.warnings.length : '—')
}

function renderArtifactLinks(containerId, rows) {
  const container = byId(containerId)
  if (!container) return
  container.replaceChildren()
  if (!rows.length) {
    const empty = document.createElement('span')
    empty.className = 'scene-artifact-empty'
    empty.textContent = sceneT('noArtifacts')
    container.append(empty)
    return
  }
  for (const row of rows) {
    const link = document.createElement('a')
    link.href = row.url
    link.target = '_blank'
    link.rel = 'noreferrer'
    link.download = row.file
    const name = document.createElement('span')
    name.textContent = row.file
    const action = document.createElement('b')
    action.textContent = sceneT('download')
    link.append(name, action)
    container.append(link)
  }
}

function releaseRows(state) {
  if (!sceneResultIsCurrent(state)) return []
  try {
    return releaseSceneArtifacts(state.resultJob)
  } catch {
    return []
  }
}

function diagnosticRows(state) {
  if (!state.job) return []
  try {
    return diagnosticSceneArtifacts(state.job)
  } catch {
    return []
  }
}

function phasePanels(phase) {
  document.querySelectorAll('[data-scene-panel]').forEach((panel) => {
    panel.hidden = !panel.dataset.scenePanel.split(/\s+/).includes(phase)
  })
}

function setSteps(state) {
  const status = state.job?.status
  const active = state.phase === 'complete' ? 'export'
    : state.phase === 'ready' ? 'preview'
      : state.phase === 'running' && status === 'post_processing' ? 'quality'
        : ['quality_failed', 'failed', 'poll_paused', 'stale', 'submission_unknown'].includes(state.phase) ? 'quality'
          : 'source'
  const order = ['source', 'quality', 'preview', 'export']
  const activeIndex = order.indexOf(active)
  document.querySelectorAll('[data-scene-step]').forEach((item) => {
    const index = order.indexOf(item.dataset.sceneStep)
    item.classList.toggle('is-current', index === activeIndex)
    item.classList.toggle('is-complete', index < activeIndex || state.phase === 'complete')
  })
}

function primaryLabel(state, presentation) {
  if (!state.serviceAvailable) return sceneT('primaryUnavailable')
  if (state.busy !== null || state.phase === 'running') return sceneT('primaryRunning')
  if (state.phase === 'submission_unknown') return sceneT('primaryUnknown')
  if (presentation.action === 'resume') return sceneT('primaryResume')
  if (state.mode === 'local') {
    if (!state.sourceFile) return sceneT('primaryChooseSource')
    return state.job || state.resultJob ? sceneT('primaryReprocess') : sceneT('primaryProcess')
  }
  if (!liveInputReady(state) || !state.liveConfirmed) return sceneT('primaryConfirmLive')
  return state.job || state.resultJob
    ? sceneT('primaryRegenerate')
    : sceneT('primaryGenerate', { count: state.candidateCount })
}

function errorText(error) {
  if (!error) return ''
  const known = {
    source_profile_invalid: 'sourceProfileError',
    source_type_invalid: 'sourceTypeError',
    source_too_large: 'sourceSizeError',
    service_required: 'serviceRequired',
    quality_binding_mismatch: 'qualityBindingError',
    submission_unknown: 'submissionUnknown',
  }
  if (known[error.code]) return sceneT(known[error.code])
  return String(error.message || error || sceneT('unknownError'))
}

function bindingCopy(state) {
  const phase = state.phase
  const titleKey = phase === 'empty' ? 'bindingEmpty'
    : phase === 'ready' ? 'bindingReady'
      : phase === 'running' ? 'bindingRunning'
        : phase === 'complete' ? 'bindingComplete'
          : phase === 'poll_paused' ? 'bindingPaused'
            : phase === 'stale' ? 'bindingStale'
              : phase === 'submission_unknown' ? 'bindingUnknown'
                : 'bindingFailed'
  const source = state.mode === 'local'
    ? (state.sourceFile?.name ?? '—')
    : sceneT('candidateBinding', { count: state.candidateCount })
  const job = state.job?.id ?? state.resultJob?.id ?? '—'
  const output = sceneResultIsCurrent(state) ? sceneT('outputReady') : sceneT('outputLocked')
  return {
    title: sceneT(titleKey),
    detail: `${state.options.width}×${state.options.height} · ${state.options.pattern} · seed ${state.options.seed}\n${source} · ${sceneT('jobLabel')} ${job} · ${output}`,
  }
}

function recoveryCopy(state) {
  if (state.phase === 'quality_failed') return sceneT('recoveryQualityAction')
  if (state.phase === 'poll_paused') return sceneT('recoveryPausedAction')
  if (state.phase === 'stale') return sceneT('recoveryStaleAction')
  if (state.phase === 'submission_unknown') return sceneT('recoveryUnknownAction')
  return sceneT('recoveryFailedAction')
}

function renderDynamicState(state) {
  const root = byId('studio-scene-view')
  if (!root) return
  const phase = normalizedPhase(state.phase)
  const keys = PHASE_PRESENTATION_KEYS[phase]
  root.dataset.scenePhase = phase
  root.dataset.sceneMode = state.mode
  setText('studio-scene-phase-title', sceneT(keys.title))
  setText('studio-scene-phase-summary', sceneT(keys.summary))
  setText('studio-scene-header-crumb', sceneT(keys.crumb))
  setText('studio-scene-status', state.phase === 'running' && state.job?.status ? state.job.status : sceneT(keys.status))
  setText('studio-scene-phase-pill', sceneT(keys.pill))
  setText('studio-scene-stage-title', sceneT(keys.stage))
  setText('studio-scene-stage-metrics', state.previewBundle ? `${state.options.width}×${state.options.height} · ${state.options.pattern}` : sceneT('stageBoundary'))
  setText('studio-scene-runtime-status', sceneT(keys.runtime))
  setText('studio-scene-empty-title', sceneT('previewEmptyTitle'))
  setText('studio-scene-empty-copy', sceneT('previewEmptyCopy'))
  setText('studio-scene-empty-next', sceneT('previewEmptyNext'))

  const statusNode = byId('studio-scene-status')
  if (statusNode) {
    statusNode.dataset.state = phase === 'complete' ? 'ready'
      : ['quality_failed', 'failed', 'submission_unknown'].includes(phase) ? 'error'
        : phase === 'running' ? 'loading'
          : 'idle'
    statusNode.setAttribute('aria-busy', String(state.busy !== null))
  }

  const truthTitle = phase === 'running' ? sceneT('truthRunningTitle', { status: state.job?.status ?? 'submitting' })
    : phase === 'complete' ? sceneT('truthCompleteTitle')
      : ['quality_failed', 'failed', 'poll_paused', 'stale', 'submission_unknown'].includes(phase) ? sceneT('truthRecoveryTitle')
        : sceneT('truthDefaultTitle')
  const truthCopy = phase === 'running' ? sceneT('truthRunning')
    : phase === 'complete' ? sceneT('truthComplete')
      : ['quality_failed', 'failed', 'poll_paused', 'stale', 'submission_unknown'].includes(phase) ? sceneT('truthRecovery')
        : sceneT('truthDefault')
  setText('studio-scene-truth-title', truthTitle)
  setText('studio-scene-truth-copy', truthCopy)

  const note = phase === 'running' ? sceneT('stageNoteRunning')
    : phase === 'complete' ? sceneT('stageNoteComplete')
      : ['quality_failed', 'failed', 'poll_paused', 'stale', 'submission_unknown'].includes(phase) ? sceneT('stageNoteRecovery')
        : sceneT('stageNoteDefault')
  setText('studio-scene-stage-note', note)
  phasePanels(phase)
  setSteps(state)
}

function renderControls(state) {
  const presentation = deriveScenePresentation(state)
  document.querySelectorAll('[data-scene-mode-control]').forEach((button) => {
    const active = button.dataset.sceneModeControl === state.mode
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
    button.disabled = !state.serviceAvailable || state.busy !== null || ['running', 'poll_paused'].includes(state.phase)
  })
  document.querySelectorAll('[data-scene-mode-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.sceneModePanel !== state.mode
  })
  const inputsLocked = !state.serviceAvailable || state.busy !== null || ['running', 'poll_paused'].includes(state.phase)
  document.querySelectorAll('[data-scene-option], #studio-scene-source-file, #studio-scene-description, #studio-scene-candidates, #studio-scene-live-confirm').forEach((control) => {
    control.disabled = inputsLocked
  })
  const picker = byId('studio-scene-file-picker')
  if (picker) {
    picker.classList.toggle('is-disabled', inputsLocked)
    picker.setAttribute('aria-disabled', String(inputsLocked))
  }
  const primary = byId('studio-scene-primary')
  if (primary) {
    primary.textContent = primaryLabel(state, presentation)
    primary.disabled = presentation.action === 'blocked'
    primary.dataset.pending = String(state.busy !== null)
  }
  const exportButton = byId('studio-scene-export')
  const rows = releaseRows(state)
  if (exportButton) exportButton.disabled = rows.length === 0
  const dialog = byId('studio-scene-export-dialog')
  if (!rows.length && dialog?.open) dialog.close()

  const sourceName = state.sourceFile?.name ?? sceneT('localSourceChoose')
  setText('studio-scene-source-name', sourceName)
  setText('studio-scene-source-meta', state.sourceFile
    ? `${state.sourceFile.type || 'image'} · ${state.sourceFile.size ?? '—'} bytes · 192×192`
    : sceneT('localSourceProfile'))
  setText('studio-scene-live-confirm-copy', sceneT('confirmCalls', { count: state.candidateCount }))
  setText('studio-scene-density-value', Number(state.options.density).toFixed(2))
  const binding = bindingCopy(state)
  setText('studio-scene-binding-state', binding.title)
  setText('studio-scene-binding-detail', binding.detail)
  const error = byId('studio-scene-error')
  if (error) {
    error.hidden = !state.error
    error.textContent = errorText(state.error)
  }
}

function renderStage(state) {
  const rows = releaseRows(state)
  const diagnostics = diagnosticRows(state)
  renderArtifactLinks('studio-scene-artifacts', rows)
  renderArtifactLinks('studio-scene-export-list', rows)
  renderArtifactLinks('studio-scene-diagnostics', diagnostics)
  renderQuality(state)
  if (['ready', 'complete'].includes(state.phase)) {
    const rendered = state.previewBundle ? drawBundle(state.previewBundle) : false
    setText('studio-scene-canvas-caption', state.phase === 'complete'
      ? (rendered ? sceneT('currentJobCaption') : sceneT('previewUnavailable'))
      : sceneT('localPreviewCaption'))
  }
  setText('studio-scene-result-note', state.phase === 'complete' ? sceneT('completeResultNote') : sceneT('localResultNote'))
  setText('studio-scene-running-copy', sceneT('phaseRunningSummary'))
  setText('studio-scene-running-job', `${sceneT('jobLabel')} ${state.job?.id ?? '—'} · ${state.job?.status ?? 'submitting'}`)
  setText('studio-scene-recovery-status', state.job?.status ?? state.phase)
  setText('studio-scene-recovery-title', sceneT(PHASE_PRESENTATION_KEYS[state.phase]?.title ?? 'phaseFailedTitle'))
  const reason = state.job?.reason ?? state.error?.message ?? errorText(state.error) ?? sceneT('unknownError')
  const retry = state.job?.retry_hint ? `\nretry_hint: ${state.job.retry_hint}` : ''
  setText('studio-scene-recovery-reason', `${reason || sceneT('unknownError')}${retry}`)
  setText('studio-scene-recovery-job', state.job?.id ?? sceneT('noJob'))
  setText('studio-scene-recovery-action', recoveryCopy(state))
  setText('studio-scene-recovery-outputs', sceneT('recoveryOutputsLocked'))
}

function renderLanguageButtons() {
  const language = languageCode()
  document.querySelectorAll('[data-scene-language]').forEach((button) => {
    const current = button.dataset.sceneLanguage === language
    button.classList.toggle('is-current', current)
    button.setAttribute('aria-pressed', String(current))
  })
}

export function renderStudioScene(state = sceneState) {
  if (!state) return null
  const root = byId('studio-scene-view')
  if (!root) return state
  renderStaticCopy(root)
  renderLanguageButtons()
  renderDynamicState(state)
  renderControls(state)
  renderStage(state)
  return state
}

function beginOperation(state) {
  state.controller?.abort()
  state.controller = new AbortController()
  operationEpoch += 1
  return { epoch: operationEpoch, signal: state.controller.signal }
}

function operationIsCurrent(epoch) {
  return epoch === operationEpoch
}

function setCodedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function resetLiveConfirmation(state) {
  state.liveConfirmed = false
  const confirm = byId('studio-scene-live-confirm')
  if (confirm) confirm.checked = false
}

function markInputChanged(state) {
  state.resultVerified = false
  resetLiveConfirmation(state)
  if (!state.optionsValid) {
    state.phase = 'failed'
    return
  }
  if (state.mode === 'live' && state.lockedUnknownSubmission) state.phase = 'submission_unknown'
  else if (state.resultJob) state.phase = 'stale'
  else state.phase = state.mode === 'local' ? (state.sourceFile ? 'ready' : 'empty') : (liveInputReady(state) ? 'ready' : 'empty')
  state.error = null
}

async function selectSourceFile(file) {
  const state = sceneState
  if (!state || state.busy || !state.serviceAvailable) return
  if (!file) return
  state.resultVerified = false
  resetLiveConfirmation(state)
  const type = String(file.type ?? '').toLowerCase()
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(type) && !/\.(?:png|webp|jpe?g)$/i.test(file.name ?? '')) {
    state.error = setCodedError('source_type_invalid', sceneT('sourceTypeError'))
    state.phase = 'failed'
    renderStudioScene(state)
    return
  }
  if (Number(file.size) > SCENE_SOURCE_MAX_BYTES) {
    state.error = setCodedError('source_too_large', sceneT('sourceSizeError'))
    state.phase = 'failed'
    renderStudioScene(state)
    return
  }
  state.busy = 'source_decode'
  renderStudioScene(state)
  try {
    const source = await decodeImageSource(file)
    if (source.width !== 192 || source.height !== 192) {
      throw setCodedError('source_profile_invalid', sceneT('sourceProfileError'))
    }
    state.sourceFile = file
    state.sourceRgba = source
    state.sourceEpoch += 1
    state.previewBundle = buildSceneLocalPreview(source, state.options)
    state.previewKind = 'local'
    state.previewError = null
    state.qualityGate = state.previewBundle.qualityGate
    markInputChanged(state)
  } catch (error) {
    state.error = error
    state.phase = 'failed'
  } finally {
    state.busy = null
    renderStudioScene(state)
  }
}

function commitOptions() {
  const state = sceneState
  if (!state || state.busy) return
  state.optionsValid = false
  state.resultVerified = false
  resetLiveConfirmation(state)
  try {
    state.options = readOptions()
    state.optionsKey = sceneOptionsKey(state.options)
    state.optionsValid = true
    if (state.sourceRgba) {
      state.previewBundle = buildSceneLocalPreview(state.sourceRgba, state.options)
      state.previewKind = 'local'
      state.qualityGate = state.previewBundle.qualityGate
      state.previewError = null
    }
    markInputChanged(state)
  } catch (error) {
    state.error = error
    state.phase = 'failed'
  }
  renderStudioScene(state)
}

function switchMode(mode) {
  const state = sceneState
  if (!state || !state.serviceAvailable || state.busy || !['local', 'live'].includes(mode) || state.mode === mode) return
  state.mode = mode
  state.resultVerified = false
  resetLiveConfirmation(state)
  if (!state.optionsValid) {
    state.phase = 'failed'
    renderStudioScene(state)
    return
  }
  state.error = null
  if (mode === 'local') {
    state.phase = state.resultJob ? 'stale' : state.sourceFile ? 'ready' : 'empty'
  } else if (state.lockedUnknownSubmission) {
    state.phase = 'submission_unknown'
  } else {
    state.phase = state.resultJob ? 'stale' : liveInputReady(state) ? 'ready' : 'empty'
  }
  renderStudioScene(state)
}

async function loadJobPreview(job, options) {
  if (!job?.tileset_url) return null
  const source = await decodeImageSource(job.tileset_url)
  if (source.width !== 192 || source.height !== 192) throw setCodedError('source_profile_invalid', sceneT('sourceProfileError'))
  return buildScenePackFromTileSheet({
    source,
    projectId: options.projectId,
    identifier: options.identifier,
    width: options.width,
    height: options.height,
    pattern: options.pattern,
    seed: options.seed,
    density: options.density,
    tilesetRelPath: options.tilesetRelPath,
    rawTilePolicy: options.rawTilePolicy,
  })
}

async function acceptTerminalJob(state, terminal, { epoch, signal }) {
  state.job = terminal
  state.pollPaused = false
  state.busy = null
  if (terminal.status === 'failed_quality_gate') {
    state.phase = 'quality_failed'
    state.resultJob = null
    state.resultVerified = false
    state.error = setCodedError('failed_quality_gate', terminal.reason || 'failed_quality_gate')
    try {
      state.qualityGate = terminal.quality_gate_url
        ? await fetchSceneJsonArtifact(terminal.quality_gate_url, { signal })
        : null
    } catch {}
    if (operationIsCurrent(epoch)) renderStudioScene(state)
    return
  }
  if (terminal.status !== 'done') {
    state.phase = 'failed'
    state.resultJob = null
    state.resultVerified = false
    state.error = setCodedError(terminal.status, terminal.reason || terminal.status)
    renderStudioScene(state)
    return
  }

  state.resultJob = terminal
  state.phase = 'running'
  state.busy = 'verify_evidence'
  renderStudioScene(state)
  try {
    const qualityGate = await fetchSceneJsonArtifact(terminal.quality_gate_url, { signal })
    if (!qualityGate || !['pass', 'warning'].includes(qualityGate.status)) {
      throw setCodedError('quality_binding_mismatch', sceneT('qualityBindingError'))
    }
    state.qualityGate = qualityGate
    state.resultVerified = true
  } catch (error) {
    if (!operationIsCurrent(epoch)) return
    state.resultVerified = false
    state.phase = 'failed'
    state.error = error?.code ? error : setCodedError('quality_binding_mismatch', sceneT('qualityBindingError'))
    state.busy = null
    renderStudioScene(state)
    return
  }

  try {
    state.previewBundle = await loadJobPreview(terminal, state.options)
    state.previewKind = 'job'
    state.previewError = state.previewBundle ? null : setCodedError('preview_unavailable', sceneT('previewUnavailable'))
  } catch (error) {
    state.previewBundle = null
    state.previewKind = null
    state.previewError = error
  }
  if (!operationIsCurrent(epoch)) return
  state.phase = 'complete'
  state.error = null
  state.busy = null
  renderStudioScene(state)
}

async function observeSceneJob(initialJob, operation) {
  const state = sceneState
  if (!state) return
  state.job = initialJob
  state.phase = 'running'
  state.busy = 'poll'
  state.pollPaused = false
  renderStudioScene(state)
  try {
    const terminal = await pollSceneJob(initialJob, {
      expectedMode: state.mode,
      signal: operation.signal,
      onUpdate(job) {
        if (!operationIsCurrent(operation.epoch)) return
        state.job = job
        renderStudioScene(state)
      },
    })
    if (!operationIsCurrent(operation.epoch)) return
    await acceptTerminalJob(state, terminal, operation)
  } catch (error) {
    if (!operationIsCurrent(operation.epoch) || error?.name === 'AbortError') return
    state.busy = null
    if (error?.code === 'poll_interrupted' && error?.payload?.job) {
      state.job = error.payload.job
      state.pollPaused = true
      state.phase = 'poll_paused'
    } else {
      state.phase = 'failed'
    }
    state.error = error
    renderStudioScene(state)
  } finally {
    if (operationIsCurrent(operation.epoch)) state.controller = null
  }
}

async function submitSceneJob() {
  const state = sceneState
  if (!state) return
  const presentation = deriveScenePresentation(state)
  if (!['process', 'generate'].includes(presentation.action)) return
  const operation = beginOperation(state)
  const inputKey = currentInputKey(state)
  const confirmedLiveSubmission = state.liveConfirmed
  if (state.mode === 'live') resetLiveConfirmation(state)
  state.busy = 'submit'
  state.phase = 'running'
  state.job = null
  state.resultJob = null
  state.resultVerified = false
  state.error = null
  state.pollPaused = false
  state.binding = { inputKey, jobId: null, mode: state.mode }
  renderStudioScene(state)
  try {
    const initial = state.mode === 'local'
      ? await postSceneImport({ file: state.sourceFile, options: state.options, signal: operation.signal })
      : await postSceneGeneration({
          description: state.description,
          candidateCount: state.candidateCount,
          confirmed: confirmedLiveSubmission,
          options: state.options,
          signal: operation.signal,
        })
    if (!operationIsCurrent(operation.epoch)) return
    state.job = initial
    state.binding = { ...state.binding, jobId: initial.id }
    state.busy = null
    await observeSceneJob(initial, operation)
  } catch (error) {
    if (!operationIsCurrent(operation.epoch) || error?.name === 'AbortError') return
    state.busy = null
    if (state.mode === 'live' && !sceneSubmissionIsDefiniteRejection(error)) {
      state.lockedUnknownSubmission = true
      state.phase = 'submission_unknown'
      state.error = setCodedError('submission_unknown', sceneT('submissionUnknown'))
    } else {
      state.phase = 'failed'
      state.error = error
    }
    state.controller = null
    renderStudioScene(state)
  }
}

async function resumeSceneJob() {
  const state = sceneState
  if (!state?.job || state.busy) return
  const operation = beginOperation(state)
  await observeSceneJob(state.job, operation)
}

function bindEvents() {
  document.querySelectorAll('[data-scene-mode-control]').forEach((button) => {
    button.addEventListener('click', () => switchMode(button.dataset.sceneModeControl))
  })
  document.querySelectorAll('[data-scene-language]').forEach((button) => {
    button.addEventListener('click', () => {
      setCurrentLanguage(button.dataset.sceneLanguage)
      const select = byId('language-select')
      if (select) {
        select.value = button.dataset.sceneLanguage
        select.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        translateStudioDocument(document, button.dataset.sceneLanguage)
        renderStudioSceneLanguage()
      }
    })
  })
  const fileInput = byId('studio-scene-source-file')
  fileInput?.addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ''
    void selectSourceFile(file)
  })
  const picker = byId('studio-scene-file-picker')
  picker?.addEventListener('dragover', (event) => event.preventDefault())
  picker?.addEventListener('drop', (event) => {
    event.preventDefault()
    void selectSourceFile(event.dataTransfer?.files?.[0] ?? null)
  })
  document.querySelectorAll('[data-scene-option]').forEach((control) => {
    control.addEventListener(control.type === 'range' ? 'input' : 'change', commitOptions)
  })
  byId('studio-scene-description')?.addEventListener('input', (event) => {
    if (!sceneState || sceneState.busy) return
    sceneState.description = event.currentTarget.value
    markInputChanged(sceneState)
    renderStudioScene(sceneState)
  })
  byId('studio-scene-candidates')?.addEventListener('change', (event) => {
    if (!sceneState || sceneState.busy) return
    const count = Math.max(1, Math.min(SCENE_MAX_CANDIDATES, Math.trunc(Number(event.currentTarget.value) || 1)))
    event.currentTarget.value = String(count)
    sceneState.candidateCount = count
    markInputChanged(sceneState)
    renderStudioScene(sceneState)
  })
  byId('studio-scene-live-confirm')?.addEventListener('change', (event) => {
    if (!sceneState) return
    sceneState.liveConfirmed = event.currentTarget.checked
    renderStudioScene(sceneState)
  })
  byId('studio-scene-primary')?.addEventListener('click', () => {
    const action = deriveScenePresentation(sceneState).action
    if (action === 'resume') void resumeSceneJob()
    else if (action === 'process' || action === 'generate') void submitSceneJob()
  })
  byId('studio-scene-export')?.addEventListener('click', () => {
    const dialog = byId('studio-scene-export-dialog')
    if (!releaseRows(sceneState).length || !dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  })
}

export function renderStudioSceneLanguage() {
  if (!sceneState) return null
  return renderStudioScene(sceneState)
}

export function initStudioScene({ serviceAvailable = true } = {}) {
  if (initialized) return sceneState
  const root = byId('studio-scene-view')
  if (!root) return null
  initialized = true
  sceneState = createInitialSceneState({ serviceAvailable })
  sceneState.description = byId('studio-scene-description')?.value ?? ''
  sceneState.candidateCount = Number(byId('studio-scene-candidates')?.value ?? 1)
  bindEvents()
  renderStudioScene(sceneState)
  if (!serviceAvailable) {
    sceneState.error = setCodedError('service_required', sceneT('serviceRequired'))
    renderStudioScene(sceneState)
  }
  return sceneState
}
