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
  bindSharedCharacterResult,
  clearSharedCharacterResult,
  closeSharedCharacterExportDialog,
  createAiAcceptedSourceResultPresentation,
  createLocalCompleteResultPresentation,
  createLocalQualityOnlyPresentation,
  getSharedCharacterExportPresentation,
  getSharedCharacterResultOwner,
  openSharedCharacterExportDialog,
  queryAdvancedConfigControls,
  readSharedCharacterResultSnapshot,
  refreshSharedCharacterResultPresentation,
  ADVANCED_CONFIG_CONTROL_SELECTOR,
  stopSharedCharacterPreview,
} from './characterResultView.js'
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
import {
  bindCharacterComboboxKinds,
  closeAllCharacterComboboxes,
  registerCharacterCombobox,
  syncCharacterCombobox,
} from './characterCombobox.js'

const CHARACTER_LOCAL_COMBOBOX_KINDS = Object.freeze([
  'advancedLayout',
  'advancedBackgroundMode',
  'advancedOutlineMode',
  'advancedFrame',
])
registerCharacterCombobox('advancedLayout', {
  select: 'character-advanced-layout',
  trigger: 'character-advanced-layout-trigger',
  value: 'character-advanced-layout-value',
  list: 'character-advanced-layout-list',
  optionPrefix: 'character-advanced-layout-option',
  labelledBy: 'character-advanced-layout-label',
})
registerCharacterCombobox('advancedBackgroundMode', {
  select: 'character-advanced-background-mode',
  trigger: 'character-advanced-background-mode-trigger',
  value: 'character-advanced-background-mode-value',
  list: 'character-advanced-background-mode-list',
  optionPrefix: 'character-advanced-background-mode-option',
  labelledBy: 'character-advanced-background-mode-label',
})
registerCharacterCombobox('advancedOutlineMode', {
  select: 'character-advanced-outline-mode',
  trigger: 'character-advanced-outline-mode-trigger',
  value: 'character-advanced-outline-mode-value',
  list: 'character-advanced-outline-mode-list',
  optionPrefix: 'character-advanced-outline-mode-option',
  labelledBy: 'character-advanced-outline-mode-label',
})
registerCharacterCombobox('advancedFrame', {
  select: 'character-advanced-frame',
  trigger: 'character-advanced-frame-trigger',
  value: 'character-advanced-frame-value',
  list: 'character-advanced-frame-list',
  optionPrefix: 'character-advanced-frame-option',
  labelledBy: 'character-advanced-frame-label',
  scrollable: true,
})

function syncLocalCharacterComboboxes({ editable = true } = {}) {
  for (const kind of CHARACTER_LOCAL_COMBOBOX_KINDS) syncCharacterCombobox(kind, { editable })
}

const ADVANCED_ANIMATION_LOCK_OPTIONS = Object.freeze([
  ['idle_down', 'advancedLockIdleDown'],
  ['idle_up', 'advancedLockIdleUp'],
  ['idle_left', 'advancedLockIdleLeft'],
  ['idle_right', 'advancedLockIdleRight'],
  ['walk_down', 'advancedLockWalkDown'],
  ['walk_up', 'advancedLockWalkUp'],
  ['walk_left', 'advancedLockWalkLeft'],
  ['walk_right', 'advancedLockWalkRight'],
  ['attack_down', 'advancedLockAttackDown'],
  ['attack_up', 'advancedLockAttackUp'],
  ['attack_left', 'advancedLockAttackLeft'],
  ['attack_right', 'advancedLockAttackRight'],
  ['hurt', 'advancedLockHurt'],
  ['happy', 'advancedLockHappy'],
  ['sit', 'advancedLockSit'],
  ['talk', 'advancedLockTalk'],
])

const LOCAL_COPY = Object.freeze({
  en: Object.freeze({
    crumb: '· Local import',
    statusEmpty: 'Waiting for source',
    statusReady: 'Source ready',
    statusRunning: 'Local processing',
    statusPaused: 'Observation paused',
    statusUnknown: 'Submission outcome unknown',
    statusFailed: 'Processing blocked',
    statusComplete: 'Quality passed · export ready',
    exportLocked: 'Process before export',
    exportReady: 'Export',
    flowEyebrow: 'Current flow',
    flowTitle: 'Local sprite-sheet import',
    flowSummary: 'Upload a sheet, bind layout and parameters, then start processing.',
    sourceTitle: 'Sprite sheet',
    sourceHint: 'PNG / WebP / JPEG · up to 32 MiB',
    sourceDrop: 'Choose a sprite sheet',
    sourceDropHelp: 'Choose the maintained 8 × 8 or fixed-region layout below.',
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
    advancedMode: 'Advanced processing',
    advancedModeHelp: 'JPEG, fixed-region layout, matte pairing, calibration, cut lines, and maintained tuning.',
    advancedModeActive: 'Advanced processing · current input bound',
    advancedSourceHint: 'PNG / WebP / JPEG · up to 32 MiB',
    advancedFlowSummary: 'Upload a sheet, bind layout and parameters, then start processing.',
    advancedSourceDropHelp: 'Choose the maintained 8 × 8 or fixed-region layout below.',
    advancedProfileTitle: 'Current values',
    advancedProfileFixed: 'Fixed-region motion source',
    advancedProfileTopdown: 'Standard RPG topdown · 8 × 8',
    advancedPrimary: 'Start processing',
    advancedConfigKicker: 'Current input binding',
    advancedConfigTitle: 'Processing parameters',
    advancedConfigHelp: 'Changing a file or parameter immediately revokes the prior Job, exports, and Project candidate.',
    advancedSourceLayout: 'Source layout',
    advancedLayoutTopdown: 'Standard RPG · 8 × 8',
    advancedLayoutFixed: 'Fixed-region motion source',
    advancedBlackMatte: 'Black-matte pairing',
    advancedBlackChoose: 'Choose matching matte',
    advancedBlackClear: 'Clear matte',
    advancedBackground: 'Background & cleanup',
    advancedBackgroundMode: 'Background mode',
    advancedBackgroundAuto: 'Automatic',
    advancedBackgroundFlood: 'Solid-color flood removal',
    advancedBackgroundEdgePalette: 'Edge-palette removal',
    advancedBackgroundAlpha: 'Alpha cleanup',
    advancedBackgroundDualMatte: 'White/black matte pair',
    advancedTolerance: 'Tolerance',
    advancedMinAlpha: 'Min alpha',
    advancedMinArea: 'Min area',
    advancedMinAreaRatio: 'Min area ratio',
    advancedCleanupToggle: 'Component cleanup',
    advancedPixel: 'Pixel finishing',
    advancedMaxColors: 'Max colors',
    advancedOutline: 'Outline',
    advancedOutlineMode: 'Outline mode',
    advancedOutlineOuter: 'Outer outline',
    advancedOutlineInner: 'Inner outline',
    advancedOutlineBoth: 'Inner + outer outline',
    advancedGeometry: 'Frames & anchors',
    advancedAnchorX: 'Anchor X',
    advancedAnchorY: 'Anchor Y',
    advancedFrame: 'Frame',
    advancedFrameOption: 'Frame {index}',
    advancedNudgeX: 'Nudge X',
    advancedNudgeY: 'Nudge Y',
    advancedSaveNudge: 'Save nudge',
    advancedClearNudge: 'Clear nudge',
    advancedAnimationLocks: 'Animation lock (no stabilization)',
    advancedLockIdleDown: 'Idle · Down',
    advancedLockIdleUp: 'Idle · Up',
    advancedLockIdleLeft: 'Idle · Left',
    advancedLockIdleRight: 'Idle · Right',
    advancedLockWalkDown: 'Walk · Down',
    advancedLockWalkUp: 'Walk · Up',
    advancedLockWalkLeft: 'Walk · Left',
    advancedLockWalkRight: 'Walk · Right',
    advancedLockAttackDown: 'Attack · Down',
    advancedLockAttackUp: 'Attack · Up',
    advancedLockAttackLeft: 'Attack · Left',
    advancedLockAttackRight: 'Attack · Right',
    advancedLockHurt: 'Hurt',
    advancedLockHappy: 'Happy',
    advancedLockSit: 'Sit',
    advancedLockTalk: 'Talk',
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
    stageUnknownHelp: 'Automatic resubmission stays disabled to avoid creating duplicate work.',
    stageFailedKicker: 'Processing blocked',
    stageFailedTitle: 'Verified download is unavailable',
    stageFailedReportHelp: 'Review the Quality Report at the top right. Verified download stays locked.',
    stageFailedNoReportHelp: 'No Quality Report was returned. Verified download stays locked.',
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
    failureSubmissionUnknown: 'The service did not return an authoritative Job receipt, so this input cannot be submitted again automatically.',
    failureQualityBlocked: 'The quality check blocked this result.',
    failurePostProcessing: 'The service could not finish processing this result.',
    failureModel: 'The service did not produce a usable result.',
    failureSafety: 'The service stopped this result because it did not pass the safety check.',
    failureVerification: 'The Job finished, but its returned files could not be verified.',
    failureTimeout: 'The service response timed out before a verified result was available.',
    failureService: 'The service request ended without a verified result.',
    failureGeneric: 'Processing ended without a verified result.',
    failureDetail: 'Current task response: {detail}',
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
    statusFailed: '处理已阻断',
    statusComplete: '质量通过 · 可导出',
    exportLocked: '处理完成后导出',
    exportReady: '导出',
    flowEyebrow: '当前流程',
    flowTitle: '本地精灵表导入',
    flowSummary: '上传精灵表，绑定布局与参数后开始处理。',
    sourceTitle: '精灵表',
    sourceHint: 'PNG / WebP / JPEG · 最大 32 MiB',
    sourceDrop: '选择精灵表',
    sourceDropHelp: '在下方选择维护中的 8 × 8 或固定区域布局。',
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
    advancedMode: '高级处理',
    advancedModeHelp: 'JPEG、固定区域布局、黑底配对、校准、切线及维护中的高级参数。',
    advancedModeActive: '高级处理 · 当前输入已绑定',
    advancedSourceHint: 'PNG / WebP / JPEG · 最大 32 MiB',
    advancedFlowSummary: '上传精灵表，绑定布局与参数后开始处理。',
    advancedSourceDropHelp: '在下方选择维护中的 8 × 8 或固定区域布局。',
    advancedProfileTitle: '当前参数',
    advancedProfileFixed: '固定区域动作源图',
    advancedProfileTopdown: '标准 RPG 俯视 · 8 × 8',
    advancedPrimary: '开始处理',
    advancedConfigKicker: '当前输入绑定',
    advancedConfigTitle: '处理参数',
    advancedConfigHelp: '更换文件或参数会立即撤销旧任务、导出和 Project candidate。',
    advancedSourceLayout: '源布局',
    advancedLayoutTopdown: '标准 RPG · 8 × 8',
    advancedLayoutFixed: '固定区域动作源图',
    advancedBlackMatte: '黑底配对',
    advancedBlackChoose: '选择同尺寸黑底图',
    advancedBlackClear: '清除黑底图',
    advancedBackground: '背景与清理',
    advancedBackgroundMode: '背景模式',
    advancedBackgroundAuto: '自动检测',
    advancedBackgroundFlood: '纯色连通去背',
    advancedBackgroundEdgePalette: '边缘取色去背',
    advancedBackgroundAlpha: '透明通道清理',
    advancedBackgroundDualMatte: '黑白底配对',
    advancedTolerance: '容差',
    advancedMinAlpha: '最小 Alpha',
    advancedMinArea: '最小面积',
    advancedMinAreaRatio: '最小面积比例',
    advancedCleanupToggle: '组件清理',
    advancedPixel: '像素精修',
    advancedMaxColors: '最大颜色数',
    advancedOutline: '描边',
    advancedOutlineMode: '描边模式',
    advancedOutlineOuter: '外描边',
    advancedOutlineInner: '内描边',
    advancedOutlineBoth: '内外描边',
    advancedGeometry: '帧与锚点',
    advancedAnchorX: '锚点 X',
    advancedAnchorY: '锚点 Y',
    advancedFrame: '帧',
    advancedFrameOption: '帧 {index}',
    advancedNudgeX: '逐帧位移 X',
    advancedNudgeY: '逐帧位移 Y',
    advancedSaveNudge: '保存位移',
    advancedClearNudge: '清除位移',
    advancedAnimationLocks: '动画锁（不参与稳定）',
    advancedLockIdleDown: '待机 · 向下',
    advancedLockIdleUp: '待机 · 向上',
    advancedLockIdleLeft: '待机 · 向左',
    advancedLockIdleRight: '待机 · 向右',
    advancedLockWalkDown: '行走 · 向下',
    advancedLockWalkUp: '行走 · 向上',
    advancedLockWalkLeft: '行走 · 向左',
    advancedLockWalkRight: '行走 · 向右',
    advancedLockAttackDown: '攻击 · 向下',
    advancedLockAttackUp: '攻击 · 向上',
    advancedLockAttackLeft: '攻击 · 向左',
    advancedLockAttackRight: '攻击 · 向右',
    advancedLockHurt: '受伤',
    advancedLockHappy: '开心',
    advancedLockSit: '坐下',
    advancedLockTalk: '说话',
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
    stageUnknownHelp: '为避免创建重复任务，自动重新提交保持禁用。',
    stageFailedKicker: '处理已阻断',
    stageFailedTitle: '已验证下载不可用',
    stageFailedReportHelp: '可在右上角质量报告中查看明细；已验证下载保持锁定。',
    stageFailedNoReportHelp: '服务端未返回质量报告；已验证下载保持锁定。',
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
    failureSubmissionUnknown: '服务端没有返回权威任务回执，因此不能自动再次提交这个输入。',
    failureQualityBlocked: '质量检查阻止了这个结果。',
    failurePostProcessing: '服务端未能完成这个结果的后处理。',
    failureModel: '服务端没有生成可用结果。',
    failureSafety: '这个结果未通过安全检查，服务端已停止处理。',
    failureVerification: '任务已经完成，但返回的文件未能通过核验。',
    failureTimeout: '服务端响应超时，尚未得到已验证结果。',
    failureService: '服务请求结束时没有得到已验证结果。',
    failureGeneric: '处理结束时没有得到已验证结果。',
    failureDetail: '当前任务返回：{detail}',
    errorSourceRead: '无法解码所选图像。',
    errorSourceRequired: '请先选择 PNG 或 WebP 精灵表。',
    errorName: '请输入有效的资源名称。',
    errorGeneric: '本地处理已停止：{detail}',
    previewState: '{animation} · x {x} · y {y}',
    previewAria: '可试玩的已核验角色预览。使用 WASD 或方向键移动。',
  }),
})

const LOCAL_FAILURE_STATUS_KEYS = Object.freeze({
  failed_quality_gate: 'failureQualityBlocked',
  failed_post_processing: 'failurePostProcessing',
  failed_model_error: 'failureModel',
  failed_safety_filter: 'failureSafety',
  done: 'failureVerification',
})

const LOCAL_FAILURE_ERROR_KEYS = Object.freeze({
  quality_gate_blocked: 'failureQualityBlocked',
  request_timeout: 'failureTimeout',
  fetch_unavailable: 'failureService',
  request_failed: 'failureService',
  http_error: 'failureService',
  job_not_found: 'failureService',
  invalid_job_receipt: 'failureVerification',
  job_binding_mismatch: 'failureVerification',
  job_not_terminal: 'failureVerification',
  invalid_quality_report: 'failureVerification',
  invalid_animations: 'failureVerification',
  source_layout_binding_mismatch: 'failureVerification',
  response_size_exceeded: 'failureVerification',
  invalid_json_response: 'failureVerification',
  invalid_text_response: 'failureVerification',
})

const LOCAL_ADVANCED_CONFIG_CONTROL_SELECTOR = ADVANCED_CONFIG_CONTROL_SELECTOR

let initialized = false
let serviceConnectionAvailable = true
let processingActive = true
let processingSurfaceActive = true
let operationEpoch = 0
let sourceSelectionEpoch = 0
let blackSelectionEpoch = 0
let calibrationEpoch = 0
let selectedAdjustmentFrame = 0
let advancedPanelReturnFocus = null
let activeController = null
let state = createInitialLocalCharacterState()

export { LOCAL_ADVANCED_CONFIG_CONTROL_SELECTOR }

function localMutationAllowed() {
  return processingActive
    && !['running', 'submission_unknown'].includes(state.phase)
    && state.busy !== 'decode'
    && !state.calibration?.busy
}

function renderProcessingSurface() {
  if (processingSurfaceActive) renderStudioCharacterLocal()
}

function byId(id) {
  return globalThis.document?.getElementById?.(id) ?? null
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

export function createInitialLocalCharacterState() {
  return {
    phase: 'empty',
    busy: null,
    file: null,
    sourceUrl: null,
    sourceOrigin: null,
    sourceProvenance: null,
    dimensions: null,
    name: '',
    processingMode: 'advanced',
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
    failureReasonKey: null,
    error: null,
  }
}

function isLocalCharacterQualityReport(value) {
  const validation = value?.validation
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    validation &&
    typeof validation === 'object' &&
    !Array.isArray(validation) &&
    ['pass', 'warning', 'fail'].includes(validation.status) &&
    Array.isArray(validation.warnings) &&
    Array.isArray(validation.blocking_errors)
  )
}

function localCharacterFailureReasonKey({ phase, error, job, failureReport } = {}) {
  if (phase === 'submission_unknown') return 'failureSubmissionUnknown'
  const errorKey = LOCAL_FAILURE_ERROR_KEYS[String(error?.code ?? '')]
  if (errorKey) return errorKey
  const statusKey = LOCAL_FAILURE_STATUS_KEYS[String(job?.status ?? '')]
  if (statusKey) return statusKey
  if (isLocalCharacterQualityReport(failureReport)) return 'failureQualityBlocked'
  return 'failureGeneric'
}

export function createLocalCharacterFailureState(value, {
  phase = 'failed',
  job = value?.job ?? null,
  error = null,
  errorMessage = null,
  failureReport = null,
} = {}) {
  const verifiedReport = isLocalCharacterQualityReport(failureReport)
    ? failureReport
    : isLocalCharacterQualityReport(error?.payload)
      ? error.payload
      : null
  return {
    ...value,
    phase,
    busy: null,
    job,
    result: null,
    failureReport: verifiedReport,
    failureReasonKey: localCharacterFailureReasonKey({
      phase,
      error,
      job,
      failureReport: verifiedReport,
    }),
    error: errorMessage ?? String(error?.message || error || ''),
  }
}

export function deriveLocalCharacterBlockingPresentation(value, language = 'en') {
  if (!['failed', 'submission_unknown'].includes(value?.phase)) return null
  const failureReport = isLocalCharacterQualityReport(value?.failureReport)
    ? value.failureReport
    : null
  const reasonKey = value?.failureReasonKey ?? localCharacterFailureReasonKey({
    phase: value?.phase,
    job: value?.job,
    failureReport,
  })
  const locale = language === 'en' ? 'en' : 'zh'
  return Object.freeze({
    reasonKey,
    reason: LOCAL_COPY[locale][reasonKey] ?? LOCAL_COPY.en[reasonKey] ?? reasonKey,
    hasQualityReport: Boolean(failureReport),
  })
}

export function deriveLocalCharacterVisibleError(value, language = 'en') {
  const blocking = deriveLocalCharacterBlockingPresentation(value, language)
  const detail = String(value?.error ?? '').trim()
  if (!blocking) return detail
  if (!detail || detail === blocking.reason) return blocking.reason

  const receiptCodes = new Set([
    value?.job?.status,
    value?.job?.failure_status,
  ].filter(Boolean).map((entry) => String(entry).trim()))
  const isBareMachineCode = /^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(detail)
  if (receiptCodes.has(detail) || isBareMachineCode) return blocking.reason

  const locale = language === 'en' ? 'en' : 'zh'
  const template = LOCAL_COPY[locale].failureDetail ?? LOCAL_COPY.en.failureDetail
  const detailCopy = template.replace('{detail}', detail)
  return `${blocking.reason} ${detailCopy}`
}

export function deriveLocalCharacterPresentation(value = state) {
  const phase = value?.phase ?? 'empty'
  const hasFailureReport = isLocalCharacterQualityReport(value?.failureReport)
  const copy = {
    empty: ['statusEmpty', 'stageEmptyKicker', 'stageEmptyTitle', 'stageEmptyHelp', 'primaryStart', 'blocked'],
    ready: ['statusReady', 'stageReadyKicker', 'stageReadyTitle', 'stageReadyHelp', 'primaryStart', 'build'],
    running: ['statusRunning', 'stageRunningKicker', 'stageRunningTitle', 'stageRunningHelp', 'primaryRunning', 'running'],
    poll_paused: ['statusPaused', 'stagePausedKicker', 'stagePausedTitle', 'stagePausedHelp', 'primaryResume', 'resume'],
    submission_unknown: ['statusUnknown', 'stageUnknownKicker', 'stageUnknownTitle', 'stageUnknownHelp', 'primaryUnknown', 'blocked'],
    failed: ['statusFailed', 'stageFailedKicker', 'stageFailedTitle', hasFailureReport ? 'stageFailedReportHelp' : 'stageFailedNoReportHelp', 'primaryRetry', 'build'],
    complete: ['statusComplete', 'stageCompleteKicker', 'stageCompleteTitle', 'stageCompleteHelp', 'exportReady', 'export'],
  }[phase] ?? ['statusFailed', 'stageFailedKicker', 'stageFailedTitle', 'stageFailedNoReportHelp', 'primaryRetry', 'blocked']
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
    return JSON.stringify({
      processingFingerprint: advancedLocalInputFingerprint({
        file: value.file,
        blackFile,
        options,
        inputEpoch: value.inputEpoch,
      }),
      sourceOrigin: value.sourceOrigin ?? 'local',
      sourceProvenance: value.sourceProvenance ?? null,
    })
  }
  return JSON.stringify({
    epoch: value.inputEpoch,
    fileName: value.file.name,
    fileSize: value.file.size,
    fileType: value.file.type,
    sourceOrigin: value.sourceOrigin ?? 'local',
    sourceProvenance: value.sourceProvenance ?? null,
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

function clearVerifiedResult() {
  stopSharedCharacterPreview()
  closeSharedCharacterExportDialog()
  if (getSharedCharacterResultOwner() === 'local') clearSharedCharacterResult({ owner: 'local' })
}

function abandonLocalTemporaryWork() {
  blackSelectionEpoch += 1
  if (state.busy === 'decode') {
    sourceSelectionEpoch += 1
    blackSelectionEpoch += 1
    calibrationEpoch += 1
    revokeInputUrls()
    state = {
      ...state,
      busy: null,
      file: null,
      sourceUrl: null,
      dimensions: null,
      blackFile: null,
      blackUrl: null,
      blackDimensions: null,
      error: null,
    }
  }
  if (state.calibration?.busy) {
    calibrationEpoch += 1
    revokeUrl(state.calibration.previewUrl)
    state = {
      ...state,
      calibration: {
        ...state.calibration,
        busy: false,
        previewFile: null,
        previewUrl: null,
        report: null,
      },
    }
  }
}

function persistLocalOwnedState(patch) {
  state = { ...state, ...patch }
  renderProcessingSurface()
}

function setState(patch) {
  persistLocalOwnedState(patch)
}

function errorDetail(error) {
  if (error?.code === 'source_required') {
    return localT(state.processingMode === 'advanced' ? 'errorAdvancedSourceRequired' : 'errorSourceRequired')
  }
  if (error?.code === 'name_invalid') return localT('errorName')
  return localT('errorGeneric', { detail: String(error?.message || error || 'unknown') })
}

let imageDimensionLoader = null
let calibrationDecodeLoader = null

export function setLocalCharacterImageDimensionLoader(loader) {
  imageDimensionLoader = typeof loader === 'function' ? loader : null
}

export function setLocalCharacterCalibrationDecoder(loader) {
  calibrationDecodeLoader = typeof loader === 'function' ? loader : null
}

function objectUrlForFile(file) {
  return globalThis.URL?.createObjectURL?.(file) ?? null
}

function readImageDimensions(url) {
  if (imageDimensionLoader) return Promise.resolve(imageDimensionLoader(url))
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

async function selectSource(file, {
  sourceOrigin = 'local',
  sourceProvenance = null,
  signal,
  transactional = false,
  allowActiveRunSupersession = false,
} = {}) {
  const supersedingActiveRun = allowActiveRunSupersession
    && ['running', 'submission_unknown'].includes(state.phase)
    && state.busy !== 'decode'
    && !state.calibration?.busy
  if ((!localMutationAllowed() && !supersedingActiveRun) || signal?.aborted) return false
  if (supersedingActiveRun) {
    activeController?.abort()
    operationEpoch += 1
    state = {
      ...state,
      phase: state.job ? 'poll_paused' : 'submission_unknown',
      busy: null,
      result: null,
      failureReport: null,
      failureReasonKey: null,
      error: null,
    }
  }
  const selectionEpoch = ++sourceSelectionEpoch
  blackSelectionEpoch += 1
  calibrationEpoch += 1
  activeController?.abort()
  operationEpoch += 1
  const previousMode = state.processingMode
  const previousSettings = state.advancedSettings
  const previousPanel = state.advancedPanel
  const previousState = state
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
  const nextInputEpoch = state.inputEpoch + 1
  if (!transactional) {
    revokeInputUrls()
    clearVerifiedResult()
    state = {
      ...createInitialLocalCharacterState(),
      busy: 'decode',
      processingMode: nextMode,
      advancedPanel: nextMode === 'advanced' ? previousPanel : null,
      advancedSettings: previousSettings,
      sourceOrigin,
      sourceProvenance,
      inputEpoch: nextInputEpoch,
    }
    renderProcessingSurface()
  }
  let nextUrl = null
  try {
    if (nextMode === 'advanced') validateAdvancedLocalSourceFile(file)
    else validateLocalCharacterFile(file)
    nextUrl = objectUrlForFile(file)
    if (!nextUrl) throw new Error(localT('errorSourceRead'))
    const dimensions = await readImageDimensions(nextUrl)
    if (selectionEpoch !== sourceSelectionEpoch || signal?.aborted) {
      globalThis.URL?.revokeObjectURL?.(nextUrl)
      return false
    }
    if (!processingActive) {
      globalThis.URL?.revokeObjectURL?.(nextUrl)
      return false
    }
    if (transactional) {
      revokeInputUrls(previousState)
      clearVerifiedResult()
    }
    const commitMode = transactional ? state.processingMode : nextMode
    const commitPanel = transactional ? state.advancedPanel : previousPanel
    const commitSettings = transactional ? state.advancedSettings : previousSettings
    const commitInputEpoch = transactional ? state.inputEpoch + 1 : nextInputEpoch
    state = {
      ...createInitialLocalCharacterState(),
      phase: 'ready',
      file,
      sourceUrl: nextUrl,
      sourceOrigin,
      sourceProvenance,
      dimensions,
      name: defaultName(file),
      processingMode: commitMode,
      advancedPanel: commitMode === 'advanced' ? commitPanel : null,
      advancedSettings: settingsForSource(commitSettings, dimensions),
      inputEpoch: commitInputEpoch,
    }
    renderProcessingSurface()
    return true
  } catch (error) {
    if (nextUrl) globalThis.URL?.revokeObjectURL?.(nextUrl)
    if (selectionEpoch !== sourceSelectionEpoch || !processingActive || signal?.aborted) return false
    if (transactional) return false
    setState({ busy: null, error: errorDetail(error) })
    return false
  }
}

function clearSource({
  processingMode = state.processingMode,
  advancedPanel = state.advancedPanel,
} = {}) {
  if (!localMutationAllowed()) return
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
  renderProcessingSurface()
}

function invalidateForName(name) {
  if (!localMutationAllowed()) return
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
    failureReasonKey: null,
    error: null,
  }
  renderProcessingSurface()
}

function invalidateInputState(patch = {}) {
  if (!localMutationAllowed()) return false
  clearVerifiedResult()
  state = invalidateAdvancedLocalResultState(state, { ...patch, failureReasonKey: null })
  renderProcessingSurface()
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
  if (!localMutationAllowed()) return
  if (panel === 'config') {
    if (state.processingMode !== 'advanced') {
      invalidateInputState({ processingMode: 'advanced', advancedPanel: null })
    } else {
      setState({ advancedPanel: null, error: null })
    }
    queueMicrotask(() => byId('character-advanced-title')?.focus())
    return
  }
  if (!state.advancedPanel) advancedPanelReturnFocus = document.activeElement
  if (state.processingMode !== 'advanced') {
    invalidateInputState({ processingMode: 'advanced', advancedPanel: panel })
  } else {
    setState({ advancedPanel: panel, error: null })
  }
  const headingId = {
    calibration: 'character-calibration-title',
    cuts: 'character-cuts-title',
  }[panel]
  queueMicrotask(() => byId(headingId)?.focus())
}

function closeAdvancedPanel() {
  if (!localMutationAllowed()) return
  setState({ advancedPanel: null })
  const returnFocus = advancedPanelReturnFocus ?? byId('character-advanced-title')
  advancedPanelReturnFocus = null
  queueMicrotask(() => returnFocus?.focus?.())
}

function returnToStandardImport() {
  if (!localMutationAllowed()) return
  if (state.processingMode === 'standard') {
    closeAdvancedPanel()
    return
  }
  if (state.file && !canUseStandardLocalSource(state.file)) {
    clearSource({ processingMode: 'standard', advancedPanel: null })
    advancedPanelReturnFocus = null
    queueMicrotask(() => byId('character-advanced-title')?.focus())
    return
  }
  invalidateInputState({ processingMode: 'standard', advancedPanel: null })
  advancedPanelReturnFocus = null
  queueMicrotask(() => byId('character-advanced-title')?.focus())
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
  if (!localMutationAllowed()) return
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
  if (!localMutationAllowed()) return
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
    if (!localMutationAllowed() || !canCommitAdvancedBlackMatteSelection({
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
    renderProcessingSurface()
  } catch (error) {
    if (url) revokeUrl(url)
    if (!localMutationAllowed() || !canCommitAdvancedBlackMatteSelection({
      selectionEpoch,
      currentSelectionEpoch: blackSelectionEpoch,
      backgroundMode: state.advancedSettings.backgroundMode,
    })) return
    setState({ blackFile: null, blackUrl: null, blackDimensions: null, error: errorDetail(error) })
  }
}

function clearBlackMatte() {
  if (!localMutationAllowed()) return
  blackSelectionEpoch += 1
  revokeUrl(state.blackUrl)
  invalidateInputState({ blackFile: null, blackUrl: null, blackDimensions: null })
  const input = byId('character-advanced-black-file')
  if (input) input.value = ''
}

function updateFrameAdjustment(clear = false) {
  if (!localMutationAllowed()) return
  const frame = selectedAdjustmentFrame
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
  if (!localMutationAllowed()) return
  invalidateInputState({
    processingMode: 'advanced',
    advancedSettings: { ...state.advancedSettings, manualCutLinesEnabled: false },
  })
}

async function decodeFileToStageRgba(file) {
  if (calibrationDecodeLoader) return calibrationDecodeLoader(file)
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
    !localMutationAllowed() ||
    !state.file ||
    state.advancedSettings.sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID ||
    state.calibration?.busy
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
      !processingActive ||
      state.advancedSettings.sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID
    ) return
    const staged = stageTemplateCalibrationSource(decoded)
    const calibrated = calibrateFixedRegionTemplateImage(staged.image)
    const blob = await rgbaToPngBlob(calibrated.image)
    if (
      operation !== calibrationEpoch ||
      sourceEpoch !== sourceSelectionEpoch ||
      state.file !== file ||
      !processingActive ||
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
      !processingActive ||
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
    renderProcessingSurface()
  } catch (error) {
    if (previewUrl) revokeUrl(previewUrl)
    if (operation !== calibrationEpoch || !processingActive) return
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
    !localMutationAllowed() ||
    !calibration?.previewFile ||
    !calibration.previewUrl ||
    calibration.report?.missing_region_count !== 0 ||
    calibration.sourceInputEpoch !== sourceSelectionEpoch
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
  renderProcessingSurface()
}

function restoreOriginalCalibration({ render = true } = {}) {
  if (!localMutationAllowed()) return false
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
  if (render) renderProcessingSurface()
  return true
}

function resetCalibration() {
  if (!localMutationAllowed()) return
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
  if (!localMutationAllowed()) return
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
  if (!localMutationAllowed() || !state.dimensions) return
  const current = state.advancedSettings.manualCutLines ?? makeEvenAdvancedCutLines(
    state.dimensions.width,
    state.dimensions.height,
  )
  updateCutLines(addAdvancedCutLine(current, axis), { enable: false })
}

function clearCutLines() {
  if (!localMutationAllowed() || !state.dimensions) return
  updateCutLines({
    width: state.dimensions.width,
    height: state.dimensions.height,
    verticalLines: [],
    horizontalLines: [],
  }, { enable: false })
}

function useEvenCutLines() {
  if (!localMutationAllowed() || !state.dimensions) return
  updateCutLines(makeEvenAdvancedCutLines(state.dimensions.width, state.dimensions.height), { enable: false })
}

function confirmCutLines() {
  if (!localMutationAllowed() || !state.dimensions) return
  const counts = cutLineCounts(state.advancedSettings.manualCutLines)
  if (counts.vertical !== 7 || counts.horizontal !== 7) {
    setState({ error: errorDetail(new Error('Manual cut lines require exactly seven positions on each axis')) })
    return
  }
  updateCutLines(state.advancedSettings.manualCutLines, { enable: true })
  setState({ advancedPanel: null })
}

function startCutLineDrag(event, axis, index) {
  if (!localMutationAllowed()) return
  event.preventDefault()
  const previewNode = byId('character-advanced-cut-preview')
  const rect = previewNode?.getBoundingClientRect?.()
  if (!rect?.width || !rect?.height) return
  updateCutLines(state.advancedSettings.manualCutLines, {
    enable: state.advancedSettings.manualCutLinesEnabled,
  })
  const move = (moveEvent) => {
    if (!localMutationAllowed()) return
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
    if (localMutationAllowed()) renderProcessingSurface()
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop, { once: true })
}

async function bindLocalSharedResult() {
  if (!processingSurfaceActive) return
  const keepAcceptedSourceVisible = ['ready', 'submission_unknown'].includes(state.phase)
    && state.sourceOrigin === 'ai'
    && state.sourceUrl
  if (keepAcceptedSourceVisible) {
    const presentation = createAiAcceptedSourceResultPresentation(state.sourceUrl)
    const current = getSharedCharacterExportPresentation()
    if (
      getSharedCharacterResultOwner() === 'ai'
      && current.bindKey === presentation.bindKey
      && current.acceptedStatic
      && !current.hydrateError
    ) {
      refreshSharedCharacterResultPresentation()
      return
    }
    await bindSharedCharacterResult(presentation, { owner: 'ai' })
    return
  }
  if (getSharedCharacterResultOwner() !== 'local') clearSharedCharacterResult({ force: true })
  if (state.phase === 'complete' && state.result) {
    const presentation = createLocalCompleteResultPresentation(state.result)
    const current = getSharedCharacterExportPresentation()
    const runtime = readSharedCharacterResultSnapshot()
    if (
      getSharedCharacterResultOwner() === 'local'
      && current.bindKey === presentation.bindKey
      && current.playable
      && current.exportUnlocked
      && !current.hydrateError
      && runtime.playable
    ) {
      refreshSharedCharacterResultPresentation()
      return
    }
    await bindSharedCharacterResult(presentation, { owner: 'local' })
    return
  }
  if (['failed', 'submission_unknown'].includes(state.phase) && state.failureReport) {
    await bindSharedCharacterResult(
      createLocalQualityOnlyPresentation(state.failureReport, state.job?.debug_report_url),
      { owner: 'local' },
    )
    return
  }
  clearSharedCharacterResult({ owner: 'local' })
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
    if (!isCurrentOperation(operation.epoch) || state.binding?.inputKey !== currentInputKey()) return
    setState({
      phase: 'complete',
      busy: null,
      job: terminalJob,
      result,
      failureReport: null,
      failureReasonKey: null,
      error: null,
    })
    return
  }
  let failureReport = null
  try {
    failureReport = await fetchLocalCharacterFailureReport(terminalJob, { signal: operation.signal })
  } catch (error) {
    if (isRecoverableLocalCharacterObservationError(error)) throw error
  }
  if (!isCurrentOperation(operation.epoch)) return
  setState(createLocalCharacterFailureState(state, {
    job: terminalJob,
    failureReport,
    errorMessage: terminalJob.reason || terminalJob.failure_status || terminalJob.status,
  }))
}

async function observeLocalJob(initialJob, operation) {
  const terminalJob = await pollLocalCharacterJob(initialJob, {
    signal: operation.signal,
    onUpdate(job) {
      if (!isCurrentOperation(operation.epoch)) return
      persistLocalOwnedState({ phase: 'running', busy: 'observe', job, error: null })
    },
  })
  if (!isCurrentOperation(operation.epoch)) return
  await finishObservedJob(terminalJob, operation)
}

async function submitLocalJob() {
  if (!processingSurfaceActive || !localMutationAllowed() || !serviceConnectionAvailable || !state.file) {
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
  queueMicrotask(() => {
    if (processingSurfaceActive) byId('character-stage-title')?.focus()
  })
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
    persistLocalOwnedState({ busy: 'observe', job: receivedJob })
    await observeLocalJob(receivedJob, operation)
  } catch (error) {
    if (!isCurrentOperation(operation.epoch) || error?.name === 'AbortError') return
    if (receivedJob && isRecoverableLocalCharacterObservationError(error)) {
      persistLocalOwnedState({ phase: 'poll_paused', busy: null, error: errorDetail(error) })
      return
    }
    persistLocalOwnedState(createLocalCharacterFailureState(state, {
      phase: receivedJob ? 'failed' : 'submission_unknown',
      job: state.job ?? receivedJob,
      error,
      errorMessage: errorDetail(error),
    }))
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
    failureReasonKey: null,
    error: null,
  }
}

async function resumeLocalJob() {
  if (!processingActive || !state.job || state.phase !== 'poll_paused') return
  const operation = beginOperation()
  const job = state.job
  setState({ phase: 'running', busy: 'observe', error: null })
  try {
    await observeLocalJob(job, operation)
  } catch (error) {
    if (!isCurrentOperation(operation.epoch) || error?.name === 'AbortError') return
    if (isRecoverableLocalCharacterObservationError(error)) {
      setState({ phase: 'poll_paused', busy: null, error: errorDetail(error) })
      return
    }
    setState(createLocalCharacterFailureState(state, {
      job: state.job,
      error,
      errorMessage: errorDetail(error),
    }))
  }
}

function handlePrimaryAction() {
  if (!processingActive || !processingSurfaceActive) return
  const action = deriveLocalCharacterPresentation().action
  if (action === 'build') void submitLocalJob()
  else if (action === 'resume') void resumeLocalJob()
  else if (action === 'export') openSharedCharacterExportDialog()
}

export function deriveLocalCharacterActivityPresentation(value = state) {
  if (value?.phase !== 'running') return Object.freeze({ visible: false, key: null })
  if (value?.busy === 'verify') return Object.freeze({ visible: true, key: 'progressVerify' })
  if (value?.job?.status === 'post_processing') return Object.freeze({ visible: true, key: 'progressPost' })
  return Object.freeze({ visible: true, key: 'progressQueued' })
}

function setControlValue(id, value) {
  const control = byId(id)
  if (control && control.value !== String(value ?? '')) control.value = String(value ?? '')
}

function setControlChecked(id, checked) {
  const control = byId(id)
  if (control) control.checked = Boolean(checked)
}

function handleFrameSelectorChange() {
  if (!localMutationAllowed()) {
    setControlValue('character-advanced-frame', selectedAdjustmentFrame)
    return
  }
  const next = inputNumber('character-advanced-frame', selectedAdjustmentFrame)
  selectedAdjustmentFrame = Number.isInteger(next) && next >= 0 ? next : 0
  renderFrameAdjustmentControls()
}

function renderFrameAdjustmentControls() {
  setControlValue('character-advanced-frame', selectedAdjustmentFrame)
  const adjustment = state.advancedSettings.frameAdjustments?.[selectedAdjustmentFrame] ?? { dx: 0, dy: 0 }
  setControlValue('character-advanced-nudge-x', adjustment.dx)
  setControlValue('character-advanced-nudge-y', adjustment.dy)
  syncCharacterCombobox('advancedFrame', {
    editable: !(['running', 'submission_unknown'].includes(state.phase) || state.busy === 'decode' || !serviceConnectionAvailable),
  })
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
      if (!localMutationAllowed()) return
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
  const locked = ['running', 'submission_unknown'].includes(state.phase) || state.busy === 'decode'
  const panel = state.advancedPanel
  setHidden('character-advanced-calibration', panel !== 'calibration')
  setHidden('character-advanced-cuts', panel !== 'cuts')
  const workspace = byId('character-local-workspace')
  if (workspace) {
    workspace.dataset.characterProcessingMode = state.processingMode
    if (panel) workspace.dataset.characterAdvancedPanel = panel
    else delete workspace.dataset.characterAdvancedPanel
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
  queryAdvancedConfigControls(byId('character-local-advanced-form') || byId('character-advanced-config')).forEach((control) => {
    control.disabled = locked || !serviceConnectionAvailable
  })
  const comboboxEditable = !(locked || !serviceConnectionAvailable)
  if (!comboboxEditable) closeAllCharacterComboboxes()
  syncLocalCharacterComboboxes({ editable: comboboxEditable })
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
  document.querySelectorAll('[data-character-advanced-frame-index]').forEach((node) => {
    node.textContent = localT('advancedFrameOption', {
      index: node.dataset.characterAdvancedFrameIndex,
    })
  })
  document.querySelectorAll('[data-character-advanced-aria]').forEach((node) => {
    node.setAttribute('aria-label', localT(node.dataset.characterAdvancedAria))
  })
}

export function renderStudioCharacterLocal() {
  if (!processingSurfaceActive) return
  const workspace = byId('character-local-workspace')
  if (!workspace) return
  const presentation = deriveLocalCharacterPresentation()
  const blocking = deriveLocalCharacterBlockingPresentation(state, getCurrentLanguage())
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
  setText('character-stage-kicker', localT(presentation.kickerKey))
  setText('character-stage-title', localT(presentation.titleKey))
  setText('character-stage-help', localT(presentation.helpKey))
  setText('character-local-stage-phase', localT(presentation.statusKey))

  const hasSource = Boolean(state.file)
  const advanced = state.processingMode === 'advanced'
  const sourceHint = workspace.querySelector('.character-local-source > header span')
  const sourceDropHelp = byId('character-local-source-empty')?.querySelector('small')
  const profileEyebrow = workspace.querySelector('.character-local-profile > .eyebrow')
  const profileTitle = byId('character-local-profile-title')
  if (sourceHint && advanced) sourceHint.textContent = localT('advancedSourceHint')
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

  const activity = deriveLocalCharacterActivityPresentation()
  setHidden('character-local-progress', !activity.visible)
  const progressBar = byId('character-local-progress-bar')
  if (progressBar) progressBar.removeAttribute('value')
  setText('character-local-progress-label', activity.key ? localT(activity.key) : '')
  setText('character-local-progress-job', state.job?.id ? `${localT('jobLabel')} · ${state.job.id}` : '—')
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
    const visibleError = deriveLocalCharacterVisibleError(state, getCurrentLanguage())
    error.textContent = visibleError
    error.hidden = !visibleError
  }

  renderAdvancedPanels()
  void bindLocalSharedResult()
}

function refreshSharedAdvancedProfileCopy() {
  const layout = byId('character-advanced-layout')?.value
  const profileEyebrow = globalThis.document?.querySelector?.('.character-local-profile > .eyebrow')
  const profileTitle = byId('character-local-profile-title')
  if (profileEyebrow) profileEyebrow.textContent = localT('advancedProfileTitle')
  if (profileTitle) {
    profileTitle.textContent = localT(
      layout === FIXED_REGION_MOTION_LAYOUT_ID
        ? 'advancedProfileFixed'
        : 'advancedProfileTopdown',
    )
  }
}

export function renderStudioCharacterLocalLanguage() {
  if (processingSurfaceActive) {
    renderProcessingSurface()
    return
  }
  renderStaticCopy()
  refreshSharedAdvancedProfileCopy()
  syncLocalCharacterComboboxes({ editable: serviceConnectionAvailable })
}

export function setStudioCharacterProcessingContext({
  active = true,
  surfaceActive = active,
} = {}) {
  processingActive = Boolean(active)
  processingSurfaceActive = Boolean(surfaceActive)
  if (!processingActive) {
    activeController?.abort()
    operationEpoch += 1
    sourceSelectionEpoch += 1
    blackSelectionEpoch += 1
    calibrationEpoch += 1
    stopSharedCharacterPreview()
    abandonLocalTemporaryWork()
  } else if (!processingSurfaceActive) {
    stopSharedCharacterPreview()
    abandonLocalTemporaryWork()
  }
  renderProcessingSurface()
}

export function setStudioCharacterLocalActive(active) {
  setStudioCharacterProcessingContext({ active, surfaceActive: active })
}

export function canMutateStudioCharacterLocalParameters() {
  return localMutationAllowed()
}

export function getStudioLocalCharacterAdvancedSettings() {
  return state.advancedSettings
}

export function inspectStudioLocalCharacterIsolationSnapshot() {
  return Object.freeze({
    phase: state.phase,
    jobId: state.job?.id ?? null,
    hasResult: Boolean(state.result),
    status: state.job?.status ?? null,
    inputEpoch: state.inputEpoch,
    busy: state.busy,
    binding: state.binding,
    advancedPanel: state.advancedPanel,
    processingMode: state.processingMode,
    blackFileName: state.blackFile?.name ?? null,
    blackUrl: state.blackUrl,
    blackDimensions: state.blackDimensions ?? null,
    error: state.error ?? null,
    fileName: state.file?.name ?? null,
    sourceUrl: state.sourceUrl,
    dimensions: state.dimensions ?? null,
    selectedAdjustmentFrame,
    advancedSettings: JSON.parse(JSON.stringify(state.advancedSettings)),
    calibration: Object.freeze({
      busy: Boolean(state.calibration?.busy),
      active: Boolean(state.calibration?.active),
      hasPreview: Boolean(state.calibration?.previewFile),
      hasReport: Boolean(state.calibration?.report),
      sourceInputEpoch: state.calibration?.sourceInputEpoch ?? null,
    }),
  })
}

export function inspectStudioLocalCharacterState() {
  return Object.freeze({
    phase: state.phase,
    jobId: state.job?.id ?? null,
    hasResult: Boolean(state.result),
    status: state.job?.status ?? null,
    failureReasonKey: state.failureReasonKey,
  })
}

export function getStudioCharacterProcessingSourceState() {
  return Object.freeze({
    hasSource: Boolean(state.file),
    sourceOrigin: state.sourceOrigin,
    sourceProvenance: state.sourceProvenance,
    phase: state.phase,
  })
}

export function adoptStudioCharacterProcessingSource(file, {
  sourceOrigin = 'ai',
  sourceProvenance = null,
  signal,
} = {}) {
  return selectSource(file, {
    sourceOrigin,
    sourceProvenance,
    signal,
    transactional: true,
    allowActiveRunSupersession: true,
  })
}

export function seedStudioLocalCharacterCompleteForTest(result) {
  state = {
    ...createInitialLocalCharacterState(),
    phase: 'complete',
    job: result?.job ?? null,
    result: result ?? null,
    advancedSettings: state.advancedSettings,
    sourceOrigin: state.sourceOrigin,
    sourceProvenance: state.sourceProvenance,
  }
}

export function selectStudioLocalCharacterSourceForTest(file) {
  return selectSource(file)
}

export function startStudioLocalCharacterCalibrationForTest() {
  return buildCalibrationPreview()
}

export function submitStudioLocalCharacterJobForTest() {
  return submitLocalJob()
}

export function selectStudioLocalCharacterBlackMatteForTest(file) {
  return selectBlackMatte(file)
}

export function seedStudioLocalCharacterReadyForTest({
  file,
  dimensions = { width: 32, height: 32 },
  processingMode = 'standard',
  sourceLayout = 'topdown_rpg_v0',
  backgroundMode,
} = {}) {
  state = {
    ...createInitialLocalCharacterState(),
    phase: 'ready',
    file: file ?? state.file,
    sourceUrl: state.sourceUrl ?? 'blob:local-test',
    dimensions,
    name: 'character',
    processingMode,
    advancedSettings: {
      ...state.advancedSettings,
      sourceLayout,
      ...(backgroundMode ? { backgroundMode } : {}),
    },
  }
}

export function seedStudioLocalCharacterActiveRunForTest({
  phase = 'running',
  job = null,
} = {}) {
  state = {
    ...state,
    phase,
    busy: phase === 'running' ? 'observe' : null,
    job,
    result: null,
    failureReport: null,
    failureReasonKey: null,
    error: null,
  }
}

export function notifyLocalAdvancedControlsChanged() {
  updateAdvancedSettingsFromControls()
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
  const shared = getSharedCharacterExportPresentation()
  const presentation = createLocalCompleteResultPresentation(result)
  if (
    getSharedCharacterResultOwner() !== 'local'
    || shared?.bindKey !== presentation.bindKey
    || !shared.playable
    || !shared.exportUnlocked
    || shared.hydrateError
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

function initAdvancedLocalControls() {
  const frame = byId('character-advanced-frame')
  if (frame && !frame.options.length) {
    for (let index = 0; index < 64; index += 1) {
      const option = document.createElement('option')
      option.value = String(index)
      option.dataset.characterAdvancedFrameIndex = String(index)
      frame.append(option)
    }
  }
  const locks = byId('character-advanced-locks')
  if (locks && !locks.options.length) {
    for (const [name, copyKey] of ADVANCED_ANIMATION_LOCK_OPTIONS) {
      const option = document.createElement('option')
      option.value = name
      option.dataset.characterAdvancedCopy = copyKey
      locks.append(option)
    }
  }
  document.querySelectorAll('.character-advanced-panel-close').forEach((button) => {
    button.addEventListener('click', closeAdvancedPanel)
  })
  document.querySelectorAll('.character-advanced-panel-back').forEach((button) => {
    button.addEventListener('click', () => openAdvancedPanel('config'))
  })
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
  byId('character-advanced-frame')?.addEventListener('change', handleFrameSelectorChange)
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
  bindCharacterComboboxKinds(CHARACTER_LOCAL_COMBOBOX_KINDS)
  syncLocalCharacterComboboxes({ editable: serviceConnectionAvailable })
  byId('character-local-advanced-form')?.addEventListener('submit', (event) => {
    event.preventDefault?.()
  })
  byId('character-local-file')?.addEventListener('change', (event) => {
    if (!processingActive) return
    const file = event.currentTarget?.files?.[0]
    if (file) void selectSource(file)
  })
  byId('character-local-clear')?.addEventListener('click', () => {
    if (!processingActive) return
    clearSource()
  })
  byId('character-local-name')?.addEventListener('input', (event) => {
    if (!processingActive) return
    invalidateForName(event.currentTarget?.value)
  })
  byId('character-local-primary')?.addEventListener('click', handlePrimaryAction)
  renderProcessingSurface()
}
