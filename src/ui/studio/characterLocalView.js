import { getAnimationNameForIntent, getMovementIntent, movePreviewActor } from '../../character-pack/playablePreview.js'
import { getCurrentLanguage } from '../i18n.js'
import {
  buildLocalCharacterOptions,
  fetchLocalCharacterFailureReport,
  isRecoverableLocalCharacterObservationError,
  pollLocalCharacterJob,
  submitAdvancedLocalCharacterJob,
  submitLocalCharacterJob,
  validateLocalCharacterFile,
  verifyLocalCharacterResult,
} from './characterLocalApi.js'
import {
  addAdvancedCutLine,
  advancedLocalInputFingerprint,
  bindAdvancedBlackMatteSettings,
  buildAdvancedLocalCharacterOptions,
  canCommitAdvancedBlackMatteSelection,
  createAdvancedLocalSettings,
  invalidateAdvancedLocalResultState,
  makeEvenAdvancedCutLines,
  moveAdvancedCutLine,
  validateAdvancedLocalSourceFile,
} from './characterAdvancedLocal.js'
import {
  calibrateFixedRegionTemplateImage,
  stageTemplateCalibrationSource,
  TEMPLATE_CALIBRATION_STAGE_SIZE,
} from '../characterPack/templateCalibrationCore.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../character-pack/sourceLayoutIds.js'

const MOVEMENT_KEYS = new Set([
  'w', 'a', 's', 'd', 'W', 'A', 'S', 'D',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
])

const EXPORT_LINKS = Object.freeze([
  ['character-local-export-pack', 'zip_url'],
  ['character-local-export-godot', 'godot_npc_zip_url'],
  ['character-local-export-rpgmaker', 'rpgmaker_zip_url'],
  ['character-local-export-ocad', 'ocad_zip_url'],
])

const LOCAL_COPY = Object.freeze({
  en: Object.freeze({
    crumb: '· Local import',
    statusEmpty: 'Waiting for source',
    statusReady: 'Source ready',
    statusRunning: 'Local processing',
    statusPaused: 'Observation paused',
    statusUnknown: 'Submission outcome unknown',
    statusFailed: 'Quality blocked',
    statusComplete: 'Quality passed · export ready',
    exportLocked: 'Process before export',
    exportReady: 'Export',
    flowEyebrow: 'Current flow',
    flowTitle: 'Local sprite-sheet import',
    flowSummary: 'Upload one PNG or WebP sheet and run the maintained local quality pipeline.',
    sourceTitle: 'Sprite sheet',
    sourceHint: 'PNG / WebP · up to 32 MiB',
    sourceDrop: 'Choose a sprite sheet',
    sourceDropHelp: 'Processing uses the locked Standard RPG 8 × 8 layout.',
    sourceActionsAria: 'Source file actions',
    replace: 'Replace',
    clear: 'Clear',
    dimensions: '{width} × {height} px',
    gridLocked: '8 × 8 · locked processing layout',
    profileTitle: 'Smart default',
    profileName: 'Standard RPG topdown · 8 × 8',
    resourceName: 'Resource name',
    defaultCell: 'Cell · automatic',
    defaultFps: 'FPS · defined per animation',
    defaultMatte: 'Matte · automatic',
    defaultsAria: 'Locked processing defaults',
    advanced: 'Advanced defaults',
    advancedHelp: 'Maintained defaults are submitted exactly as shown; no hidden UI value overrides them.',
    advancedCleanup: 'Cleanup · on · min alpha 18 · min area 4',
    advancedAnchor: 'Anchor · (0, 0) · no frame adjustments',
    advancedMotion: 'Auto-correct · on · stabilization · on · max shift 2',
    advancedExport: 'Scales · 1× / 2× · pixel finishing off',
    advancedMode: 'Advanced processing',
    advancedModeHelp: 'JPEG, fixed-region layout, matte pairing, calibration, cut lines, and maintained tuning.',
    advancedModeActive: 'Advanced processing · current input bound',
    advancedSourceHint: 'PNG / WebP / JPEG · up to 32 MiB',
    advancedFlowSummary: 'Upload PNG, WebP, or JPEG and bind maintained advanced parameters to one local Job.',
    advancedSourceDropHelp: 'Choose the maintained 8 × 8 or fixed-region layout in Advanced processing.',
    advancedProfileTitle: 'Advanced · current values',
    advancedProfileFixed: 'Fixed-region motion source',
    advancedProfileTopdown: 'Standard RPG topdown · 8 × 8',
    advancedPrimary: 'Start advanced processing',
    advancedConfigKicker: 'Advanced processing · current input binding',
    advancedConfigTitle: 'Advanced local configuration',
    advancedConfigHelp: 'Changing a file or parameter immediately revokes the prior Job, exports, and Project candidate.',
    advancedSourceLayout: 'Source layout',
    advancedLayoutTopdown: 'Standard RPG · 8 × 8',
    advancedLayoutFixed: 'Fixed-region motion source',
    advancedBlackMatte: 'Black-matte pairing',
    advancedBlackChoose: 'Choose matching matte',
    advancedBlackClear: 'Clear matte',
    advancedBackground: 'Background & cleanup',
    advancedBackgroundMode: 'Background mode',
    advancedTolerance: 'Tolerance',
    advancedMinAlpha: 'Min alpha',
    advancedMinArea: 'Min area',
    advancedMinAreaRatio: 'Min area ratio',
    advancedCleanupToggle: 'Component cleanup',
    advancedPixel: 'Pixel finishing',
    advancedMaxColors: 'Max colors',
    advancedOutline: 'Outline',
    advancedOutlineMode: 'Outline mode',
    advancedGeometry: 'Frames & anchors',
    advancedAnchorX: 'Anchor X',
    advancedAnchorY: 'Anchor Y',
    advancedFrame: 'Frame',
    advancedNudgeX: 'Nudge X',
    advancedNudgeY: 'Nudge Y',
    advancedSaveNudge: 'Save nudge',
    advancedClearNudge: 'Clear nudge',
    advancedAnimationLocks: 'Animation lock (no stabilization)',
    advancedAutoCorrect: 'Auto-correct',
    advancedStabilize: 'Motion stabilization',
    advancedMaxShift: 'Max shift',
    advancedCalibration: 'Open calibration',
    advancedCutLines: 'Manual cut lines',
    advancedAutoGrid: 'Use automatic grid',
    advancedExportScales: 'Export scales',
    advancedBackStandard: 'Back to standard import',
    advancedBackConfig: 'Back to advanced configuration',
    advancedRun: 'Run advanced processing',
    advancedClose: 'Close advanced panel',
    calibrationKicker: 'Browser local · 0 Provider calls',
    calibrationTitle: 'Fixed-region calibration',
    calibrationHelp: 'Builds a browser-local calibrated copy and binds it as a new source input.',
    calibrationBuild: 'Build calibration preview',
    calibrationUse: 'Use calibrated copy',
    calibrationOriginal: 'Use original source',
    calibrationReset: 'Reset calibration',
    calibrationReady: 'Preview ready · {count} regions calibrated',
    calibrationIncomplete: 'Calibration blocked · {count} required regions are empty',
    calibrationBusy: 'Building browser-local calibration…',
    calibrationBefore: 'Original',
    calibrationAfter: 'Calibrated copy',
    calibrationReportMode: 'mode',
    calibrationReportRegions: 'regions',
    calibrationReportRemoved: 'removed components',
    calibrationReportScale: 'scale median',
    cutKicker: 'Current source fingerprint',
    cutTitle: 'Manual cut lines',
    cutHelp: 'Exactly seven horizontal and seven vertical lines are required for the 8 × 8 layout.',
    cutVertical: 'Add vertical cut',
    cutHorizontal: 'Add horizontal cut',
    cutEven: 'Even cuts',
    cutClear: 'Clear',
    cutConfirm: 'Confirm cut lines',
    cutCount: '{columns} columns · {rows} rows · {regions} regions',
    cutVerticalAria: 'Vertical cut line {index}',
    cutHorizontalAria: 'Horizontal cut line {index}',
    errorAdvancedSourceRequired: 'Choose a PNG, WebP, or JPEG sprite sheet first.',
    primaryStart: 'Start processing',
    primaryRunning: 'Processing current Job…',
    primaryResume: 'Resume this Job',
    primaryRetry: 'Process again',
    primaryUnknown: 'Submission outcome unknown · locked',
    stageLabel: 'Preview stage',
    stageEmptyKicker: 'Local pipeline',
    stageEmptyTitle: 'Choose a real source sheet',
    stageEmptyHelp: 'No result, Quality Report, or export is shown before processing succeeds.',
    stageReadyKicker: 'Source bound',
    stageReadyTitle: 'Ready for local processing',
    stageReadyHelp: 'The selected file and maintained defaults will be bound to one new Job.',
    stageRunningKicker: 'Current Job',
    stageRunningTitle: 'Processing the selected source',
    stageRunningHelp: 'Inputs are locked. The server receipt remains the only status authority.',
    stagePausedKicker: 'Same Job retained',
    stagePausedTitle: 'Observation paused',
    stagePausedHelp: 'Resume only re-observes this Job; it does not create replacement work.',
    stageUnknownKicker: 'Fail closed',
    stageUnknownTitle: 'No authoritative Job receipt',
    stageUnknownHelp: 'The request may have reached the server. Automatic resubmission is disabled.',
    stageFailedKicker: 'Quality blocked',
    stageFailedTitle: 'The real report blocked verified downloads',
    stageFailedHelp: 'Inspect the issue, impact, suggestion, and diagnostic code below.',
    stageCompleteKicker: 'Playable preview',
    stageCompleteTitle: 'WASD / arrow keys move the verified result',
    stageCompleteHelp: 'The sprite, animation manifest, Quality Report, and exports belong to this exact Job.',
    progressQueued: 'Queued',
    progressPost: 'Post-processing',
    progressVerify: 'Verifying output',
    progressDone: 'Complete',
    noCancel: 'This endpoint has no cancellation capability; inputs stay locked until a terminal receipt.',
    qualityTitle: 'Quality Report',
    qualityPass: 'PASS',
    qualityWarning: 'WARNING',
    qualityFail: 'FAIL',
    qualityFrames: 'Frames',
    qualityRepaired: 'Repaired',
    qualityIssues: 'Findings',
    qualityNone: 'No blocking errors. Verified download links are bound to this Job.',
    openReport: 'Open real Quality Report',
    jobLabel: 'Job',
    clipsLabel: 'Verified clips',
    clipsWaiting: 'Clips appear only after animations.json verifies.',
    exportTitle: 'Export verified packages',
    exportHelp: 'Each download is the real package returned by the current Job. Combined selection is not supported by the API.',
    exportPack: 'Character pack',
    exportGodot: 'Godot package',
    exportRpgmaker: 'RPG Maker package',
    exportOcad: 'OCAD package',
    close: 'Close',
    issueImpact: 'Impact',
    issueSuggestion: 'Suggestion',
    issueEmptyTitle: 'A required frame is empty',
    issueEmptyImpact: 'The corresponding animation cannot be downloaded as a verified result.',
    issueEmptySuggestion: 'Add visible pixels to the named cell, then process the source again.',
    issueCropTitle: 'A frame touches or crosses its cell edge',
    issueCropImpact: 'Animation may clip or bleed into the neighboring cell.',
    issueCropSuggestion: 'Move the sprite inward and leave transparent padding before reprocessing.',
    issueRegionTitle: 'A required source region is empty',
    issueRegionImpact: 'The runtime action has no usable source image.',
    issueRegionSuggestion: 'Fill the named layout region, then process the source again.',
    issueGenericTitle: 'The maintained quality gate reported an issue',
    issueGenericImpact: 'Verified downloads remain locked because the real diagnostic did not pass.',
    issueGenericSuggestion: 'Open the Quality Report and correct the referenced source condition.',
    errorSourceRead: 'The selected image could not be decoded.',
    errorSourceRequired: 'Choose a PNG or WebP sprite sheet first.',
    errorName: 'Enter a valid resource name.',
    errorGeneric: 'Local processing stopped: {detail}',
    previewState: '{animation} · x {x} · y {y}',
    previewAria: 'Playable verified character preview. Use WASD or arrow keys to move.',
  }),
  zh: Object.freeze({
    crumb: '· 本地导入',
    statusEmpty: '等待源文件',
    statusReady: '源文件已就绪',
    statusRunning: '本地处理中',
    statusPaused: '任务观察已暂停',
    statusUnknown: '提交结果未知',
    statusFailed: '质量已阻断',
    statusComplete: '质量通过 · 可导出',
    exportLocked: '处理完成后导出',
    exportReady: '导出',
    flowEyebrow: '当前流程',
    flowTitle: '本地精灵表导入',
    flowSummary: '上传一张 PNG 或 WebP 精灵表，运行仓库维护中的本地质量管线。',
    sourceTitle: '精灵表',
    sourceHint: 'PNG / WebP · 最大 32 MiB',
    sourceDrop: '选择精灵表',
    sourceDropHelp: '处理使用锁定的标准 RPG 8 × 8 布局。',
    sourceActionsAria: '源文件操作',
    replace: '替换',
    clear: '清除',
    dimensions: '{width} × {height} 像素',
    gridLocked: '8 × 8 · 锁定处理布局',
    profileTitle: '智能默认',
    profileName: '标准 RPG 俯视 · 8 × 8',
    resourceName: '资源名称',
    defaultCell: '单元格 · 自动',
    defaultFps: 'FPS · 由每个动画定义',
    defaultMatte: 'Matte · 自动',
    defaultsAria: '锁定的处理默认值',
    advanced: '高级默认值',
    advancedHelp: '下列维护中默认值会原样提交，不存在由隐藏控件覆盖的参数。',
    advancedCleanup: '清理 · 开 · 最小 Alpha 18 · 最小面积 4',
    advancedAnchor: '锚点 · (0, 0) · 无逐帧调整',
    advancedMotion: '自动校正 · 开 · 稳定处理 · 开 · 最大位移 2',
    advancedExport: '尺寸 · 1× / 2× · 像素精修关闭',
    advancedMode: '高级处理',
    advancedModeHelp: 'JPEG、固定区域布局、黑底配对、校准、切线及维护中的高级参数。',
    advancedModeActive: '高级处理 · 当前输入已绑定',
    advancedSourceHint: 'PNG / WebP / JPEG · 最大 32 MiB',
    advancedFlowSummary: '上传 PNG、WebP 或 JPEG，并将维护中的高级参数绑定到一个本地任务。',
    advancedSourceDropHelp: '在高级处理中选择维护中的 8 × 8 或固定区域布局。',
    advancedProfileTitle: '高级 · 当前参数',
    advancedProfileFixed: '固定区域动作源图',
    advancedProfileTopdown: '标准 RPG 俯视 · 8 × 8',
    advancedPrimary: '开始高级处理',
    advancedConfigKicker: '高级处理 · 当前输入绑定',
    advancedConfigTitle: '高级本地配置',
    advancedConfigHelp: '更换文件或参数会立即撤销旧任务、导出和 Project candidate。',
    advancedSourceLayout: '源布局',
    advancedLayoutTopdown: '标准 RPG · 8 × 8',
    advancedLayoutFixed: '固定区域动作源图',
    advancedBlackMatte: '黑底配对',
    advancedBlackChoose: '选择同尺寸黑底图',
    advancedBlackClear: '清除黑底图',
    advancedBackground: '背景与清理',
    advancedBackgroundMode: '背景模式',
    advancedTolerance: '容差',
    advancedMinAlpha: '最小 Alpha',
    advancedMinArea: '最小面积',
    advancedMinAreaRatio: '最小面积比例',
    advancedCleanupToggle: '组件清理',
    advancedPixel: '像素精修',
    advancedMaxColors: '最大颜色数',
    advancedOutline: '描边',
    advancedOutlineMode: '描边模式',
    advancedGeometry: '帧与锚点',
    advancedAnchorX: '锚点 X',
    advancedAnchorY: '锚点 Y',
    advancedFrame: '帧',
    advancedNudgeX: '逐帧位移 X',
    advancedNudgeY: '逐帧位移 Y',
    advancedSaveNudge: '保存位移',
    advancedClearNudge: '清除位移',
    advancedAnimationLocks: '动画锁（不参与稳定）',
    advancedAutoCorrect: '自动校正',
    advancedStabilize: '运动稳定',
    advancedMaxShift: '最大位移',
    advancedCalibration: '打开校准',
    advancedCutLines: '手动切线',
    advancedAutoGrid: '使用自动网格',
    advancedExportScales: '导出倍率',
    advancedBackStandard: '返回标准导入',
    advancedBackConfig: '返回高级配置',
    advancedRun: '运行高级处理',
    advancedClose: '关闭高级面板',
    calibrationKicker: '浏览器本地 · 0 次 Provider 调用',
    calibrationTitle: '固定区域校准',
    calibrationHelp: '生成浏览器本地校准副本，并将其绑定为新的源输入。',
    calibrationBuild: '生成校准预览',
    calibrationUse: '使用校准副本',
    calibrationOriginal: '使用原始源图',
    calibrationReset: '重置校准',
    calibrationReady: '预览已就绪 · 已校准 {count} 个区域',
    calibrationIncomplete: '校准已阻断 · {count} 个必需区域为空',
    calibrationBusy: '正在生成浏览器本地校准…',
    calibrationBefore: '原始图',
    calibrationAfter: '校准副本',
    calibrationReportMode: '模式',
    calibrationReportRegions: '区域',
    calibrationReportRemoved: '已移除组件',
    calibrationReportScale: '缩放中位数',
    cutKicker: '当前源文件 fingerprint',
    cutTitle: '手动切线',
    cutHelp: '8 × 8 布局必须恰好包含 7 条水平线和 7 条垂直线。',
    cutVertical: '添加垂直切线',
    cutHorizontal: '添加水平切线',
    cutEven: '均分切线',
    cutClear: '清空',
    cutConfirm: '确认切线',
    cutCount: '{columns} 列 · {rows} 行 · {regions} 个区域',
    cutVerticalAria: '垂直切线 {index}',
    cutHorizontalAria: '水平切线 {index}',
    errorAdvancedSourceRequired: '请先选择 PNG、WebP 或 JPEG 精灵表。',
    primaryStart: '开始处理',
    primaryRunning: '正在处理当前任务…',
    primaryResume: '继续当前任务',
    primaryRetry: '重新处理',
    primaryUnknown: '提交结果未知 · 已锁定',
    stageLabel: '预览舞台',
    stageEmptyKicker: '本地管线',
    stageEmptyTitle: '选择真实源精灵表',
    stageEmptyHelp: '处理成功前不会显示结果、质量报告或导出。',
    stageReadyKicker: '源文件已绑定',
    stageReadyTitle: '可以开始本地处理',
    stageReadyHelp: '所选文件与维护中的默认参数将绑定到一个新任务。',
    stageRunningKicker: '当前任务',
    stageRunningTitle: '正在处理所选源文件',
    stageRunningHelp: '输入已锁定，服务端回执是唯一状态依据。',
    stagePausedKicker: '保留同一任务',
    stagePausedTitle: '任务观察已暂停',
    stagePausedHelp: '继续只会重新观察这个任务，不会创建替代任务。',
    stageUnknownKicker: '失败即关闭',
    stageUnknownTitle: '没有权威任务回执',
    stageUnknownHelp: '请求可能已到达服务端，因此禁止自动重新提交。',
    stageFailedKicker: '质量已阻断',
    stageFailedTitle: '真实报告阻止了已验证下载',
    stageFailedHelp: '请检查下方问题、影响、建议和诊断代码。',
    stageCompleteKicker: '可试玩预览',
    stageCompleteTitle: '使用 WASD / 方向键移动已核验结果',
    stageCompleteHelp: '精灵图、动画清单、质量报告和导出均绑定到这个精确任务。',
    progressQueued: '排队中',
    progressPost: '本地后处理',
    progressVerify: '核验输出',
    progressDone: '完成',
    noCancel: '当前接口没有取消能力；到达终态前输入保持锁定。',
    qualityTitle: '质量报告',
    qualityPass: '通过',
    qualityWarning: '警告',
    qualityFail: '失败',
    qualityFrames: '帧数',
    qualityRepaired: '已修复',
    qualityIssues: '发现',
    qualityNone: '没有阻断错误，已验证下载链接已绑定到当前任务。',
    openReport: '打开真实质量报告',
    jobLabel: '任务',
    clipsLabel: '已核验动画片段',
    clipsWaiting: 'animations.json 核验通过后才会出现动画片段。',
    exportTitle: '导出已核验资源包',
    exportHelp: '每个下载项都是当前任务返回的真实资源包；接口不支持合并选择下载。',
    exportPack: '角色资源包',
    exportGodot: 'Godot 资源包',
    exportRpgmaker: 'RPG Maker 资源包',
    exportOcad: 'OCAD 资源包',
    close: '关闭',
    issueImpact: '影响',
    issueSuggestion: '建议',
    issueEmptyTitle: '必需帧为空',
    issueEmptyImpact: '对应动画无法作为已验证结果下载。',
    issueEmptySuggestion: '在诊断所指单元格补充可见像素后重新处理。',
    issueCropTitle: '帧内容触碰或越过单元格边缘',
    issueCropImpact: '动画可能裁切或串入相邻单元格。',
    issueCropSuggestion: '将精灵向内移动并保留透明边距后重新处理。',
    issueRegionTitle: '必需源区域为空',
    issueRegionImpact: '对应运行时动作没有可用源图。',
    issueRegionSuggestion: '补全诊断所指布局区域后重新处理。',
    issueGenericTitle: '维护中的质量门报告了问题',
    issueGenericImpact: '真实诊断未通过，因此已验证下载继续保持锁定。',
    issueGenericSuggestion: '打开质量报告并修正所指源文件条件。',
    errorSourceRead: '无法解码所选图像。',
    errorSourceRequired: '请先选择 PNG 或 WebP 精灵表。',
    errorName: '请输入有效的资源名称。',
    errorGeneric: '本地处理已停止：{detail}',
    previewState: '{animation} · x {x} · y {y}',
    previewAria: '可试玩的已核验角色预览。使用 WASD 或方向键移动。',
  }),
})

let initialized = false
let serviceConnectionAvailable = true
let localActive = true
let operationEpoch = 0
let sourceSelectionEpoch = 0
let blackSelectionEpoch = 0
let calibrationEpoch = 0
let advancedPanelReturnFocus = null
let activeController = null
let state = createInitialLocalCharacterState()
let preview = createPreviewState()

function byId(id) {
  return document.getElementById(id)
}

function localT(key, replacements = {}) {
  const language = getCurrentLanguage() === 'en' ? 'en' : 'zh'
  const template = LOCAL_COPY[language][key] ?? LOCAL_COPY.en[key] ?? key
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

function createPreviewState() {
  return {
    image: null,
    animations: null,
    keys: new Set(),
    animationName: null,
    direction: 'down',
    frameCursor: 0,
    lastFrameTime: 0,
    lastMoveTime: 0,
    wasMoving: false,
    position: { x: 450, y: 310 },
    raf: null,
  }
}

export function createInitialLocalCharacterState() {
  return {
    phase: 'empty',
    busy: null,
    file: null,
    sourceUrl: null,
    dimensions: null,
    name: '',
    processingMode: 'standard',
    advancedPanel: null,
    advancedSettings: createAdvancedLocalSettings(),
    blackFile: null,
    blackUrl: null,
    blackDimensions: null,
    calibration: {
      busy: false,
      previewFile: null,
      previewUrl: null,
      report: null,
      sourceInputEpoch: null,
      active: false,
    },
    calibrationOriginal: null,
    inputEpoch: 0,
    binding: null,
    job: null,
    result: null,
    failureReport: null,
    error: null,
  }
}

export function deriveLocalCharacterPresentation(value = state) {
  const phase = value?.phase ?? 'empty'
  const copy = {
    empty: ['statusEmpty', 'stageEmptyKicker', 'stageEmptyTitle', 'stageEmptyHelp', 'primaryStart', 'blocked'],
    ready: ['statusReady', 'stageReadyKicker', 'stageReadyTitle', 'stageReadyHelp', 'primaryStart', 'build'],
    running: ['statusRunning', 'stageRunningKicker', 'stageRunningTitle', 'stageRunningHelp', 'primaryRunning', 'running'],
    poll_paused: ['statusPaused', 'stagePausedKicker', 'stagePausedTitle', 'stagePausedHelp', 'primaryResume', 'resume'],
    submission_unknown: ['statusUnknown', 'stageUnknownKicker', 'stageUnknownTitle', 'stageUnknownHelp', 'primaryUnknown', 'blocked'],
    failed: ['statusFailed', 'stageFailedKicker', 'stageFailedTitle', 'stageFailedHelp', 'primaryRetry', 'build'],
    complete: ['statusComplete', 'stageCompleteKicker', 'stageCompleteTitle', 'stageCompleteHelp', 'exportReady', 'export'],
  }[phase] ?? ['statusFailed', 'stageFailedKicker', 'stageFailedTitle', 'stageFailedHelp', 'primaryRetry', 'blocked']
  return Object.freeze({
    phase,
    statusKey: copy[0],
    kickerKey: copy[1],
    titleKey: copy[2],
    helpKey: copy[3],
    primaryKey: copy[4],
    action: copy[5],
    releaseReady: phase === 'complete' && Boolean(value?.result?.job?.zip_url),
  })
}

function currentInputKey(value = state) {
  if (!value.file) return null
  if (value.processingMode === 'advanced') {
    const blackFile = value.advancedSettings.backgroundMode === 'dual_matte'
      ? value.blackFile
      : null
    const options = buildAdvancedLocalCharacterOptions({
      file: value.file,
      blackFile,
      blackDimensions: value.blackDimensions,
      dimensions: value.dimensions,
      name: value.name,
      settings: value.advancedSettings,
    })
    return advancedLocalInputFingerprint({
      file: value.file,
      blackFile,
      options,
      inputEpoch: value.inputEpoch,
    })
  }
  return JSON.stringify({
    epoch: value.inputEpoch,
    fileName: value.file.name,
    fileSize: value.file.size,
    fileType: value.file.type,
    name: value.name.trim(),
    options: buildLocalCharacterOptions({ file: value.file, name: value.name }),
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

function stopPreview() {
  if (preview.raf != null) cancelAnimationFrame(preview.raf)
  preview.raf = null
  preview.keys.clear()
}

function clearVerifiedResult() {
  stopPreview()
  preview = createPreviewState()
  closeExportDialog()
}

function setState(patch) {
  state = { ...state, ...patch }
  renderStudioCharacterLocal()
}

function errorDetail(error) {
  if (error?.code === 'source_required') {
    return localT(state.processingMode === 'advanced' ? 'errorAdvancedSourceRequired' : 'errorSourceRequired')
  }
  if (error?.code === 'name_invalid') return localT('errorName')
  return localT('errorGeneric', { detail: String(error?.message || error || 'unknown') })
}

function objectUrlForFile(file) {
  return globalThis.URL?.createObjectURL?.(file) ?? null
}

function readImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error(localT('errorSourceRead')))
    image.src = url
  })
}

function defaultName(file) {
  return String(file?.name ?? '').replace(/\.[^.]*$/, '').trim().slice(0, 64) || 'character'
}

function revokeUrl(url) {
  if (url) globalThis.URL?.revokeObjectURL?.(url)
}

function revokeInputUrls(value = state) {
  const urls = new Set([
    value.sourceUrl,
    value.blackUrl,
    value.calibration?.previewUrl,
    value.calibrationOriginal?.url,
  ].filter(Boolean))
  for (const url of urls) revokeUrl(url)
}

function settingsForSource(settings, dimensions) {
  return {
    ...createAdvancedLocalSettings(dimensions),
    ...settings,
    anchorOffset: { ...createAdvancedLocalSettings().anchorOffset, ...settings?.anchorOffset },
    frameAdjustments: {},
    lockedAnimations: [],
    manualCutLinesEnabled: false,
    manualCutLines: makeEvenAdvancedCutLines(dimensions.width, dimensions.height),
  }
}

async function selectSource(file) {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  const selectionEpoch = ++sourceSelectionEpoch
  blackSelectionEpoch += 1
  calibrationEpoch += 1
  activeController?.abort()
  operationEpoch += 1
  const previousMode = state.processingMode
  const previousSettings = state.advancedSettings
  const previousPanel = state.advancedPanel
  let nextMode = previousMode
  try {
    if (previousMode === 'advanced') validateAdvancedLocalSourceFile(file)
    else validateLocalCharacterFile(file)
  } catch (standardError) {
    try {
      validateAdvancedLocalSourceFile(file)
      nextMode = 'advanced'
    } catch {
      nextMode = previousMode
    }
  }
  revokeInputUrls()
  clearVerifiedResult()
  const nextInputEpoch = state.inputEpoch + 1
  state = {
    ...createInitialLocalCharacterState(),
    busy: 'decode',
    processingMode: nextMode,
    advancedPanel: nextMode === 'advanced' ? previousPanel : null,
    advancedSettings: previousSettings,
    inputEpoch: nextInputEpoch,
  }
  renderStudioCharacterLocal()
  let nextUrl = null
  try {
    if (nextMode === 'advanced') validateAdvancedLocalSourceFile(file)
    else validateLocalCharacterFile(file)
    nextUrl = objectUrlForFile(file)
    if (!nextUrl) throw new Error(localT('errorSourceRead'))
    const dimensions = await readImageDimensions(nextUrl)
    if (selectionEpoch !== sourceSelectionEpoch) {
      globalThis.URL?.revokeObjectURL?.(nextUrl)
      return
    }
    state = {
      ...createInitialLocalCharacterState(),
      phase: 'ready',
      file,
      sourceUrl: nextUrl,
      dimensions,
      name: defaultName(file),
      processingMode: nextMode,
      advancedPanel: nextMode === 'advanced' ? previousPanel : null,
      advancedSettings: settingsForSource(previousSettings, dimensions),
      inputEpoch: nextInputEpoch,
    }
    renderStudioCharacterLocal()
  } catch (error) {
    if (nextUrl) globalThis.URL?.revokeObjectURL?.(nextUrl)
    if (selectionEpoch !== sourceSelectionEpoch) return
    setState({ busy: null, error: errorDetail(error) })
  }
}

function clearSource({
  processingMode = state.processingMode,
  advancedPanel = state.advancedPanel,
} = {}) {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  sourceSelectionEpoch += 1
  blackSelectionEpoch += 1
  calibrationEpoch += 1
  activeController?.abort()
  operationEpoch += 1
  const advancedSettings = {
    ...state.advancedSettings,
    frameAdjustments: {},
    lockedAnimations: [],
    manualCutLinesEnabled: false,
    manualCutLines: null,
  }
  revokeInputUrls()
  clearVerifiedResult()
  const nextEpoch = state.inputEpoch + 1
  state = {
    ...createInitialLocalCharacterState(),
    processingMode,
    advancedPanel,
    advancedSettings,
    inputEpoch: nextEpoch,
  }
  const input = byId('character-local-file')
  if (input) input.value = ''
  renderStudioCharacterLocal()
}

function invalidateForName(name) {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  const nextName = String(name ?? '')
  if (nextName === state.name) return
  clearVerifiedResult()
  state = {
    ...state,
    phase: state.file ? 'ready' : 'empty',
    name: nextName,
    inputEpoch: state.inputEpoch + 1,
    binding: null,
    job: null,
    result: null,
    failureReport: null,
    error: null,
  }
  renderStudioCharacterLocal()
}

function invalidateInputState(patch = {}) {
  if (['running', 'submission_unknown'].includes(state.phase)) return false
  clearVerifiedResult()
  state = invalidateAdvancedLocalResultState(state, patch)
  renderStudioCharacterLocal()
  return true
}

export function canUseStandardLocalSource(file) {
  try {
    validateLocalCharacterFile(file)
    return true
  } catch {
    return false
  }
}

function openAdvancedPanel(panel = 'config') {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  if (!state.advancedPanel) advancedPanelReturnFocus = document.activeElement
  if (state.processingMode !== 'advanced') {
    invalidateInputState({ processingMode: 'advanced', advancedPanel: panel })
  } else {
    setState({ advancedPanel: panel, error: null })
  }
  const headingId = {
    config: 'character-advanced-title',
    calibration: 'character-calibration-title',
    cuts: 'character-cuts-title',
  }[panel]
  queueMicrotask(() => byId(headingId)?.focus())
}

function closeAdvancedPanel() {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  setState({ advancedPanel: null })
  const returnFocus = advancedPanelReturnFocus ?? byId('character-advanced-entry')
  advancedPanelReturnFocus = null
  queueMicrotask(() => returnFocus?.focus?.())
}

function returnToStandardImport() {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  if (state.processingMode === 'standard') {
    closeAdvancedPanel()
    return
  }
  if (state.file && !canUseStandardLocalSource(state.file)) {
    clearSource({ processingMode: 'standard', advancedPanel: null })
    advancedPanelReturnFocus = null
    queueMicrotask(() => byId('character-advanced-entry')?.focus())
    return
  }
  invalidateInputState({ processingMode: 'standard', advancedPanel: null })
  advancedPanelReturnFocus = null
  queueMicrotask(() => byId('character-advanced-entry')?.focus())
}

function inputNumber(id, fallback) {
  const number = Number(byId(id)?.value)
  return Number.isFinite(number) ? number : fallback
}

function inputChecked(id, fallback = false) {
  const control = byId(id)
  return control ? Boolean(control.checked) : fallback
}

function readAdvancedSettingsFromControls() {
  const selectedLocks = [...(byId('character-advanced-locks')?.selectedOptions ?? [])].map((option) => option.value)
  const exportScales = [1, 2, 3, 4]
    .filter((scale) => inputChecked(`character-advanced-export-${scale}x`, false))
  return {
    ...state.advancedSettings,
    sourceLayout: byId('character-advanced-layout')?.value ?? state.advancedSettings.sourceLayout,
    backgroundMode: byId('character-advanced-background-mode')?.value ?? state.advancedSettings.backgroundMode,
    backgroundTolerance: inputNumber('character-advanced-tolerance', 24),
    componentCleanup: inputChecked('character-advanced-component-cleanup', true),
    minAlpha: inputNumber('character-advanced-min-alpha', 18),
    minArea: inputNumber('character-advanced-min-area', 4),
    minAreaRatio: inputNumber('character-advanced-min-area-ratio', 0),
    pixelFinishing: inputChecked('character-advanced-pixel-finishing', false),
    pixelFinishingMaxColors: inputNumber('character-advanced-max-colors', 16),
    pixelFinishingOutline: inputChecked('character-advanced-outline', true),
    pixelFinishingOutlineMode: byId('character-advanced-outline-mode')?.value ?? 'outer',
    anchorOffset: {
      x: inputNumber('character-advanced-anchor-x', 0),
      y: inputNumber('character-advanced-anchor-y', 0),
    },
    lockedAnimations: selectedLocks,
    autoCorrect: inputChecked('character-advanced-auto-correct', true),
    motionStabilize: inputChecked('character-advanced-motion-stabilize', true),
    motionMaxShift: inputNumber('character-advanced-motion-max-shift', 2),
    exportScales,
  }
}

function updateAdvancedSettingsFromControls() {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  const next = readAdvancedSettingsFromControls()
  if (JSON.stringify(next) === JSON.stringify(state.advancedSettings)) return
  const layoutChanged = next.sourceLayout !== state.advancedSettings.sourceLayout
  if (
    next.sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID &&
    state.calibrationOriginal
  ) restoreOriginalCalibration({ render: false })
  let calibration = state.calibration
  if (layoutChanged) {
    calibrationEpoch += 1
    revokeUrl(state.calibration?.previewUrl)
    calibration = {
      ...state.calibration,
      busy: false,
      previewFile: null,
      previewUrl: null,
      report: null,
      sourceInputEpoch: null,
    }
  }
  const clearPairedMatte = next.backgroundMode !== 'dual_matte' && (
    state.advancedSettings.backgroundMode === 'dual_matte' ||
    Boolean(state.blackFile)
  )
  if (clearPairedMatte) {
    blackSelectionEpoch += 1
    revokeUrl(state.blackUrl)
    const input = byId('character-advanced-black-file')
    if (input) input.value = ''
  }
  if (next.sourceLayout !== 'topdown_rpg_v0') next.manualCutLinesEnabled = false
  invalidateInputState({
    processingMode: 'advanced',
    advancedPanel: state.advancedPanel ?? 'config',
    advancedSettings: next,
    calibration,
    ...(clearPairedMatte ? { blackFile: null, blackUrl: null, blackDimensions: null } : {}),
  })
}

async function selectBlackMatte(file) {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  const selectionEpoch = ++blackSelectionEpoch
  revokeUrl(state.blackUrl)
  invalidateInputState({
    blackFile: null,
    blackUrl: null,
    blackDimensions: null,
    advancedSettings: bindAdvancedBlackMatteSettings(state.advancedSettings),
  })
  let url = null
  try {
    validateAdvancedLocalSourceFile(file, { label: 'Black-matte pairing' })
    url = objectUrlForFile(file)
    if (!url) throw new Error(localT('errorSourceRead'))
    const dimensions = await readImageDimensions(url)
    if (!canCommitAdvancedBlackMatteSelection({
      selectionEpoch,
      currentSelectionEpoch: blackSelectionEpoch,
      backgroundMode: state.advancedSettings.backgroundMode,
    })) {
      revokeUrl(url)
      return
    }
    if (
      !state.dimensions ||
      dimensions.width !== state.dimensions.width ||
      dimensions.height !== state.dimensions.height
    ) throw new Error('Black-matte pairing dimensions must match the current source')
    state = {
      ...state,
      blackFile: file,
      blackUrl: url,
      blackDimensions: dimensions,
      error: null,
    }
    renderStudioCharacterLocal()
  } catch (error) {
    if (url) revokeUrl(url)
    if (!canCommitAdvancedBlackMatteSelection({
      selectionEpoch,
      currentSelectionEpoch: blackSelectionEpoch,
      backgroundMode: state.advancedSettings.backgroundMode,
    })) return
    setState({ blackFile: null, blackUrl: null, blackDimensions: null, error: errorDetail(error) })
  }
}

function clearBlackMatte() {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  blackSelectionEpoch += 1
  revokeUrl(state.blackUrl)
  invalidateInputState({ blackFile: null, blackUrl: null, blackDimensions: null })
  const input = byId('character-advanced-black-file')
  if (input) input.value = ''
}

function updateFrameAdjustment(clear = false) {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  const frame = inputNumber('character-advanced-frame', 0)
  const frameAdjustments = { ...state.advancedSettings.frameAdjustments }
  if (clear) delete frameAdjustments[frame]
  else {
    const dx = inputNumber('character-advanced-nudge-x', 0)
    const dy = inputNumber('character-advanced-nudge-y', 0)
    if (dx || dy) frameAdjustments[frame] = { dx, dy }
    else delete frameAdjustments[frame]
  }
  invalidateInputState({
    processingMode: 'advanced',
    advancedSettings: { ...state.advancedSettings, frameAdjustments },
  })
}

function setAutomaticGrid() {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  invalidateInputState({
    processingMode: 'advanced',
    advancedSettings: { ...state.advancedSettings, manualCutLinesEnabled: false },
  })
}

async function decodeFileToStageRgba(file) {
  const url = objectUrlForFile(file)
  if (!url) throw new Error(localT('errorSourceRead'))
  try {
    const image = await loadImageUrl(url)
    const canvas = document.createElement('canvas')
    canvas.width = TEMPLATE_CALIBRATION_STAGE_SIZE
    canvas.height = TEMPLATE_CALIBRATION_STAGE_SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2d canvas context unavailable')
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    return {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    }
  } finally {
    revokeUrl(url)
  }
}

function rgbaToPngBlob(image) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) {
      reject(new Error('2d canvas context unavailable'))
      return
    }
    const imageData = context.createImageData(image.width, image.height)
    imageData.data.set(image.data)
    context.putImageData(imageData, 0, 0)
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG encoding failed'))
    }, 'image/png')
  })
}

async function buildCalibrationPreview() {
  if (
    !state.file ||
    state.advancedSettings.sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID ||
    state.calibration?.busy ||
    ['running', 'submission_unknown'].includes(state.phase)
  ) return
  const operation = ++calibrationEpoch
  const sourceEpoch = sourceSelectionEpoch
  const file = state.file
  revokeUrl(state.calibration?.previewUrl)
  setState({
    calibration: {
      ...state.calibration,
      busy: true,
      previewFile: null,
      previewUrl: null,
      report: null,
      sourceInputEpoch: sourceEpoch,
    },
    error: null,
  })
  let previewUrl = null
  try {
    const decoded = await decodeFileToStageRgba(file)
    if (
      operation !== calibrationEpoch ||
      sourceEpoch !== sourceSelectionEpoch ||
      state.file !== file ||
      state.advancedSettings.sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID
    ) return
    const staged = stageTemplateCalibrationSource(decoded)
    const calibrated = calibrateFixedRegionTemplateImage(staged.image)
    const blob = await rgbaToPngBlob(calibrated.image)
    if (
      operation !== calibrationEpoch ||
      sourceEpoch !== sourceSelectionEpoch ||
      state.file !== file ||
      state.advancedSettings.sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID
    ) return
    const stem = String(file.name || 'character-sheet').replace(/\.[^.]+$/, '')
    const previewFile = new File([blob], `${stem}.template-calibrated-v0.png`, {
      type: 'image/png',
      lastModified: Date.now(),
    })
    previewUrl = objectUrlForFile(previewFile)
    if (!previewUrl) throw new Error('Calibration preview URL unavailable')
    if (
      operation !== calibrationEpoch ||
      sourceEpoch !== sourceSelectionEpoch ||
      state.file !== file ||
      state.advancedSettings.sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID
    ) {
      revokeUrl(previewUrl)
      return
    }
    state = {
      ...state,
      calibration: {
        ...state.calibration,
        busy: false,
        previewFile,
        previewUrl,
        report: { ...calibrated.report, staging: staged.report },
        sourceInputEpoch: sourceEpoch,
      },
    }
    renderStudioCharacterLocal()
  } catch (error) {
    if (previewUrl) revokeUrl(previewUrl)
    if (operation !== calibrationEpoch) return
    setState({
      calibration: {
        ...state.calibration,
        busy: false,
        previewFile: null,
        previewUrl: null,
        report: null,
      },
      error: errorDetail(error),
    })
  }
}

function useCalibrationPreview() {
  const calibration = state.calibration
  if (
    !calibration?.previewFile ||
    !calibration.previewUrl ||
    calibration.report?.missing_region_count !== 0 ||
    calibration.sourceInputEpoch !== sourceSelectionEpoch ||
    ['running', 'submission_unknown'].includes(state.phase)
  ) return
  calibrationEpoch += 1
  blackSelectionEpoch += 1
  revokeUrl(state.blackUrl)
  clearVerifiedResult()
  const original = state.calibrationOriginal ?? {
    file: state.file,
    url: state.sourceUrl,
    dimensions: state.dimensions,
  }
  const dimensions = { width: 256, height: 256 }
  state = {
    ...state,
    phase: 'ready',
    file: calibration.previewFile,
    sourceUrl: calibration.previewUrl,
    dimensions,
    blackFile: null,
    blackUrl: null,
    blackDimensions: null,
    calibrationOriginal: original,
    calibration: {
      ...calibration,
      busy: false,
      previewFile: null,
      previewUrl: null,
      active: true,
    },
    advancedSettings: {
      ...settingsForSource(state.advancedSettings, dimensions),
      sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
      motionStabilize: false,
    },
    inputEpoch: state.inputEpoch + 1,
    binding: null,
    job: null,
    result: null,
    failureReport: null,
    error: null,
  }
  sourceSelectionEpoch += 1
  renderStudioCharacterLocal()
}

function restoreOriginalCalibration({ render = true } = {}) {
  const original = state.calibrationOriginal
  if (!original) return false
  calibrationEpoch += 1
  sourceSelectionEpoch += 1
  revokeUrl(state.sourceUrl)
  revokeUrl(state.calibration?.previewUrl)
  revokeUrl(state.blackUrl)
  clearVerifiedResult()
  state = {
    ...state,
    phase: 'ready',
    file: original.file,
    sourceUrl: original.url,
    dimensions: original.dimensions,
    blackFile: null,
    blackUrl: null,
    blackDimensions: null,
    calibrationOriginal: null,
    calibration: {
      busy: false,
      previewFile: null,
      previewUrl: null,
      report: null,
      sourceInputEpoch: null,
      active: false,
    },
    advancedSettings: settingsForSource(state.advancedSettings, original.dimensions),
    inputEpoch: state.inputEpoch + 1,
    binding: null,
    job: null,
    result: null,
    failureReport: null,
    error: null,
  }
  if (render) renderStudioCharacterLocal()
  return true
}

function resetCalibration() {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  if (restoreOriginalCalibration()) return
  calibrationEpoch += 1
  revokeUrl(state.calibration?.previewUrl)
  setState({
    calibration: {
      busy: false,
      previewFile: null,
      previewUrl: null,
      report: null,
      sourceInputEpoch: null,
      active: false,
    },
    error: null,
  })
}

function cutLineCounts(cutLines) {
  return {
    vertical: cutLines?.verticalLines?.length ?? 0,
    horizontal: cutLines?.horizontalLines?.length ?? 0,
  }
}

function updateCutLines(cutLines, { enable = state.advancedSettings.manualCutLinesEnabled } = {}) {
  invalidateInputState({
    processingMode: 'advanced',
    advancedPanel: 'cuts',
    advancedSettings: {
      ...state.advancedSettings,
      manualCutLines: cutLines,
      manualCutLinesEnabled: enable,
    },
  })
}

function addCutLine(axis) {
  if (!state.dimensions || ['running', 'submission_unknown'].includes(state.phase)) return
  const current = state.advancedSettings.manualCutLines ?? makeEvenAdvancedCutLines(
    state.dimensions.width,
    state.dimensions.height,
  )
  updateCutLines(addAdvancedCutLine(current, axis), { enable: false })
}

function clearCutLines() {
  if (!state.dimensions || ['running', 'submission_unknown'].includes(state.phase)) return
  updateCutLines({
    width: state.dimensions.width,
    height: state.dimensions.height,
    verticalLines: [],
    horizontalLines: [],
  }, { enable: false })
}

function useEvenCutLines() {
  if (!state.dimensions || ['running', 'submission_unknown'].includes(state.phase)) return
  updateCutLines(makeEvenAdvancedCutLines(state.dimensions.width, state.dimensions.height), { enable: false })
}

function confirmCutLines() {
  if (!state.dimensions || ['running', 'submission_unknown'].includes(state.phase)) return
  const counts = cutLineCounts(state.advancedSettings.manualCutLines)
  if (counts.vertical !== 7 || counts.horizontal !== 7) {
    setState({ error: errorDetail(new Error('Manual cut lines require exactly seven positions on each axis')) })
    return
  }
  updateCutLines(state.advancedSettings.manualCutLines, { enable: true })
  setState({ advancedPanel: 'config' })
}

function startCutLineDrag(event, axis, index) {
  if (['running', 'submission_unknown'].includes(state.phase)) return
  event.preventDefault()
  const previewNode = byId('character-advanced-cut-preview')
  const rect = previewNode?.getBoundingClientRect?.()
  if (!rect?.width || !rect?.height) return
  updateCutLines(state.advancedSettings.manualCutLines, {
    enable: state.advancedSettings.manualCutLinesEnabled,
  })
  const move = (moveEvent) => {
    const cuts = state.advancedSettings.manualCutLines
    const position = axis === 'vertical'
      ? ((moveEvent.clientX - rect.left) / rect.width) * cuts.width
      : ((moveEvent.clientY - rect.top) / rect.height) * cuts.height
    state = {
      ...state,
      advancedSettings: {
        ...state.advancedSettings,
        manualCutLines: moveAdvancedCutLine(cuts, axis, index, position),
      },
    }
    renderCutLineEditor()
  }
  const stop = () => {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', stop)
    renderStudioCharacterLocal()
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop, { once: true })
}

function loadImageUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      const error = new Error(`Could not display ${url}`)
      error.code = 'request_failed'
      reject(error)
    }
    image.src = url
  })
}

function chooseAnimation(animations, preferred, fallback = null) {
  if (animations[preferred]) return preferred
  if (fallback && animations[fallback]) return fallback
  return Object.keys(animations)[0] ?? null
}

function drawChecker(ctx) {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  for (let y = 0; y < height; y += 16) {
    for (let x = 0; x < width; x += 16) {
      ctx.fillStyle = (x / 16 + y / 16) % 2 ? '#111722' : '#0b1018'
      ctx.fillRect(x, y, 16, 16)
    }
  }
}

function drawPreviewFrame(timestamp = 0) {
  preview.raf = null
  if (!localActive || state.phase !== 'complete' || !preview.image || !preview.animations) return
  const canvas = byId('character-local-canvas')
  const ctx = canvas?.getContext?.('2d')
  if (!ctx) return
  const animations = preview.animations.animations
  const movementDelta = preview.lastMoveTime ? Math.min(50, timestamp - preview.lastMoveTime) : 0
  preview.lastMoveTime = timestamp
  const intent = getMovementIntent(preview.keys, preview.direction)
  if (intent.moving) {
    preview.direction = intent.direction
    preview.wasMoving = true
    preview.animationName = chooseAnimation(
      animations,
      getAnimationNameForIntent(intent, preview.direction),
      preview.animationName,
    )
    preview.position = movePreviewActor(preview.position, intent, {
      deltaMs: movementDelta,
      speed: 82,
      minX: 80,
      maxX: canvas.width - 80,
      minY: 150,
      maxY: canvas.height - 30,
    })
  } else if (preview.wasMoving) {
    preview.wasMoving = false
    preview.animationName = chooseAnimation(animations, `idle_${preview.direction}`, preview.animationName)
    preview.frameCursor = 0
    preview.lastFrameTime = 0
  }
  const animation = animations[preview.animationName]
  if (!animation) return
  const frameSize = preview.animations.frame_size
  const sheetSize = preview.animations.sheet_size
  const columns = Math.max(1, Math.floor(sheetSize.w / frameSize.w))
  const delay = 1000 / Math.max(1, Number(animation.fps) || 8)
  if (!preview.lastFrameTime || timestamp - preview.lastFrameTime >= delay) {
    preview.frameCursor = (preview.frameCursor + 1) % animation.frames.length
    preview.lastFrameTime = timestamp
  }
  const frameIndex = animation.frames[preview.frameCursor]
  const sourceX = (frameIndex % columns) * frameSize.w
  const sourceY = Math.floor(frameIndex / columns) * frameSize.h
  drawChecker(ctx)
  ctx.imageSmoothingEnabled = false
  ctx.strokeStyle = 'rgba(51, 215, 197, .28)'
  ctx.beginPath()
  ctx.moveTo(0, preview.position.y)
  ctx.lineTo(canvas.width, preview.position.y)
  ctx.stroke()
  const scale = Math.max(1, Math.min(3, Math.floor(canvas.height / Math.max(1, frameSize.h * 2.1))))
  const anchor = preview.animations.anchor ?? { x: frameSize.w / 2, y: frameSize.h - 8 }
  const targetX = Math.round(preview.position.x - anchor.x * scale)
  const targetY = Math.round(preview.position.y - anchor.y * scale)
  ctx.drawImage(
    preview.image,
    sourceX,
    sourceY,
    frameSize.w,
    frameSize.h,
    targetX,
    targetY,
    frameSize.w * scale,
    frameSize.h * scale,
  )
  setText('character-local-preview-state', localT('previewState', {
    animation: preview.animationName,
    x: Math.round(preview.position.x),
    y: Math.round(preview.position.y),
  }))
  preview.raf = requestAnimationFrame(drawPreviewFrame)
}

function startPreviewLoop() {
  stopPreview()
  if (!localActive || state.phase !== 'complete' || !preview.image || !preview.animations) return
  preview.lastMoveTime = 0
  preview.raf = requestAnimationFrame(drawPreviewFrame)
}

async function preparePreview(result) {
  const image = await loadImageUrl(result.job.normalized_sheet_url)
  stopPreview()
  preview = createPreviewState()
  preview.image = image
  preview.animations = result.animations
  preview.animationName = chooseAnimation(result.animations.animations, 'idle_down')
  const canvas = byId('character-local-canvas')
  preview.position = {
    x: (canvas?.width ?? 900) / 2,
    y: Math.round((canvas?.height ?? 470) * 0.68),
  }
}

async function finishObservedJob(terminalJob, operation) {
  if (terminalJob.status === 'done') {
    setState({ phase: 'running', busy: 'verify', job: terminalJob, error: null })
    const result = await verifyLocalCharacterResult(terminalJob, {
      signal: operation.signal,
      expectedSourceLayout: state.binding?.processingMode === 'advanced'
        ? state.binding.sourceLayout
        : null,
    })
    await preparePreview(result)
    if (!isCurrentOperation(operation.epoch) || state.binding?.inputKey !== currentInputKey()) return
    setState({
      phase: 'complete',
      busy: null,
      job: terminalJob,
      result,
      failureReport: null,
      error: null,
    })
    startPreviewLoop()
    return
  }
  let failureReport = null
  try {
    failureReport = await fetchLocalCharacterFailureReport(terminalJob, { signal: operation.signal })
  } catch (error) {
    if (isRecoverableLocalCharacterObservationError(error)) throw error
  }
  if (!isCurrentOperation(operation.epoch)) return
  setState({
    phase: 'failed',
    busy: null,
    job: terminalJob,
    result: null,
    failureReport,
    error: terminalJob.reason || terminalJob.failure_status || terminalJob.status,
  })
}

async function observeLocalJob(initialJob, operation) {
  const terminalJob = await pollLocalCharacterJob(initialJob, {
    signal: operation.signal,
    onUpdate(job) {
      if (!isCurrentOperation(operation.epoch)) return
      state = { ...state, phase: 'running', busy: 'observe', job, error: null }
      renderStudioCharacterLocal()
    },
  })
  if (!isCurrentOperation(operation.epoch)) return
  await finishObservedJob(terminalJob, operation)
}

async function submitLocalJob() {
  if (!serviceConnectionAvailable || !state.file) {
    setState({ error: localT(state.processingMode === 'advanced' ? 'errorAdvancedSourceRequired' : 'errorSourceRequired') })
    return
  }
  let inputKey
  try {
    inputKey = currentInputKey()
  } catch (error) {
    setState({ error: errorDetail(error) })
    return
  }
  const operation = beginOperation()
  const binding = Object.freeze({
    inputKey,
    inputEpoch: state.inputEpoch,
    processingMode: state.processingMode,
    sourceLayout: state.processingMode === 'advanced'
      ? state.advancedSettings.sourceLayout
      : 'topdown_rpg_v0',
  })
  setState(beginLocalCharacterRunState(state, binding))
  advancedPanelReturnFocus = null
  queueMicrotask(() => byId('character-local-stage-title')?.focus())
  let receivedJob = null
  try {
    receivedJob = state.processingMode === 'advanced'
      ? await submitAdvancedLocalCharacterJob({
          file: state.file,
          blackFile: state.blackFile,
          blackDimensions: state.blackDimensions,
          dimensions: state.dimensions,
          name: state.name,
          settings: state.advancedSettings,
        }, { signal: operation.signal })
      : await submitLocalCharacterJob({ file: state.file, name: state.name }, {
          signal: operation.signal,
        })
    if (!isCurrentOperation(operation.epoch) || state.binding?.inputKey !== inputKey) return
    state = { ...state, busy: 'observe', job: receivedJob }
    renderStudioCharacterLocal()
    await observeLocalJob(receivedJob, operation)
  } catch (error) {
    if (!isCurrentOperation(operation.epoch) || error?.name === 'AbortError') return
    setState({
      phase: receivedJob && isRecoverableLocalCharacterObservationError(error)
        ? 'poll_paused'
        : receivedJob
          ? 'failed'
          : 'submission_unknown',
      busy: null,
      job: receivedJob,
      result: null,
      failureReport: null,
      error: errorDetail(error),
    })
  }
}

export function beginLocalCharacterRunState(value, binding) {
  return {
    ...value,
    phase: 'running',
    busy: 'submit',
    advancedPanel: null,
    binding,
    job: null,
    result: null,
    failureReport: null,
    error: null,
  }
}

async function resumeLocalJob() {
  if (!state.job || state.phase !== 'poll_paused') return
  const operation = beginOperation()
  const job = state.job
  setState({ phase: 'running', busy: 'observe', error: null })
  try {
    await observeLocalJob(job, operation)
  } catch (error) {
    if (!isCurrentOperation(operation.epoch) || error?.name === 'AbortError') return
    setState({
      phase: isRecoverableLocalCharacterObservationError(error) ? 'poll_paused' : 'failed',
      busy: null,
      error: errorDetail(error),
    })
  }
}

function handlePrimaryAction() {
  const action = deriveLocalCharacterPresentation().action
  if (action === 'build') void submitLocalJob()
  else if (action === 'resume') void resumeLocalJob()
  else if (action === 'export') openExportDialog()
}

function progressForState() {
  if (state.phase === 'complete') return { value: 100, key: 'progressDone' }
  if (state.busy === 'verify') return { value: 90, key: 'progressVerify' }
  if (state.job?.status === 'post_processing') return { value: 68, key: 'progressPost' }
  return { value: 22, key: 'progressQueued' }
}

function qualityMessages(report) {
  const validation = report?.validation ?? {}
  return [
    ...(Array.isArray(validation.blocking_errors) ? validation.blocking_errors : []),
    ...(Array.isArray(validation.warnings) ? validation.warnings : []),
  ].map(String)
}

function issueCopy(code) {
  if (/^frame_\d+_empty$/.test(code)) {
    return ['issueEmptyTitle', 'issueEmptyImpact', 'issueEmptySuggestion']
  }
  if (/^frame_\d+_cropped$/.test(code)) {
    return ['issueCropTitle', 'issueCropImpact', 'issueCropSuggestion']
  }
  if (/^source_region_empty:/.test(code)) {
    return ['issueRegionTitle', 'issueRegionImpact', 'issueRegionSuggestion']
  }
  return ['issueGenericTitle', 'issueGenericImpact', 'issueGenericSuggestion']
}

function renderIssueList(id, report, fallback = null) {
  const list = byId(id)
  if (!list) return
  list.replaceChildren()
  const messages = qualityMessages(report)
  if (!messages.length && fallback) messages.push(String(fallback))
  if (!messages.length) {
    const empty = document.createElement('p')
    empty.className = 'character-local-issue-empty'
    empty.textContent = localT('qualityNone')
    list.append(empty)
    return
  }
  for (const code of messages) {
    const [titleKey, impactKey, suggestionKey] = issueCopy(code)
    const article = document.createElement('article')
    const title = document.createElement('strong')
    const diagnostic = document.createElement('code')
    const impact = document.createElement('p')
    const suggestion = document.createElement('p')
    title.textContent = localT(titleKey)
    diagnostic.textContent = code
    impact.textContent = `${localT('issueImpact')} · ${localT(impactKey)}`
    suggestion.textContent = `${localT('issueSuggestion')} · ${localT(suggestionKey)}`
    article.append(title, diagnostic, impact, suggestion)
    list.append(article)
  }
}

function repairedFrameCount(report) {
  const normalization = report?.normalization ?? {}
  return [
    normalization.auto_correction?.applied_count,
    normalization.motion_stabilization?.applied_count,
    normalization.manual_adjustments?.applied_count,
  ].reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0)
}

function renderQuality() {
  const report = state.result?.debugReport ?? state.failureReport
  const validation = report?.validation
  setHidden('character-local-quality', !validation)
  if (!validation) return
  const status = ['pass', 'warning', 'fail'].includes(validation.status) ? validation.status : 'fail'
  const statusKey = status === 'pass' ? 'qualityPass' : status === 'warning' ? 'qualityWarning' : 'qualityFail'
  const badge = byId('character-local-quality-status')
  if (badge) {
    badge.textContent = localT(statusKey)
    badge.dataset.state = status
  }
  setText('character-local-quality-frames', String(validation.frame_count ?? report.frames?.length ?? '—'))
  setText('character-local-quality-repaired', String(repairedFrameCount(report)))
  setText('character-local-quality-findings', String(qualityMessages(report).length))
  const reportLink = byId('character-local-quality-link')
  if (reportLink) {
    const url = state.job?.debug_report_url
    if (url) reportLink.href = url
    else reportLink.removeAttribute('href')
  }
  renderIssueList('character-local-quality-issues', report)
}

function renderClipButtons() {
  const container = byId('character-local-clips')
  if (!container) return
  container.replaceChildren()
  const animations = state.result?.animations?.animations
  if (!animations) {
    const waiting = document.createElement('p')
    waiting.textContent = localT('clipsWaiting')
    container.append(waiting)
    return
  }
  for (const [name, animation] of Object.entries(animations)) {
    if (animation?.ui_hidden) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'character-local-clip'
    button.classList.toggle('is-active', name === preview.animationName)
    button.setAttribute('aria-pressed', String(name === preview.animationName))
    const title = document.createElement('strong')
    const detail = document.createElement('span')
    title.textContent = animation.display_label || animation.label || name
    detail.textContent = `${animation.frames.length}f · ${animation.fps ?? 8} FPS`
    button.append(title, detail)
    button.addEventListener('click', () => {
      preview.animationName = name
      const direction = name.split('_').at(-1)
      if (['down', 'up', 'left', 'right'].includes(direction)) preview.direction = direction
      preview.frameCursor = 0
      preview.lastFrameTime = 0
      renderClipButtons()
    })
    container.append(button)
  }
}

function renderExportLinks() {
  const release = state.phase === 'complete' ? state.result?.job : null
  for (const [id, field] of EXPORT_LINKS) {
    const link = byId(id)
    if (!link) continue
    const url = release?.[field]
    if (url) {
      link.href = url
      link.removeAttribute('aria-disabled')
      link.removeAttribute('tabindex')
    } else {
      link.removeAttribute('href')
      link.setAttribute('aria-disabled', 'true')
      link.tabIndex = -1
    }
  }
}

function openExportDialog() {
  if (state.phase !== 'complete') return
  const dialog = byId('character-local-export-dialog')
  if (!dialog) return
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal()
  } else {
    dialog.setAttribute('open', '')
  }
}

function closeExportDialog() {
  const dialog = byId('character-local-export-dialog')
  if (!dialog) return
  if (typeof dialog.close === 'function' && dialog.open) dialog.close()
  else dialog.removeAttribute('open')
}

function setControlValue(id, value) {
  const control = byId(id)
  if (control && control.value !== String(value ?? '')) control.value = String(value ?? '')
}

function setControlChecked(id, checked) {
  const control = byId(id)
  if (control) control.checked = Boolean(checked)
}

function renderFrameAdjustmentControls() {
  const frame = inputNumber('character-advanced-frame', 0)
  const adjustment = state.advancedSettings.frameAdjustments?.[frame] ?? { dx: 0, dy: 0 }
  setControlValue('character-advanced-nudge-x', adjustment.dx)
  setControlValue('character-advanced-nudge-y', adjustment.dy)
}

function renderCutLineEditor() {
  const layer = byId('character-advanced-cut-lines')
  const previewNode = byId('character-advanced-cut-preview')
  const image = byId('character-advanced-cut-image')
  if (!layer || !previewNode || !image) return
  const cuts = state.advancedSettings.manualCutLines
  image.src = state.sourceUrl ?? ''
  if (state.dimensions) previewNode.style.aspectRatio = `${state.dimensions.width} / ${state.dimensions.height}`
  layer.replaceChildren()
  if (!cuts) return
  const appendLine = (axis, position, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `character-cut-line ${axis}`
    button.dataset.axis = axis
    button.dataset.index = String(index)
    if (axis === 'vertical') button.style.left = `${(position / cuts.width) * 100}%`
    else button.style.top = `${(position / cuts.height) * 100}%`
    button.setAttribute('aria-label', localT(axis === 'vertical' ? 'cutVerticalAria' : 'cutHorizontalAria', { index: index + 1 }))
    button.addEventListener('pointerdown', (event) => startCutLineDrag(event, axis, index))
    button.addEventListener('keydown', (event) => {
      const delta = axis === 'vertical'
        ? event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
        : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
      if (!delta) return
      event.preventDefault()
      updateCutLines(moveAdvancedCutLine(
        state.advancedSettings.manualCutLines,
        axis,
        index,
        position + delta,
      ))
      requestAnimationFrame(() => {
        byId('character-advanced-cut-lines')
          ?.querySelector(`[data-axis="${axis}"][data-index="${index}"]`)
          ?.focus()
      })
    })
    layer.append(button)
  }
  cuts.verticalLines.forEach((position, index) => appendLine('vertical', position, index))
  cuts.horizontalLines.forEach((position, index) => appendLine('horizontal', position, index))
  const counts = cutLineCounts(cuts)
  setText('character-advanced-cut-count', localT('cutCount', {
    columns: counts.vertical + 1,
    rows: counts.horizontal + 1,
    regions: (counts.vertical + 1) * (counts.horizontal + 1),
  }))
  const confirm = byId('character-cut-confirm')
  if (confirm) confirm.disabled = counts.vertical !== 7 || counts.horizontal !== 7
}

function renderCalibrationPanel(locked) {
  const before = byId('character-calibration-before')
  const after = byId('character-calibration-after')
  if (before) {
    if (state.calibrationOriginal?.url ?? state.sourceUrl) before.src = state.calibrationOriginal?.url ?? state.sourceUrl
    else before.removeAttribute('src')
  }
  if (after) {
    const url = state.calibration?.previewUrl ?? (state.calibration?.active ? state.sourceUrl : null)
    if (url) after.src = url
    else after.removeAttribute('src')
  }
  const report = state.calibration?.report
  const busy = state.calibration?.busy
  const status = busy
    ? localT('calibrationBusy')
    : report?.missing_region_count > 0
      ? localT('calibrationIncomplete', { count: report.missing_region_count })
      : report
        ? localT('calibrationReady', { count: report.calibrated_region_count })
        : '—'
  setText('character-calibration-status', status)
  setText('character-calibration-report', report
    ? `${localT('calibrationReportMode')} · ${report.mode}\n${localT('calibrationReportRegions')} · ${report.calibrated_region_count}/${report.region_count}\n${localT('calibrationReportRemoved')} · ${report.removed_component_count}\n${localT('calibrationReportScale')} · ${Number(report.scale?.median ?? 0).toFixed(3)}`
    : '—')
  const canBuild = Boolean(state.file) &&
    state.advancedSettings.sourceLayout === FIXED_REGION_MOTION_LAYOUT_ID &&
    !state.calibrationOriginal
  const build = byId('character-calibration-build')
  if (build) build.disabled = locked || busy || !canBuild
  const use = byId('character-calibration-use')
  if (use) use.disabled = locked || busy || !report || report.missing_region_count !== 0 || !state.calibration?.previewFile
  const original = byId('character-calibration-original')
  if (original) original.disabled = locked || !state.calibrationOriginal
  const reset = byId('character-calibration-reset')
  if (reset) reset.disabled = locked || busy || (!report && !state.calibrationOriginal)
}

function renderAdvancedPanels() {
  const advanced = state.processingMode === 'advanced'
  const locked = ['running', 'submission_unknown'].includes(state.phase) || state.busy === 'decode'
  const panel = state.advancedPanel
  setHidden('character-advanced-config', panel !== 'config')
  setHidden('character-advanced-calibration', panel !== 'calibration')
  setHidden('character-advanced-cuts', panel !== 'cuts')
  const workspace = byId('character-local-workspace')
  if (workspace) {
    workspace.dataset.characterProcessingMode = state.processingMode
    if (panel) workspace.dataset.characterAdvancedPanel = panel
    else delete workspace.dataset.characterAdvancedPanel
  }
  const entry = byId('character-advanced-entry')
  if (entry) {
    entry.textContent = localT(advanced ? 'advancedModeActive' : 'advancedMode')
    entry.setAttribute('aria-pressed', String(advanced))
    entry.setAttribute('aria-expanded', String(Boolean(panel)))
    entry.disabled = locked
  }
  const settings = state.advancedSettings
  setControlValue('character-advanced-layout', settings.sourceLayout)
  setControlValue('character-advanced-background-mode', settings.backgroundMode)
  setControlValue('character-advanced-tolerance', settings.backgroundTolerance)
  setControlChecked('character-advanced-component-cleanup', settings.componentCleanup)
  setControlValue('character-advanced-min-alpha', settings.minAlpha)
  setControlValue('character-advanced-min-area', settings.minArea)
  setControlValue('character-advanced-min-area-ratio', settings.minAreaRatio)
  setControlChecked('character-advanced-pixel-finishing', settings.pixelFinishing)
  setControlValue('character-advanced-max-colors', settings.pixelFinishingMaxColors)
  setControlChecked('character-advanced-outline', settings.pixelFinishingOutline)
  setControlValue('character-advanced-outline-mode', settings.pixelFinishingOutlineMode)
  setControlValue('character-advanced-anchor-x', settings.anchorOffset.x)
  setControlValue('character-advanced-anchor-y', settings.anchorOffset.y)
  setControlChecked('character-advanced-auto-correct', settings.autoCorrect)
  setControlChecked('character-advanced-motion-stabilize', settings.motionStabilize)
  setControlValue('character-advanced-motion-max-shift', settings.motionMaxShift)
  for (const scale of [1, 2, 3, 4]) {
    setControlChecked(`character-advanced-export-${scale}x`, settings.exportScales.includes(scale))
  }
  const locks = new Set(settings.lockedAnimations)
  for (const option of byId('character-advanced-locks')?.options ?? []) option.selected = locks.has(option.value)
  renderFrameAdjustmentControls()
  setText('character-advanced-black-name', state.blackFile?.name ?? '—')
  document.querySelectorAll('#character-advanced-config input, #character-advanced-config select, #character-advanced-config button').forEach((control) => {
    if (control.id === 'character-advanced-close') control.disabled = locked
    else control.disabled = locked || !serviceConnectionAvailable
  })
  const calibrationOpen = byId('character-advanced-calibration-open')
  if (calibrationOpen) {
    calibrationOpen.disabled = locked || !state.file || settings.sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID
    calibrationOpen.setAttribute('aria-expanded', String(panel === 'calibration'))
  }
  const cutsOpen = byId('character-advanced-cuts-open')
  if (cutsOpen) {
    cutsOpen.disabled = locked || !state.file || settings.sourceLayout !== 'topdown_rpg_v0'
    cutsOpen.setAttribute('aria-expanded', String(panel === 'cuts'))
  }
  const blackClear = byId('character-advanced-black-clear')
  if (blackClear) blackClear.disabled = locked || !state.blackFile
  const run = byId('character-advanced-run')
  if (run) {
    let valid = Boolean(state.file) && !locked && serviceConnectionAvailable
    if (valid) {
      try { currentInputKey() } catch { valid = false }
    }
    run.disabled = !valid
  }
  renderCalibrationPanel(locked)
  renderCutLineEditor()
  for (const id of [
    'character-cut-add-vertical',
    'character-cut-add-horizontal',
    'character-cut-even',
    'character-cut-clear',
  ]) {
    const button = byId(id)
    if (button) button.disabled = locked
  }
  document.querySelectorAll('.character-advanced-panel-close, .character-advanced-panel-back').forEach((button) => {
    button.disabled = locked
  })
  for (const line of byId('character-advanced-cut-lines')?.querySelectorAll('button') ?? []) {
    line.disabled = locked
  }
}

function renderStaticCopy() {
  document.querySelectorAll('[data-character-local-copy]').forEach((node) => {
    node.textContent = localT(node.dataset.characterLocalCopy)
  })
  document.querySelectorAll('[data-character-local-aria]').forEach((node) => {
    node.setAttribute('aria-label', localT(node.dataset.characterLocalAria))
  })
  document.querySelectorAll('[data-character-advanced-copy]').forEach((node) => {
    node.textContent = localT(node.dataset.characterAdvancedCopy)
  })
  document.querySelectorAll('[data-character-advanced-aria]').forEach((node) => {
    node.setAttribute('aria-label', localT(node.dataset.characterAdvancedAria))
  })
}

export function renderStudioCharacterLocal() {
  if (!localActive) return
  const workspace = byId('character-local-workspace')
  if (!workspace) return
  const presentation = deriveLocalCharacterPresentation()
  workspace.dataset.characterLocalPhase = presentation.phase
  renderStaticCopy()
  setText('character-header-crumb', localT('crumb'))
  setText('character-top-status', localT(presentation.statusKey))
  const topStatus = byId('character-top-status')
  if (topStatus) {
    topStatus.dataset.state = ['failed', 'submission_unknown'].includes(state.phase)
      ? 'error'
      : state.phase === 'running'
        ? 'loading'
        : state.phase === 'complete'
          ? 'ready'
          : 'idle'
    topStatus.setAttribute('aria-busy', String(state.phase === 'running'))
  }
  setText('character-local-stage-kicker', localT(presentation.kickerKey))
  setText('character-local-stage-title', localT(presentation.titleKey))
  setText('character-local-stage-help', localT(presentation.helpKey))
  setText('character-local-stage-phase', localT(presentation.statusKey))

  const hasSource = Boolean(state.file)
  const advanced = state.processingMode === 'advanced'
  const sourceHint = workspace.querySelector('.character-local-source > header span')
  const sourceDropHelp = byId('character-local-source-empty')?.querySelector('small')
  const flowSummary = workspace.querySelector('.character-local-flow-header p')
  const profileEyebrow = workspace.querySelector('.character-local-profile > .eyebrow')
  const profileTitle = byId('character-local-profile-title')
  if (sourceHint && advanced) sourceHint.textContent = localT('advancedSourceHint')
  if (flowSummary && advanced) flowSummary.textContent = localT('advancedFlowSummary')
  if (sourceDropHelp && advanced) sourceDropHelp.textContent = localT('advancedSourceDropHelp')
  if (profileEyebrow && advanced) profileEyebrow.textContent = localT('advancedProfileTitle')
  if (profileTitle && advanced) profileTitle.textContent = localT(
    state.advancedSettings.sourceLayout === FIXED_REGION_MOTION_LAYOUT_ID
      ? 'advancedProfileFixed'
      : 'advancedProfileTopdown',
  )
  setHidden('character-local-source-empty', hasSource)
  setHidden('character-local-source-selected', !hasSource)
  const sourceImage = byId('character-local-source-preview')
  if (sourceImage) {
    if (state.sourceUrl) sourceImage.src = state.sourceUrl
    else sourceImage.removeAttribute('src')
  }
  setText('character-local-source-name', state.file?.name ?? '—')
  setText('character-local-source-size', state.dimensions
    ? localT('dimensions', state.dimensions)
    : '—')
  setText('character-local-source-grid', hasSource
    ? advanced
      ? state.advancedSettings.sourceLayout === FIXED_REGION_MOTION_LAYOUT_ID
        ? localT('advancedProfileFixed')
        : localT('gridLocked')
      : localT('gridLocked')
    : '—')
  const name = byId('character-local-name')
  if (name && name.value !== state.name) name.value = state.name
  const locked = ['running', 'submission_unknown'].includes(state.phase)
  const detailLocked = locked || state.busy === 'decode'
  const fileControl = byId('character-local-file')
  if (fileControl) fileControl.disabled = !serviceConnectionAvailable || locked
  for (const id of ['character-local-name', 'character-local-clear']) {
    const control = byId(id)
    if (control) control.disabled = !serviceConnectionAvailable || detailLocked
  }
  const replace = byId('character-local-replace')
  if (replace) replace.classList.toggle('is-disabled', detailLocked || !serviceConnectionAvailable)

  setHidden('character-local-progress', state.phase !== 'running' && state.phase !== 'poll_paused')
  const progress = progressForState()
  const progressBar = byId('character-local-progress-bar')
  if (progressBar) progressBar.value = progress.value
  setText('character-local-progress-label', localT(progress.key))
  setText('character-local-progress-job', state.job?.id ? `${localT('jobLabel')} · ${state.job.id}` : '—')
  setHidden('character-local-failure', !['failed', 'submission_unknown'].includes(state.phase))
  renderIssueList(
    'character-local-failure-issues',
    state.failureReport,
    state.error || state.job?.reason || state.job?.status,
  )
  setHidden('character-local-preview', state.phase !== 'complete')
  const primary = byId('character-local-primary')
  if (primary) {
    primary.textContent = localT(
      advanced && presentation.action === 'build'
        ? 'advancedPrimary'
        : presentation.primaryKey,
    )
    primary.dataset.action = presentation.action
    let currentInputValid = true
    if (presentation.action === 'build') {
      try { currentInputValid = Boolean(currentInputKey()) } catch { currentInputValid = false }
    }
    primary.disabled = !serviceConnectionAvailable || Boolean(state.busy) || !currentInputValid || ['blocked', 'running'].includes(presentation.action)
  }
  const error = byId('character-local-error')
  if (error) {
    error.textContent = state.error || ''
    error.hidden = !state.error || ['failed', 'submission_unknown'].includes(state.phase)
  }

  renderAdvancedPanels()

  renderQuality()
  renderClipButtons()
  renderExportLinks()
  const topExport = byId('character-export-link')
  if (topExport) {
    if (presentation.releaseReady) {
      topExport.href = '#character-local-export-dialog'
      topExport.removeAttribute('aria-disabled')
      topExport.removeAttribute('tabindex')
      topExport.textContent = localT('exportReady')
    } else {
      topExport.removeAttribute('href')
      topExport.setAttribute('aria-disabled', 'true')
      topExport.tabIndex = -1
      topExport.textContent = localT('exportLocked')
    }
  }
}

export function renderStudioCharacterLocalLanguage() {
  renderStudioCharacterLocal()
}

export function setStudioCharacterLocalActive(active) {
  localActive = Boolean(active)
  if (!localActive) stopPreview()
  else {
    renderStudioCharacterLocal()
    startPreviewLoop()
  }
}

export function getStudioLocalCharacterProjectCandidate() {
  const result = state.phase === 'complete' ? state.result : null
  let currentKey = null
  try { currentKey = currentInputKey() } catch { return null }
  if (
    !result ||
    result.job?.status !== 'done' ||
    state.binding?.inputKey !== currentKey ||
    !result.job?.zip_url
  ) return null
  return Object.freeze({
    kind: 'character',
    jobId: result.job.id,
    sourceJobId: result.job.id,
    status: 'done',
    profile: 'topdown_rpg_v0',
    zipUrl: result.job.zip_url,
  })
}

function handleMovementKey(event, pressed) {
  if (!localActive || state.phase !== 'complete' || !MOVEMENT_KEYS.has(event.key)) return
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(event.target?.tagName)) return
  event.preventDefault()
  if (pressed) preview.keys.add(event.key)
  else preview.keys.delete(event.key)
}

function initAdvancedLocalControls() {
  const frame = byId('character-advanced-frame')
  if (frame && !frame.options.length) {
    for (let index = 0; index < 64; index += 1) {
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = `Frame ${index}`
      frame.append(option)
    }
  }
  const locks = byId('character-advanced-locks')
  if (locks && !locks.options.length) {
    for (const name of [
      'idle_down', 'idle_up', 'idle_left', 'idle_right',
      'walk_down', 'walk_up', 'walk_left', 'walk_right',
      'attack_down', 'attack_up', 'attack_left', 'attack_right',
      'hurt', 'happy', 'sit', 'talk',
    ]) {
      const option = document.createElement('option')
      option.value = name
      option.textContent = name
      locks.append(option)
    }
  }
  byId('character-advanced-entry')?.addEventListener('click', () => openAdvancedPanel('config'))
  byId('character-advanced-close')?.addEventListener('click', closeAdvancedPanel)
  document.querySelectorAll('.character-advanced-panel-close').forEach((button) => {
    button.addEventListener('click', closeAdvancedPanel)
  })
  document.querySelectorAll('.character-advanced-panel-back').forEach((button) => {
    button.addEventListener('click', () => openAdvancedPanel('config'))
  })
  byId('character-advanced-back-standard')?.addEventListener('click', returnToStandardImport)
  byId('character-advanced-run')?.addEventListener('click', () => void submitLocalJob())
  byId('character-advanced-black-file')?.addEventListener('change', (event) => {
    const file = event.currentTarget?.files?.[0]
    if (file) void selectBlackMatte(file)
  })
  byId('character-advanced-black-clear')?.addEventListener('click', clearBlackMatte)
  for (const id of [
    'character-advanced-layout',
    'character-advanced-background-mode',
    'character-advanced-tolerance',
    'character-advanced-component-cleanup',
    'character-advanced-min-alpha',
    'character-advanced-min-area',
    'character-advanced-min-area-ratio',
    'character-advanced-pixel-finishing',
    'character-advanced-max-colors',
    'character-advanced-outline',
    'character-advanced-outline-mode',
    'character-advanced-anchor-x',
    'character-advanced-anchor-y',
    'character-advanced-locks',
    'character-advanced-auto-correct',
    'character-advanced-motion-stabilize',
    'character-advanced-motion-max-shift',
    'character-advanced-export-1x',
    'character-advanced-export-2x',
    'character-advanced-export-3x',
    'character-advanced-export-4x',
  ]) byId(id)?.addEventListener('change', updateAdvancedSettingsFromControls)
  byId('character-advanced-frame')?.addEventListener('change', renderFrameAdjustmentControls)
  byId('character-advanced-nudge-save')?.addEventListener('click', () => updateFrameAdjustment(false))
  byId('character-advanced-nudge-clear')?.addEventListener('click', () => updateFrameAdjustment(true))
  byId('character-advanced-auto-grid')?.addEventListener('click', setAutomaticGrid)
  byId('character-advanced-calibration-open')?.addEventListener('click', () => openAdvancedPanel('calibration'))
  byId('character-advanced-cuts-open')?.addEventListener('click', () => openAdvancedPanel('cuts'))
  byId('character-calibration-build')?.addEventListener('click', () => void buildCalibrationPreview())
  byId('character-calibration-use')?.addEventListener('click', useCalibrationPreview)
  byId('character-calibration-original')?.addEventListener('click', () => restoreOriginalCalibration())
  byId('character-calibration-reset')?.addEventListener('click', resetCalibration)
  byId('character-cut-add-vertical')?.addEventListener('click', () => addCutLine('vertical'))
  byId('character-cut-add-horizontal')?.addEventListener('click', () => addCutLine('horizontal'))
  byId('character-cut-even')?.addEventListener('click', useEvenCutLines)
  byId('character-cut-clear')?.addEventListener('click', clearCutLines)
  byId('character-cut-confirm')?.addEventListener('click', confirmCutLines)
}

export function initStudioCharacterLocal({ serviceAvailable = true } = {}) {
  if (initialized) return
  initialized = true
  serviceConnectionAvailable = serviceAvailable
  const sourceInput = byId('character-local-file')
  if (sourceInput) sourceInput.accept = 'image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg'
  initAdvancedLocalControls()
  byId('character-local-file')?.addEventListener('change', (event) => {
    const file = event.currentTarget?.files?.[0]
    if (file) void selectSource(file)
  })
  byId('character-local-clear')?.addEventListener('click', () => clearSource())
  byId('character-local-name')?.addEventListener('input', (event) => {
    invalidateForName(event.currentTarget?.value)
  })
  byId('character-local-primary')?.addEventListener('click', handlePrimaryAction)
  byId('character-export-link')?.addEventListener('click', (event) => {
    if (!localActive) return
    event.preventDefault()
    if (state.phase === 'complete') openExportDialog()
  })
  byId('character-local-export-close')?.addEventListener('click', closeExportDialog)
  byId('character-local-export-dialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeExportDialog()
  })
  globalThis.addEventListener?.('keydown', (event) => handleMovementKey(event, true))
  globalThis.addEventListener?.('keyup', (event) => handleMovementKey(event, false))
  renderStudioCharacterLocal()
}
