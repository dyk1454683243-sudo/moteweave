import {
  getCurrentLanguage,
  initI18n,
} from '../i18n.js'
import {
  DEFAULT_RUNTIME_MODELS,
  fetchProviderState,
  initProviderConfigSurface,
  postProviderConfig,
} from '../providerConfig.js'
import { fetchMotionSourceToolStatus } from '../motionSource/api.js'
import {
  advancedProviderRouteForState,
  advancedProviderRouteIsUndisclosed,
  clearAdvancedProviderSecret,
  isAdvancedProviderRoute,
} from './advancedProviderState.js'

const STUDIO_ACTION_TRANSLATIONS = Object.freeze({
  en: Object.freeze({
    'action.headerTitle': 'Motion Source',
    'action.headerCrumb': '· Local source · not selected',
    'action.localEntry': 'Local import',
    'action.statusEmpty': 'Waiting for source',
    'action.languageLabel': 'Interface language',
    'action.langZh': '中文',
    'action.langEn': 'EN',
    'action.contextToolbarLabel': 'Motion processing context',
    'action.contextClip': 'Action clip',
    'action.contextQuality': 'Quality',
    'action.contextQualityPass': 'Pass',
    'action.contextQualityWaiting': 'Waiting',
    'action.contextQualityNeedsReview': 'Needs review',
    'action.contextQualityBlocked': 'Blocked',
    'action.advancedToggle': 'Advanced parameters',
    'action.flowEyebrow': 'Current flow',
    'action.modeSourceSet': 'Use existing strips',
    'action.sourceTitle': 'Motion source',
    'action.sourceHelp': 'GIF, ZIP, static images, and video are processed by the local toolchain only.',
    'action.chooseSource': 'Add motion source',
    'action.sourceFormats': 'GIF / ZIP / PNG / JPEG / WebP / MP4 and more',
    'action.sourceLimits': 'GIF/ZIP ≤ 64 MB · static images ≤ 32 MB · video ≤ 200 MB',
    'action.source.name': 'File',
    'action.source.size': 'Size',
    'action.source.kind': 'Type',
    'action.source.identity': 'Source identity',
    'action.source.uploadId': 'Upload ID',
    'action.source.none': 'No source selected',
    'action.source.bytes': '{count} bytes',
    'action.guidedOptionsTitle': 'Frame selection',
    'action.optionTargetFrameCount': 'Target frames',
    'action.optionSelectionMode': 'Selection mode',
    'action.optionSelectionRecipe': 'Selection recipe',
    'action.optionLoopExpectation': 'Loop expectation',
    'action.optionStride': 'Frame stride',
    'action.optionFps': 'Source FPS',
    'action.optionMaxFrames': 'Maximum candidates',
    'action.optionStartSec': 'Start second',
    'action.optionEndSec': 'End second',
    'action.optionTemporalMatte': 'Temporal Matte',
    'action.optionBackgroundMethod': 'Background method',
    'action.optionKeyColor': 'Key color',
    'action.optionBackgroundTolerance': 'Background tolerance',
    'action.optionDefringe': 'Defringe',
    'action.optionStaticOffsetY': 'Static Y offset',
    'action.optionPixelGridRecipe': 'Pixel grid',
    'action.optionResampleStrategy': 'Resample mismatch',
    'action.recipeV2': 'Selection recipe v2',
    'action.recipeV1Compat': 'v1 compatibility',
    'action.valueAuto': 'Auto',
    'action.valueManual': 'Manual',
    'action.valueLoop': 'Loop',
    'action.valueOneShot': 'One-shot',
    'action.valueDisabled': 'Disabled',
    'action.valueEvidenceOnly': 'Evidence only',
    'action.valueKeyColor': 'Key color',
    'action.valueExternalRembg': 'rembg',
    'action.valueNone': 'None',
    'action.valueGridBalanced': 'Balanced',
    'action.valueGridDetailSafe': 'Detail safe',
    'action.valueGridOklab': 'OKLab',
    'action.valueRejectMismatch': 'Reject mismatch',
    'action.valueNearest': 'Nearest keyframes',
    'action.advancedTitle': 'Advanced cleanup and alignment',
    'action.advancedHelp': 'Configure temporal Matte, key color, pixel grid, and resampling.',
    'action.returnGuided': 'Return to Guided',
    'action.applyInputsTitle': 'Apply target',
    'action.applyInputsHelp': 'Choose the normalized sheet; an edited strip can override this build.',
    'action.sheetFile': 'Base sheet',
    'action.stripFile': 'Edited strip override',
    'action.manifestFile': 'Strip manifest',
    'action.stripFiles': 'Motion strips',
    'action.chooseFile': 'Choose file',
    'action.chooseFiles': 'Choose files',
    'action.sourceSetTitle': 'Existing sheet and strips',
    'action.sourceSetHelp': 'Analyze and apply existing local assets only; no AI generation is used.',
    'action.sourceSetAnalyze': 'Analyze Source Set',
    'action.sourceSetApply': 'Apply Source Set',
    'action.analyze': 'Analyze source',
    'action.preview': 'Generate preview',
    'action.build': 'Build motion strip',
    'action.apply': 'Apply to sheet',
    'action.cancel': 'Cancel current job',
    'action.resume': 'Resume the same job',
    'action.recovery.analysis': 'Analyze again · new operation',
    'action.recovery.preview': 'Generate preview again · new operation',
    'action.recovery.build': 'Build again · new operation',
    'action.recovery.apply': 'Apply again · new operation',
    'action.recovery.sourceSetAnalyze': 'Analyze source set again · new operation',
    'action.recovery.sourceSetApply': 'Apply source set again · new operation',
    'action.recovery.adjust': 'Return and adjust settings',
    'action.restoreAuto': 'Restore Auto',
    'action.stageEyebrow': 'Local motion processing',
    'action.stageTitle': 'Real output stage',
    'action.progressWaiting': 'Waiting',
    'action.status.idle': 'Waiting for source',
    'action.status.queued': 'Queued',
    'action.status.generating': 'Generating',
    'action.status.postProcessing': 'Post-processing',
    'action.status.done': 'Done',
    'action.status.failedPostProcessing': 'Post-processing failed',
    'action.status.failedModelError': 'Model error',
    'action.status.failedSafetyFilter': 'Safety filter blocked',
    'action.status.failedQualityGate': 'Quality gate failed',
    'action.status.notFound': 'Not found',
    'action.status.cancelled': 'Cancelled',
    'action.status.cancelling': 'Cancelling',
    'action.status.pollPaused': 'Observation paused',
    'action.status.complete': 'Complete',
    'action.status.needsReview': 'Needs review',
    'action.status.blocked': 'Blocked',
    'action.status.running': 'Running',
    'action.status.waiting': 'Waiting',
    'action.status.notRun': 'Not run',
    'action.status.unavailable': 'Unavailable',
    'action.status.previewReady': 'Preview ready',
    'action.status.review': 'Review',
    'action.status.advanced': 'Advanced',
    'action.status.abandonConfirmation': 'Confirm abandon',
    'action.status.sourceSet': 'Source Set',
    'action.status.applied': 'Applied',
    'action.emptyTitle': 'Add a motion source',
    'action.emptyHelp': 'No Analyze, Preview, Build, or Apply job has started.',
    'action.runningKicker': 'Local job running',
    'action.runningTitle': 'Waiting for the current operation',
    'action.runningHelp': 'Queued and post-processing are observed on the same job.',
    'action.pausedKicker': 'Observation paused',
    'action.pausedTitle': 'Resume the existing job',
    'action.pausedHelp': 'Resume only polls the same job or operation; it does not create a replacement.',
    'action.blockedKicker': 'Fail-closed',
    'action.blockedTitle': 'Motion processing is blocked',
    'action.blockedHelp': 'Inspect the real error or stale evidence before starting a new operation.',
    'action.sourceSetKicker': 'Advanced Source Set',
    'action.sourceSetStageTitle': 'Bind the sheet, strips, and manifest',
    'action.sourceSetStageHelp': 'Identity analysis must pass before Apply is enabled.',
    'action.sourceSetOutcomePass': 'Identity consistency passed · Apply is available.',
    'action.sourceSetOutcomeBlocked': 'Identity mismatch detected · Apply remains locked.',
    'action.previewKicker': 'Real candidates returned',
    'action.previewTitle': 'Review candidates and preview artifacts',
    'action.previewHelp': 'Manual order and selection remain local until the next Build.',
    'action.previewAlt': 'Motion frame preview sheet',
    'action.stripAlt': 'Normalized motion strip',
    'action.contactAlt': 'Motion contact sheet',
    'action.previewFigure': 'Frame preview',
    'action.stripFigure': 'Normalized strip',
    'action.contactFigure': 'Contact sheet',
    'action.frameListLabel': 'Frame candidates',
    'action.framesEmpty': 'No verified frame candidates',
    'action.frames.empty': 'No verified frame candidates.',
    'action.frames.item': 'Candidate {candidate} · Raw {raw} · {time} ms',
    'action.frames.toggle': 'Toggle candidate {index}',
    'action.frames.up': 'Up',
    'action.frames.down': 'Down',
    'action.frames.remove': 'Remove',
    'action.reviewKicker': 'Evidence review',
    'action.reviewTitle': 'Review the current Build evidence',
    'action.reviewHelp': 'Evidence can be complete, needs review, blocked, or stale; it never auto-applies.',
    'action.evidence.title': 'Process evidence',
    'action.evidence.source': 'Source',
    'action.evidence.selection': 'Selection',
    'action.evidence.loop': 'Loop',
    'action.evidence.cleanup': 'Cleanup',
    'action.evidence.grid': 'Grid',
    'action.evidence.binding': 'Binding',
    'action.evidence.waiting': 'Waiting',
    'action.appliedKicker': 'Applied locally',
    'action.appliedTitle': 'The motion strip was applied',
    'action.appliedHelp': 'Open the verified sheet or artifacts below; a full character pack is not exported here.',
    'action.downloadApplied': 'Download updated sheet',
    'action.appliedAlt': 'Applied normalized character sheet',
    'action.advancedKicker': 'Advanced parameters',
    'action.advancedStageTitle': 'Exact Motion options',
    'action.advancedStageHelp': 'These controls serialize directly into the maintained Motion options contract.',
    'action.abandonKicker': 'Unapplied work',
    'action.abandonTitle': 'Abandon this motion work?',
    'action.abandonHelp': 'Unapplied results will not be written back to Character Studio.',
    'action.abandonCancel': 'Continue Guided',
    'action.abandonConfirm': 'Abandon and return to Character Studio',
    'action.artifactsEyebrow': 'Verified artifacts',
    'action.artifactsTitle': 'Current operation outputs',
    'action.artifactsHelp': 'Only same-origin URLs returned by the current verified job are listed.',
    'action.artifactListLabel': 'Motion artifacts',
    'action.artifactsEmpty': 'No verified artifacts yet.',
    'action.job.title': 'Current binding',
    'action.job.id': 'Job ID',
    'action.job.operationId': 'Operation ID',
    'action.job.optionsHash': 'Options Hash',
    'action.job.state': 'Job state',
    'action.tool.title': 'Local tools',
    'action.tool.ffmpeg': 'FFmpeg',
    'action.tool.rembg': 'rembg',
    'action.tool.checking': 'Checking',
    'action.tool.available': 'Available',
    'action.tool.unavailable': 'Unavailable',
    'action.tool.unknown': 'Status unavailable',
    'action.phase.emptyTitle': 'New motion workflow',
    'action.phase.emptySummary': 'Add a source, analyze it, review candidates, then Build and Apply.',
    'action.phase.runningTitle': 'Motion job in progress',
    'action.phase.runningSummary': 'This local operation is provider-free and is observed without replacement work.',
    'action.phase.pausedTitle': 'Job observation paused',
    'action.phase.pausedSummary': 'Resume the same job or operation; do not create a new one.',
    'action.phase.previewTitle': 'Preview candidates ready',
    'action.phase.previewSummary': 'Review provenance, adjust manual order if needed, then Build.',
    'action.phase.reviewTitle': 'Build evidence ready',
    'action.phase.reviewSummary': 'Review Source, Selection, Loop, Cleanup, Grid, and Binding evidence.',
    'action.phase.blockedTitle': 'Motion workflow blocked',
    'action.phase.blockedSummary': 'The latest real job, artifact, or binding check failed closed.',
    'action.phase.appliedTitle': 'Motion output applied',
    'action.phase.appliedSummary': 'The applied sheet and reports come from the current verified job.',
    'action.phase.abandonTitle': 'Confirm abandonment',
    'action.phase.abandonSummary': 'Return without writing unapplied motion results into Character Studio.',
    'action.phase.advancedTitle': 'Advanced parameters',
    'action.phase.advancedSummary': 'Edit only options supported by the maintained Motion contract.',
    'action.phase.sourceSetTitle': 'Source Set',
    'action.phase.sourceSetSummary': 'Analyze identity before applying existing strips to a sheet.',
    'action.operation.analysis': 'Analyze',
    'action.operation.preview': 'Preview',
    'action.operation.build': 'Build',
    'action.operation.apply': 'Apply',
    'action.operation.sourceSetAnalyze': 'Source Set Analyze',
    'action.operation.sourceSetApply': 'Source Set Apply',
    'action.runningOperation': '{operation} in progress',
    'action.notice.uploading': 'Uploading and binding the selected source…',
    'action.notice.queued': 'Operation queued.',
    'action.notice.jobStatus': 'Job status: {status}',
    'action.notice.pollPaused': 'Polling paused. Resume observes the same job.',
    'action.notice.transportUnknown': 'Request outcome unknown. No replacement operation was created.',
    'action.notice.resuming': 'Resuming the same job or operation…',
    'action.notice.cancelling': 'Cancelling the current job…',
    'action.notice.cancelled': 'Current job cancelled.',
    'action.notice.analysisReady': 'Source analysis is ready.',
    'action.notice.previewReady': 'Verified preview candidates are ready.',
    'action.notice.buildReady': 'Build evidence is ready for review.',
    'action.notice.buildBlocked': 'Build evidence blocked Apply.',
    'action.notice.applied': 'Motion strip applied successfully.',
    'action.notice.applyBlocked': 'Apply report blocked the result.',
    'action.notice.applyNeedsReview': 'Applied with warnings; inspect the report.',
    'action.notice.sourceSetReady': 'Source Set identity passed; Apply is available.',
    'action.notice.sourceSetBlocked': 'Source Set identity did not pass; Apply remains disabled.',
    'action.notice.sourceSetApplied': 'Source Set applied successfully.',
    'action.notice.optionsChanged': 'Options changed; dependent evidence may be stale.',
    'action.notice.manualUpdated': 'Manual frame selection updated.',
    'action.notice.autoRestored': 'Automatic frame selection restored.',
    'action.notice.abandonPending': 'Confirm whether to abandon unapplied motion work.',
    'action.error.sourceRequired': 'Choose a Motion source first.',
    'action.error.tooLarge': 'This source exceeds its {limit}-byte limit.',
    'action.error.operationActive': 'Another Motion operation is still active.',
    'action.error.previewStale': 'Generate a current Preview before Build.',
    'action.error.applyBlocked': 'Apply is blocked: {reason}',
    'action.error.sourceSetBlocked': 'Source Set identity must pass before Apply.',
    'action.error.keyColor': 'Enter key color as R,G,B values.',
    'action.error.requestAborted': 'The request stopped before a job receipt was returned.',
    'action.error.jobReceiptMissing': 'No job receipt is available; this operation cannot be resubmitted automatically.',
    'action.error.sessionExpired': 'The Motion server session expired. Re-upload the selected source.',
    'action.error.sourceChanged': 'The selected Motion source changed.',
    'action.error.jobFailed': 'Motion job failed: {status}',
    'action.error.jobNotTerminal': 'Motion job did not reach a terminal status.',
    'action.artifact.analysis': 'Source analysis',
    'action.artifact.previewIndex': 'Preview index',
    'action.artifact.previewSheet': 'Preview sheet',
    'action.artifact.motionReport': 'Motion report',
    'action.artifact.contactSheet': 'Contact sheet',
    'action.artifact.normalizedStrip': 'Normalized strip',
    'action.artifact.selectedFrames': 'Selected frames',
    'action.artifact.videoFramesSheet': 'Video frames sheet',
    'action.artifact.framesIndex': 'Frames index',
    'action.artifact.framesZip': 'Frames ZIP',
    'action.artifact.applyReport': 'Apply report',
    'action.artifact.appliedSheet': 'Applied sheet',
    'action.artifact.sourceSetReport': 'Source Set report',
    'action.artifact.identityReport': 'Identity gate report',
    'action.artifact.setApplyReport': 'Source Set Apply report',
  }),
  zh: Object.freeze({
    'action.headerTitle': '动作源',
    'action.headerCrumb': '· 本地源 · 尚未选择',
    'action.localEntry': '本地导入',
    'action.statusEmpty': '等待源文件',
    'action.languageLabel': '界面语言',
    'action.langZh': '中文',
    'action.langEn': 'EN',
    'action.contextToolbarLabel': '动作处理上下文',
    'action.contextClip': '动作片段',
    'action.contextQuality': '质量',
    'action.contextQualityPass': '通过',
    'action.contextQualityWaiting': '等待',
    'action.contextQualityNeedsReview': '需审阅',
    'action.contextQualityBlocked': '已阻断',
    'action.advancedToggle': '高级参数',
    'action.flowEyebrow': '当前流程',
    'action.modeSourceSet': '使用现有条带',
    'action.sourceTitle': '动作源',
    'action.sourceHelp': '支持 GIF、ZIP、静态图和视频；仅由本地工具链处理。',
    'action.chooseSource': '添加动作源',
    'action.sourceFormats': 'GIF / ZIP / PNG / JPEG / WebP / MP4 等',
    'action.sourceLimits': 'GIF/ZIP ≤ 64 MB · 静态图 ≤ 32 MB · 视频 ≤ 200 MB',
    'action.source.name': '文件',
    'action.source.size': '大小',
    'action.source.kind': '类型',
    'action.source.identity': '源标识',
    'action.source.uploadId': '上传 ID',
    'action.source.none': '尚未选择动作源',
    'action.source.bytes': '{count} 字节',
    'action.guidedOptionsTitle': '帧选择',
    'action.optionTargetFrameCount': '目标帧数',
    'action.optionSelectionMode': '选帧模式',
    'action.optionSelectionRecipe': '选帧配方',
    'action.optionLoopExpectation': '循环预期',
    'action.optionStride': '抽帧步长',
    'action.optionFps': '源帧率',
    'action.optionMaxFrames': '最多候选帧',
    'action.optionStartSec': '起始秒',
    'action.optionEndSec': '结束秒',
    'action.optionTemporalMatte': '时序 Matte',
    'action.optionBackgroundMethod': '背景方法',
    'action.optionKeyColor': '键色',
    'action.optionBackgroundTolerance': '背景容差',
    'action.optionDefringe': '去杂边色',
    'action.optionStaticOffsetY': '静态 Y 偏移',
    'action.optionPixelGridRecipe': '像素网格',
    'action.optionResampleStrategy': '采样不匹配',
    'action.recipeV2': '选帧配方 v2',
    'action.recipeV1Compat': 'v1 兼容',
    'action.valueAuto': '自动',
    'action.valueManual': '手动',
    'action.valueLoop': '循环',
    'action.valueOneShot': '单次',
    'action.valueDisabled': '关闭',
    'action.valueEvidenceOnly': '仅证据',
    'action.valueKeyColor': '键色',
    'action.valueExternalRembg': 'rembg',
    'action.valueNone': '不处理',
    'action.valueGridBalanced': '平衡',
    'action.valueGridDetailSafe': '细节优先',
    'action.valueGridOklab': 'OKLab',
    'action.valueRejectMismatch': '阻断不匹配',
    'action.valueNearest': '最近关键帧',
    'action.advancedTitle': '高级清理与对齐',
    'action.advancedHelp': '配置时序 Matte、键色、像素网格与重采样。',
    'action.returnGuided': '返回引导流程',
    'action.applyInputsTitle': '应用目标',
    'action.applyInputsHelp': '选择标准化工作表；编辑后的条带可覆盖本次构建结果。',
    'action.sheetFile': '基础工作表',
    'action.stripFile': '编辑条带覆盖',
    'action.manifestFile': '条带清单',
    'action.stripFiles': '动作条带',
    'action.chooseFile': '选择文件',
    'action.chooseFiles': '选择多个文件',
    'action.sourceSetTitle': '现有工作表与动作条带',
    'action.sourceSetHelp': '仅分析并应用现有本地资产，不会进行 AI 生成。',
    'action.sourceSetAnalyze': '分析 Source Set',
    'action.sourceSetApply': '应用 Source Set',
    'action.analyze': '分析动作源',
    'action.preview': '生成预览',
    'action.build': '构建动作条带',
    'action.apply': '应用到工作表',
    'action.cancel': '取消当前任务',
    'action.resume': '继续同一任务',
    'action.recovery.analysis': '重新分析 · 新操作',
    'action.recovery.preview': '重新生成预览 · 新操作',
    'action.recovery.build': '重新构建 · 新操作',
    'action.recovery.apply': '重新应用 · 新操作',
    'action.recovery.sourceSetAnalyze': '重新分析条带集 · 新操作',
    'action.recovery.sourceSetApply': '重新应用条带集 · 新操作',
    'action.recovery.adjust': '返回并调整设置',
    'action.restoreAuto': '恢复自动选帧',
    'action.stageEyebrow': '本地动作处理',
    'action.stageTitle': '真实输出舞台',
    'action.progressWaiting': '等待',
    'action.status.idle': '等待导入',
    'action.status.queued': '排队中',
    'action.status.generating': '生成中',
    'action.status.postProcessing': '后处理中',
    'action.status.done': '已完成',
    'action.status.failedPostProcessing': '后处理失败',
    'action.status.failedModelError': '模型错误',
    'action.status.failedSafetyFilter': '安全过滤已阻断',
    'action.status.failedQualityGate': '质量门失败',
    'action.status.notFound': '未找到',
    'action.status.cancelled': '已取消',
    'action.status.cancelling': '正在取消',
    'action.status.pollPaused': '观察已暂停',
    'action.status.complete': '完成',
    'action.status.needsReview': '需审阅',
    'action.status.blocked': '已阻断',
    'action.status.running': '运行中',
    'action.status.waiting': '等待',
    'action.status.notRun': '未运行',
    'action.status.unavailable': '不可用',
    'action.status.previewReady': '预览已就绪',
    'action.status.review': '审阅',
    'action.status.advanced': '高级参数',
    'action.status.abandonConfirmation': '确认放弃',
    'action.status.sourceSet': '来源集',
    'action.status.applied': '已应用',
    'action.emptyTitle': '添加动作源',
    'action.emptyHelp': '尚未启动分析、预览、构建或应用任务。',
    'action.runningKicker': '本地任务进行中',
    'action.runningTitle': '等待当前操作',
    'action.runningHelp': '只观察同一个任务的排队与后处理状态。',
    'action.pausedKicker': '观察已暂停',
    'action.pausedTitle': '继续现有任务',
    'action.pausedHelp': '继续只会观察同一任务或操作，不会创建替代任务。',
    'action.blockedKicker': '失败即关闭',
    'action.blockedTitle': '动作处理已阻断',
    'action.blockedHelp': '启动新操作前，请先检查真实错误或过期证据。',
    'action.sourceSetKicker': '高级 Source Set',
    'action.sourceSetStageTitle': '绑定工作表、条带与清单',
    'action.sourceSetStageHelp': '标识一致性分析通过后，应用按钮才会启用。',
    'action.sourceSetOutcomePass': '标识一致性已通过 · 可以应用。',
    'action.sourceSetOutcomeBlocked': '检测到标识不一致 · 应用保持锁定。',
    'action.previewKicker': '真实候选已返回',
    'action.previewTitle': '审阅候选帧与预览制品',
    'action.previewHelp': '手动顺序和选中状态只会在下一次构建时提交。',
    'action.previewAlt': '动作候选帧预览图',
    'action.stripAlt': '标准化动作条带',
    'action.contactAlt': '动作接触表',
    'action.previewFigure': '帧预览',
    'action.stripFigure': '标准化条带',
    'action.contactFigure': '接触表',
    'action.frameListLabel': '候选帧列表',
    'action.framesEmpty': '尚无已核验候选帧',
    'action.frames.empty': '尚无已核验候选帧。',
    'action.frames.item': '候选 {candidate} · Raw {raw} · {time} 毫秒',
    'action.frames.toggle': '切换候选帧 {index}',
    'action.frames.up': '上移',
    'action.frames.down': '下移',
    'action.frames.remove': '移除',
    'action.reviewKicker': '证据审阅',
    'action.reviewTitle': '审阅当前构建证据',
    'action.reviewHelp': '证据可能为完成、需审阅、阻断或过期；绝不会自动应用。',
    'action.evidence.title': '流程证据',
    'action.evidence.source': '源文件',
    'action.evidence.selection': '帧选择',
    'action.evidence.loop': '循环',
    'action.evidence.cleanup': '清理',
    'action.evidence.grid': '像素网格',
    'action.evidence.binding': '绑定',
    'action.evidence.waiting': '等待',
    'action.appliedKicker': '已在本地应用',
    'action.appliedTitle': '动作条带已应用',
    'action.appliedHelp': '可打开下方已核验工作表或制品；这里不会导出完整角色资源包。',
    'action.downloadApplied': '下载已更新工作表',
    'action.appliedAlt': '已应用的标准化角色工作表',
    'action.advancedKicker': '高级参数',
    'action.advancedStageTitle': '精确动作参数',
    'action.advancedStageHelp': '这些控件会直接序列化到维护中的动作参数合同。',
    'action.abandonKicker': '未应用内容',
    'action.abandonTitle': '确认放弃当前动作处理？',
    'action.abandonHelp': '未应用的结果不会写回角色工作室。',
    'action.abandonCancel': '继续引导',
    'action.abandonConfirm': '确认放弃并返回角色工作室',
    'action.artifactsEyebrow': '已核验制品',
    'action.artifactsTitle': '当前操作输出',
    'action.artifactsHelp': '这里只列出当前已核验任务返回的同源 URL。',
    'action.artifactListLabel': '动作制品',
    'action.artifactsEmpty': '尚无已核验制品。',
    'action.job.title': '当前绑定',
    'action.job.id': '任务 ID',
    'action.job.operationId': '操作 ID',
    'action.job.optionsHash': '参数 Hash',
    'action.job.state': '任务状态',
    'action.tool.title': '本地工具',
    'action.tool.ffmpeg': 'FFmpeg',
    'action.tool.rembg': 'rembg',
    'action.tool.checking': '检测中',
    'action.tool.available': '可用',
    'action.tool.unavailable': '不可用',
    'action.tool.unknown': '状态不可用',
    'action.phase.emptyTitle': '新建动作处理',
    'action.phase.emptySummary': '添加动作源，完成分析与候选审阅后再构建并应用。',
    'action.phase.runningTitle': '动作任务进行中',
    'action.phase.runningSummary': '这是不调用服务提供方的本地操作，只观察当前任务。',
    'action.phase.pausedTitle': '任务观察已暂停',
    'action.phase.pausedSummary': '只继续同一任务或操作，不会创建新任务。',
    'action.phase.previewTitle': '候选帧预览已就绪',
    'action.phase.previewSummary': '核对来源，必要时调整手动顺序，然后再构建。',
    'action.phase.reviewTitle': '构建证据已就绪',
    'action.phase.reviewSummary': '审阅源文件、帧选择、循环、清理、网格与绑定证据。',
    'action.phase.blockedTitle': '动作流程已阻断',
    'action.phase.blockedSummary': '最新真实任务、制品或绑定校验已失败即关闭。',
    'action.phase.appliedTitle': '动作输出已应用',
    'action.phase.appliedSummary': '已应用工作表与报告均来自当前已核验任务。',
    'action.phase.abandonTitle': '确认放弃',
    'action.phase.abandonSummary': '返回且不把未应用的动作结果写入角色工作室。',
    'action.phase.advancedTitle': '高级参数',
    'action.phase.advancedSummary': '仅编辑维护中的动作合同所支持的参数。',
    'action.phase.sourceSetTitle': 'Source Set',
    'action.phase.sourceSetSummary': '把现有条带应用到工作表前，先完成标识一致性分析。',
    'action.operation.analysis': '分析',
    'action.operation.preview': '预览',
    'action.operation.build': '构建',
    'action.operation.apply': '应用',
    'action.operation.sourceSetAnalyze': 'Source Set 分析',
    'action.operation.sourceSetApply': 'Source Set 应用',
    'action.runningOperation': '{operation}进行中',
    'action.notice.uploading': '正在上传并绑定所选动作源…',
    'action.notice.queued': '操作已排队。',
    'action.notice.jobStatus': '任务状态：{status}',
    'action.notice.pollPaused': '状态观察已暂停；继续只会观察同一任务。',
    'action.notice.transportUnknown': '请求结果未知；未创建替代操作。',
    'action.notice.resuming': '正在继续同一任务或操作…',
    'action.notice.cancelling': '正在取消当前任务…',
    'action.notice.cancelled': '当前任务已取消。',
    'action.notice.analysisReady': '动作源分析已就绪。',
    'action.notice.previewReady': '已核验候选帧预览就绪。',
    'action.notice.buildReady': '构建证据已就绪，等待审阅。',
    'action.notice.buildBlocked': '构建证据阻断了应用。',
    'action.notice.applied': '动作条带已成功应用。',
    'action.notice.applyBlocked': '应用报告阻断了本次结果。',
    'action.notice.applyNeedsReview': '已应用但存在警告，请检查报告。',
    'action.notice.sourceSetReady': 'Source Set 标识通过，可以应用。',
    'action.notice.sourceSetBlocked': 'Source Set 标识未通过，应用保持禁用。',
    'action.notice.sourceSetApplied': 'Source Set 已成功应用。',
    'action.notice.optionsChanged': '参数已更改，依赖证据可能已过期。',
    'action.notice.manualUpdated': '手动选帧已更新。',
    'action.notice.autoRestored': '已恢复自动选帧。',
    'action.notice.abandonPending': '请确认是否放弃未应用的动作处理。',
    'action.error.sourceRequired': '请先选择动作源。',
    'action.error.tooLarge': '该动作源超过 {limit} 字节的限制。',
    'action.error.operationActive': '另一个动作操作仍在进行。',
    'action.error.previewStale': '构建前请先生成当前参数对应的预览。',
    'action.error.applyBlocked': '应用已阻断：{reason}',
    'action.error.sourceSetBlocked': 'Source Set 标识通过后才能应用。',
    'action.error.keyColor': '请用 R,G,B 格式输入键色。',
    'action.error.requestAborted': '请求在返回任务回执前已停止。',
    'action.error.jobReceiptMissing': '没有任务回执；该操作不能自动重新提交。',
    'action.error.sessionExpired': '动作服务会话已过期，请重新上传所选动作源。',
    'action.error.sourceChanged': '所选动作源已更改。',
    'action.error.jobFailed': '动作任务失败：{status}',
    'action.error.jobNotTerminal': '动作任务未到达终态。',
    'action.artifact.analysis': '源分析',
    'action.artifact.previewIndex': '预览索引',
    'action.artifact.previewSheet': '预览图',
    'action.artifact.motionReport': '动作报告',
    'action.artifact.contactSheet': '接触表',
    'action.artifact.normalizedStrip': '标准化条带',
    'action.artifact.selectedFrames': '已选帧',
    'action.artifact.videoFramesSheet': '视频帧工作表',
    'action.artifact.framesIndex': '帧索引',
    'action.artifact.framesZip': '帧 ZIP',
    'action.artifact.applyReport': '应用报告',
    'action.artifact.appliedSheet': '已应用工作表',
    'action.artifact.sourceSetReport': 'Source Set 报告',
    'action.artifact.identityReport': '标识一致性报告',
    'action.artifact.setApplyReport': 'Source Set 应用报告',
  }),
})

const STUDIO_SEQUENCE_TRANSLATIONS = Object.freeze({
  en: Object.freeze({
    'sequence.navLabel': 'Sequence',
    'sequence.headerTitle': 'Sequence Studio',
    'sequence.headerCrumb': '· Local frames · not selected',
    'sequence.oldWorkspace': 'Local composer (current workspace)',
    'sequence.localEntry': 'Local import',
    'sequence.languageLabel': 'Interface language',
    'sequence.langZh': '中文',
    'sequence.langEn': 'EN',
    'sequence.flowEyebrow': 'Current flow',
    'sequence.sourceTitle': 'Source files',
    'sequence.sourceHelp': 'PNG / JPEG / WebP · multiple selection',
    'sequence.chooseFrames': 'Choose or drop multiple images',
    'sequence.file.empty': 'No files selected',
    'sequence.file.many': '{count} files selected',
    'sequence.sortNote': 'Frames are naturally sorted by filename after loading.',
    'sequence.source.none': 'Waiting for local frames',
    'sequence.source.loaded': '{count} frames loaded',
    'sequence.source.ready': '{count} frames loaded',
    'sequence.source.bound': '{count} frames · current binding',
    'sequence.source.locked': '{count} frames · input locked',
    'sequence.source.lockedHelp': 'Source and parameters stay locked during generation',
    'sequence.source.processingRead': '{count} files · input locked',
    'sequence.source.processingBuild': '{count} frames · input locked',
    'sequence.source.processingBuildHelp': 'PNG, index JSON, and ZIP are being prepared in this browser',
    'sequence.source.processingPackage': '{count} frames · input locked',
    'sequence.source.processingPackageHelp': 'The existing GIF is retained; no additional GIF request is made',
    'sequence.source.processingStep': 'Current step: {step}',
    'sequence.processingStep.read': 'Read and validate frames',
    'sequence.processingStep.local_build': 'Build local outputs',
    'sequence.processingStep.package': 'Rebuild ZIP',
    'sequence.source.partialHelp': 'Local composition complete · GIF not generated',
    'sequence.source.stale': '{count} frames · new binding awaits generation',
    'sequence.source.filesChanged': 'Source frames changed',
    'sequence.source.parameterChanged': '{label} {before} → {after}',
    'sequence.source.bindingChanged': 'Input binding changed',
    'sequence.source.localError': '{count} frames loaded · current selection retained',
    'sequence.source.localErrorHelp': 'Adjust the parameters, then generate again',
    'sequence.source.packageError': '{count} frames · generated media retained',
    'sequence.source.packageErrorHelp': 'GIF complete · final ZIP packaging failed locally',
    'sequence.source.decodeFailed': '{file} could not be decoded',
    'sequence.source.decodeFailureNoBatch': 'Other files were not committed as a generation batch',
    'sequence.parametersTitle': 'Pack parameters',
    'sequence.parametersHelp': 'Changing a parameter makes existing outputs stale.',
    'sequence.parameter.targetWidth': 'Cell W',
    'sequence.parameter.targetHeight': 'Cell H',
    'sequence.parameter.padding': 'Padding',
    'sequence.parameter.spacing': 'Frame spacing',
    'sequence.parameter.columns': 'Columns',
    'sequence.parameter.fps': 'Playback rate',
    'sequence.unit.pixels': 'px',
    'sequence.unit.columns': 'cols',
    'sequence.unit.fps': 'FPS',
    'sequence.action.generate': 'Generate sequence sheet',
    'sequence.action.building': 'Generating…',
    'sequence.primary.build': 'Generate sequence sheet',
    'sequence.stageTitle': 'Preview canvas',
    'sequence.live.empty': 'Browser local + GIF service',
    'sequence.live.ready': 'Ready to generate',
    'sequence.live.processing.read': 'Current: reading frames · {requests} request(s)',
    'sequence.live.processing.local_build': 'Current: building local outputs · {requests} request(s)',
    'sequence.live.processing.package': 'Current: rebuilding ZIP · no new request',
    'sequence.live.building': 'Synchronous request · no cancellation',
    'sequence.live.complete': 'Complete',
    'sequence.live.partial': 'GIF generation failed',
    'sequence.live.stale': 'Previous outputs locked',
    'sequence.live.error': '0 GIF requests',
    'sequence.live.local_error': 'Before failure: 0 GIF requests',
    'sequence.live.packageError': 'GIF complete · local ZIP step failed',
    'sequence.emptyKicker': 'Local sequence composer',
    'sequence.emptyTitle': 'Waiting for sequence frames',
    'sequence.emptyHelp': 'Choose multiple PNG / JPEG / WebP images. Files are naturally sorted by name. sprite.png, index.json, and ZIP are built locally; GIF uses the local service endpoint.',
    'sequence.emptyTruth': 'No AI · no job queue · not saved to a project',
    'sequence.readyKicker': 'Frames ready',
    'sequence.readyTitle': 'Review the selected frame sequence',
    'sequence.readyDynamic': '{count} frames loaded · initial filename order',
    'sequence.readyHelp': 'Frames start in natural filename order. Use the controls to move or remove frames; drag and animation grouping are not available.',
    'sequence.readySort': 'Initial filename order',
    'sequence.frameListLabel': 'Selected sequence frames',
    'sequence.frames.empty': 'No frames loaded.',
    'sequence.frames.moveUp': 'Move {name} up · {position} of {count}',
    'sequence.frames.moveDown': 'Move {name} down · {position} of {count}',
    'sequence.frames.remove': 'Remove {name} · {position} of {count}',
    'sequence.planKicker': 'Generation plan',
    'sequence.planTitle': 'Local composition parameters',
    'sequence.plan.frames': 'Frames',
    'sequence.plan.cell': 'Cell',
    'sequence.plan.grid': 'Grid',
    'sequence.plan.sheetSize': 'Canvas size',
    'sequence.plan.playback': 'Playback',
    'sequence.plan.localOutputs': 'Local outputs',
    'sequence.plan.serviceOutput': 'Service output',
    'sequence.planHelp': 'PNG, index JSON, and ZIP are made locally; GIF is the only service request.',
    'sequence.sheetKicker': 'Sequence sheet',
    'sequence.sheetTitle': 'Real generated output',
    'sequence.canvasLabel': 'Sequence sheet preview',
    'sequence.result.buildingKicker': 'Generating GIF',
    'sequence.result.buildingTitle': 'Encoding preview.gif',
    'sequence.result.buildingHelp': 'This is the only server POST. The page only waits for this response; it does not create a background job or promise cancellation.',
    'sequence.result.noJob': 'Synchronous GIF request · no Job / Cancel / Resume',
    'sequence.result.completeKicker': 'Generation complete',
    'sequence.result.completeTitle': '4 output types available',
    'sequence.result.completeHelp': 'Only files created by this current generation are available.',
    'sequence.result.completeZip': 'sprite_sheet.zip (includes the three files above)',
    'sequence.result.partialKicker': 'Partially complete',
    'sequence.result.partialTitle': 'preview.gif was not generated',
    'sequence.result.partialHelp': 'PNG, JSON, and ZIP remain available. GIF stays locked.',
    'sequence.result.partialReasonHelp': 'The service reason is shown verbatim.',
    'sequence.result.notJobRetry': 'This calls the same real GIF endpoint again; it is not a Job retry.',
    'sequence.result.partialLocalValid': 'PNG / JSON / ZIP remain valid',
    'sequence.result.staleKicker': 'Outputs stale',
    'sequence.result.staleTitle': 'Regeneration required',
    'sequence.result.staleHelp': 'Previous PNG, index, GIF, and ZIP files are never rebound to new parameters. Regeneration creates a new operation token.',
    'sequence.result.staleLocked': 'Previous downloads locked',
    'sequence.resultHeading.buildingTitle': 'Sheet complete · waiting for GIF',
    'sequence.resultHeading.buildingHelp': 'PNG, JSON, and ZIP are already local; preview.gif is not created before the GIF request succeeds.',
    'sequence.resultHeading.completeTitle': 'Sequence assets complete',
    'sequence.resultHeading.completeHelp': 'Preview and downloads are bound to the current input and parameters; changing either makes them stale.',
    'sequence.resultHeading.partialTitle': 'Local output preview complete',
    'sequence.resultHeading.partialHelp': 'GIF output failed; keep the current Sheet and local outputs without presenting the pack as complete.',
    'sequence.resultHeading.staleTitle': 'Outputs stale',
    'sequence.resultHeading.staleHelp': 'After source files or any parameter change, the previous Sheet/GIF is reference-only and no longer downloadable.',
    'sequence.result.statusLabel': 'Output status',
    'sequence.previewAlt': 'Sequence GIF preview',
    'sequence.previewCaption': 'GIF preview',
    'sequence.errorKicker': 'Input error',
    'sequence.errorTitle': 'No output was generated',
    'sequence.errorNoOutput': 'The batch did not submit a GIF request or create PNG, JSON, or ZIP.',
    'sequence.errorHelp': 'Remove or replace the failed file, then choose the complete sequence again. A refresh also requires re-selection; Resume is not available.',
    'sequence.outputEyebrow': 'Outputs',
    'sequence.outputTitle': 'Outputs',
    'sequence.outputHelp': 'Formats that were not generated remain locked.',
    'sequence.output.pngType': 'PNG',
    'sequence.output.pngLabel': 'Sprite sheet',
    'sequence.output.jsonType': 'JSON',
    'sequence.output.jsonLabel': 'Frame index',
    'sequence.output.gifType': 'GIF',
    'sequence.output.gifLabel': 'Animation preview',
    'sequence.output.zipType': 'ZIP',
    'sequence.output.zipLabel': 'Sequence bundle',
    'sequence.status.empty': 'Waiting for frames',
    'sequence.status.ready': 'ready · 0 requests',
    'sequence.status.processing': 'local_processing · {requests} request(s)',
    'sequence.status.building': 'building · {requests} request(s)',
    'sequence.status.complete': 'complete',
    'sequence.status.partial': 'partial · GIF failed',
    'sequence.status.stale': 'stale · locked',
    'sequence.status.error': 'input_error · 0 requests',
    'sequence.status.localError': 'local_error · 0 requests',
    'sequence.status.packageError': 'local_error · {requests} request(s)',
    'sequence.flowTitle': 'Sequence pack',
    'sequence.phaseLabel.empty': 'Import',
    'sequence.phaseLabel.ready': 'Ready',
    'sequence.phaseLabel.processing': 'Processing',
    'sequence.phaseLabel.building': 'Build',
    'sequence.phaseLabel.complete': 'Complete',
    'sequence.phaseLabel.partial': 'Partial',
    'sequence.phaseLabel.stale': 'Stale',
    'sequence.phaseLabel.error': 'Error',
    'sequence.phaseLabel.localError': 'Error',
    'sequence.crumb.empty': '· Local pack · Waiting for import',
    'sequence.crumb.ready': '· Local pack · Frames ready',
    'sequence.crumb.processing': '· Local pack · Processing locally',
    'sequence.crumb.building': '· Local pack · Generating GIF',
    'sequence.crumb.complete': '· Local pack · Complete',
    'sequence.crumb.partial': '· Local pack · GIF failed · Partially complete',
    'sequence.crumb.stale': '· Local pack · Input or parameters changed',
    'sequence.crumb.error': '· Local pack · Input decode failed',
    'sequence.crumb.localError': '· Local pack · Local step failed',
    'sequence.primary.choose': 'Select frame files',
    'sequence.primary.generate': 'Generate sequence assets',
    'sequence.primary.processing': 'Processing locally…',
    'sequence.primary.building': 'Generating GIF…',
    'sequence.primary.regenerate': 'Regenerate',
    'sequence.primary.retryGif': 'Regenerate GIF',
    'sequence.primary.regenerateCurrent': 'Regenerate with current parameters',
    'sequence.primary.reselect': 'Select frame files again',
    'sequence.primary.retryLocal': 'Retry local composition',
    'sequence.primary.retryPackage': 'Retry ZIP generation',
    'sequence.output.waiting': 'Waiting',
    'sequence.output.available': 'Available',
    'sequence.output.generating': 'Generating',
    'sequence.output.notGenerated': 'Not generated',
    'sequence.output.locked': 'Locked',
    'sequence.output.availableGifPending': 'Available · GIF pending',
    'sequence.output.availableWithoutGif': 'Available · GIF not included',
    'sequence.output.availableWithGif': 'Available · GIF included',
    'sequence.output.truth.empty': 'No example output or historical artifact is shown without input.',
    'sequence.output.truth.ready': 'All downloads remain disabled before generation.',
    'sequence.output.truth.processing': 'All downloads remain locked until local processing finishes.',
    'sequence.output.truth.building': 'GIF is the only POST / server step; there is no Job, polling, Cancel, or Resume.',
    'sequence.output.truth.complete': 'The ZIP always contains sprite.png, index.json, and preview.gif.',
    'sequence.output.truth.partial': 'The ZIP does not include GIF; this error does not invalidate the local outputs.',
    'sequence.output.truth.stale': 'Previous Blobs and download links never masquerade as the current result.',
    'sequence.output.truth.error': 'The Error state never shows a template, historical artifact, or previous success.',
    'sequence.output.truth.localError': 'The GIF was not requested; all downloads remain locked.',
    'sequence.output.truth.packageError': 'PNG, JSON, GIF, and the previous ZIP remain available; retrying ZIP packaging makes no new GIF request.',
    'sequence.stagePhase.empty': '0 frames · not generated',
    'sequence.stagePhase.ready': '{count} frames · {columns} columns · {width}×{height}',
    'sequence.stagePhase.processing.read': '{count} files · local processing',
    'sequence.stagePhase.processing.local_build': '{count} frames · local composition',
    'sequence.stagePhase.processing.package': '{count} frames · local ZIP packaging',
    'sequence.stagePhase.building': '{count} frames · Sheet {width}×{height} · GIF generating',
    'sequence.stagePhase.complete': '{count} frames · local + service · current',
    'sequence.stagePhase.partial': '{count} frames · local outputs available',
    'sequence.stagePhase.stale': '{count} frames · input or parameters changed',
    'sequence.stagePhase.error': 'Input failed · not generated',
    'sequence.stagePhase.local_error': '{count} frames · local composition failed · 0 requests',
    'sequence.stagePhase.package_error': '{count} frames · GIF complete · ZIP step failed · {requests} request(s)',
    'sequence.binding.title': 'Binding Summary',
    'sequence.binding.emptyPrimary': 'No generation binding yet',
    'sequence.binding.emptySecondary': '0 frames · no canvas generated',
    'sequence.binding.emptyTertiary': 'Local outputs and GIF are unavailable',
    'sequence.binding.readyPrimary': 'Current generation binding',
    'sequence.binding.readySecondary': '{count} frames · source epoch {epoch}',
    'sequence.binding.readyTertiary': '{width}×{height} · {columns} columns · {fps} FPS',
    'sequence.binding.processingPrimary': 'Local processing in progress',
    'sequence.binding.processingSecondary': 'Current step: {step}',
    'sequence.binding.processingTertiary': '{requests} service request(s) · all downloads locked',
    'sequence.binding.buildingPrimary': 'Local outputs sealed',
    'sequence.binding.buildingSecondary': 'sprite.png · index.json',
    'sequence.binding.buildingTertiary': 'sprite_sheet.zip (GIF not included yet)',
    'sequence.binding.completePrimary': 'Generation binding matches',
    'sequence.binding.completeSecondary': 'source epoch {epoch} · current options key',
    'sequence.binding.completeTertiary': 'PNG / JSON / GIF / ZIP complete',
    'sequence.binding.partialPrimary': 'Partially complete',
    'sequence.binding.partialSecondary': 'PNG / JSON / ZIP available',
    'sequence.binding.partialTertiary': 'preview.gif not generated',
    'sequence.binding.stalePrimary': 'Previous output is stale',
    'sequence.binding.staleSecondary': 'Preview belongs to the previous binding',
    'sequence.binding.staleTertiary': 'Regenerate with current parameters',
    'sequence.binding.errorPrimary': 'Generation did not start',
    'sequence.binding.errorSecondary': '0 service requests',
    'sequence.binding.errorTertiary': '0 outputs · no historical result substituted',
    'sequence.binding.localErrorPrimary': 'Failure point · before the GIF request',
    'sequence.binding.localErrorSecondary': '0 service requests · 0 outputs',
    'sequence.binding.localErrorTertiary': 'Next: retry local composition only',
    'sequence.binding.packageErrorPrimary': 'Final ZIP packaging failed locally',
    'sequence.binding.packageErrorSecondary': '{requests} GIF request(s) · PNG / JSON / GIF retained',
    'sequence.binding.packageErrorTertiary': 'Retry only the local ZIP step; do not POST GIF again',
    'sequence.sheetMeta': '{count} frames · {width}×{height} cells · {columns}×{rows} · {sheetWidth}×{sheetHeight}',
    'sequence.meta.building': 'source epoch {epoch} · options key locked',
    'sequence.meta.complete': 'source epoch {epoch} · current options key',
    'sequence.meta.partial': 'source epoch {epoch} · local outputs current',
    'sequence.meta.stale': 'previous options key ≠ current options key',
    'sequence.errorDecodeSuffix': 'could not be decoded.',
    'sequence.error.decodeCallout': 'Input error: {file} could not be read. Replace it, then select the complete sequence again.',
    'sequence.error.localCallout': 'Original error: {reason}',
    'sequence.phase.emptyLabel': 'Empty',
    'sequence.phase.emptyTitle': 'New sequence sheet',
    'sequence.phase.emptySummary': 'Import multiple local images and generate sequence assets in natural filename order.',
    'sequence.phase.readyTitle': 'Frames and parameters are ready',
    'sequence.phase.readySummary': 'The frames are decoded and sorted; confirm the parameters before one composition run.',
    'sequence.phase.processingTitle': 'Processing locally',
    'sequence.phase.processingSummary': 'The browser is reading and validating frames; this step does not make a GIF request.',
    'sequence.phase.processingSummary.local_build': 'The browser is building PNG, index JSON, and ZIP; this step does not make a GIF request.',
    'sequence.phase.processingSummary.package': 'The browser is rebuilding the ZIP with the existing GIF; no new GIF request is made.',
    'sequence.phase.buildingTitle': 'Generating the GIF preview',
    'sequence.phase.buildingSummary': 'The local Sheet, index, and ZIP are complete; waiting for the GIF response.',
    'sequence.phase.completeTitle': 'Sequence outputs are complete',
    'sequence.phase.completeSummary': 'The Sheet and GIF are bound to the current frames and parameters and are safe to download.',
    'sequence.phase.partialTitle': 'GIF generation failed',
    'sequence.phase.partialSummary': 'The GIF service failed; local PNG, JSON, and ZIP remain valid.',
    'sequence.phase.staleTitle': 'Sequence outputs are stale',
    'sequence.phase.staleSummary': 'The current input changed; the previous preview is reference-only and all downloads are locked.',
    'sequence.phase.errorTitle': 'The selected frames could not be used',
    'sequence.phase.errorSummary': 'A local file could not be decoded; this batch produced no output.',
    'sequence.phase.localErrorTitle': 'Local step failed',
    'sequence.phase.localErrorSummary': 'A browser-local step failed; completed requests are not repeated, and any usable outputs remain available.',
    'sequence.phase.packageErrorSummary': 'GIF generation succeeded; only the final local ZIP packaging failed, so retrying will not send another request.',
    'sequence.notice.reading': 'Reading and naturally sorting the selected frames…',
    'sequence.notice.ready': '{count} frames are ready.',
    'sequence.notice.sourceStale': '{count} new frames are ready. Previous outputs are locked as stale.',
    'sequence.notice.buildingLocal': 'Building PNG, index JSON, and ZIP locally…',
    'sequence.notice.buildingGif': 'Local outputs are ready. Waiting for the GIF response…',
    'sequence.notice.complete': 'All four current outputs are ready.',
    'sequence.notice.partial': 'GIF generation failed; the three local outputs remain available.',
    'sequence.notice.localFailed': 'Local composition failed before the GIF request started.',
    'sequence.notice.localPackageFailed': 'GIF is complete, but the final local ZIP packaging failed.',
    'sequence.notice.packagingGif': 'Rebuilding the ZIP locally with the existing GIF…',
    'sequence.processingBadge': 'Local processing · {requests} request(s)',
    'sequence.processingCardTitle': 'Processing in the browser',
    'sequence.processingCurrent': 'Current step: {step}.',
    'sequence.processingHelp.read': 'When this finishes, you can confirm the parameters and start local generation; this step does not request a GIF.',
    'sequence.processingHelp.local_build': 'When this finishes, the single GIF request starts automatically; this step itself does not request a GIF.',
    'sequence.processingHelp.package': 'The completed GIF is retained while only the ZIP is rebuilt; no GIF request is repeated.',
    'sequence.processingRecovery.read': 'When complete, the screen returns to a ready state; no additional click is needed now.',
    'sequence.processingRecovery.local_build': 'When complete, GIF generation continues automatically; no additional click is needed now.',
    'sequence.processingRecovery.package': 'When complete, the outputs enter the complete state; no additional click is needed now.',
    'sequence.processingLockNotice': 'Source files and parameters stay locked during processing; the operation will not be submitted twice.',
    'sequence.localErrorBadge': 'Local step failed',
    'sequence.localErrorCardTitle': 'Local step did not complete',
    'sequence.localErrorCount': 'The GIF was not requested · 0 outputs.',
    'sequence.localErrorRecovery': 'The current selection and parameters are retained; retry only the local step that failed.',
    'sequence.packageErrorCount': '{requests} GIF request(s) · PNG / JSON / GIF retained.',
    'sequence.packageErrorRecovery': 'Retry only final ZIP packaging; do not request the GIF again.',
    'sequence.notice.stale': 'Parameters changed. Previous outputs are locked until regeneration.',
    'sequence.notice.framesEdited': 'Frame order updated · {count} frame(s) ready.',
    'sequence.notice.framesEditedStale': 'Frame order updated · {count} frame(s). Previous outputs are locked until regeneration.',
    'sequence.notice.framesEmpty': 'All frames were removed. Choose frames to continue.',
    'sequence.error.canvasTooLarge': 'This layout is too large to generate safely in the browser. Reduce the frame size, columns, or frame count.',
    'sequence.error.canvasUnavailable': 'The browser could not create the sequence canvas.',
    'sequence.metric.frames': 'Frames',
    'sequence.metric.grid': 'Grid',
    'sequence.metric.sheet': 'Canvas',
    'sequence.metric.playback': 'Playback',
    'sequence.metrics.frames': 'Frames',
    'sequence.metrics.sheet': 'Canvas size',
    'sequence.metrics.rows': 'Rows',
  }),
  zh: Object.freeze({
    'sequence.navLabel': '序列',
    'sequence.headerTitle': '序列工作室',
    'sequence.headerCrumb': '· 本地帧 · 尚未选择',
    'sequence.oldWorkspace': '本地合成（旧工作区）',
    'sequence.localEntry': '本地导入',
    'sequence.languageLabel': '界面语言',
    'sequence.langZh': '中文',
    'sequence.langEn': 'EN',
    'sequence.flowEyebrow': '当前流程',
    'sequence.sourceTitle': '源文件',
    'sequence.sourceHelp': 'PNG / JPEG / WebP · 多选',
    'sequence.chooseFrames': '选择或拖入多张图片',
    'sequence.file.empty': '尚未选择文件',
    'sequence.file.many': '已选择 {count} 个文件',
    'sequence.sortNote': '载入后按文件名自然排序。',
    'sequence.source.none': '等待选择本地帧图',
    'sequence.source.loaded': '已载入 {count} 帧',
    'sequence.source.ready': '已载入 {count} 帧',
    'sequence.source.bound': '{count} 帧 · 当前绑定',
    'sequence.source.locked': '{count} 帧 · 输入已锁定',
    'sequence.source.lockedHelp': '生成期间不接受源文件或参数改动',
    'sequence.source.processingRead': '{count} 个文件 · 输入已锁定',
    'sequence.source.processingBuild': '{count} 帧 · 输入已锁定',
    'sequence.source.processingBuildHelp': '正在浏览器内准备 PNG、索引 JSON 与 ZIP',
    'sequence.source.processingPackage': '{count} 帧 · 输入已锁定',
    'sequence.source.processingPackageHelp': '保留现有 GIF，不会再次发起 GIF 请求',
    'sequence.source.processingStep': '当前步骤：{step}',
    'sequence.processingStep.read': '读取并校验帧',
    'sequence.processingStep.local_build': '生成本地产物',
    'sequence.processingStep.package': '重建 ZIP',
    'sequence.source.partialHelp': '本地合成成功 · GIF 未生成',
    'sequence.source.stale': '{count} 帧 · 新绑定待生成',
    'sequence.source.filesChanged': '源帧已改变',
    'sequence.source.parameterChanged': '{label} {before} → {after}',
    'sequence.source.bindingChanged': '输入绑定已改变',
    'sequence.source.localError': '{count} 帧已载入 · 当前选择保留',
    'sequence.source.localErrorHelp': '调整参数后可重新生成',
    'sequence.source.packageError': '{count} 帧 · 已保留生成产物',
    'sequence.source.packageErrorHelp': 'GIF 已完成 · 最终 ZIP 本地打包失败',
    'sequence.source.decodeFailed': '{file} 解码失败',
    'sequence.source.decodeFailureNoBatch': '其余文件未提交为生成批次',
    'sequence.parametersTitle': '打包参数',
    'sequence.parametersHelp': '参数变化会使既有输出变为过期状态。',
    'sequence.parameter.targetWidth': '单元格 W',
    'sequence.parameter.targetHeight': '单元格 H',
    'sequence.parameter.padding': '内边距',
    'sequence.parameter.spacing': '帧间距',
    'sequence.parameter.columns': '列数',
    'sequence.parameter.fps': '播放帧率',
    'sequence.unit.pixels': 'px',
    'sequence.unit.columns': '列',
    'sequence.unit.fps': 'FPS',
    'sequence.action.generate': '生成序列工作表',
    'sequence.action.building': '正在生成…',
    'sequence.primary.build': '生成序列工作表',
    'sequence.stageTitle': '预览画布',
    'sequence.live.empty': '浏览器本地 + GIF 服务',
    'sequence.live.ready': '准备生成',
    'sequence.live.processing.read': '当前：读取帧 · {requests} 请求',
    'sequence.live.processing.local_build': '当前：生成本地产物 · {requests} 请求',
    'sequence.live.processing.package': '当前：重建 ZIP · 不新增请求',
    'sequence.live.building': '同步请求 · 无取消',
    'sequence.live.complete': '完成',
    'sequence.live.partial': 'GIF 生成失败',
    'sequence.live.stale': '旧产物已锁定',
    'sequence.live.error': '0 个 GIF 请求',
    'sequence.live.local_error': '失败前：0 个 GIF 请求',
    'sequence.live.packageError': 'GIF 已完成 · 本地 ZIP 步骤失败',
    'sequence.emptyKicker': '本地序列合成',
    'sequence.emptyTitle': '等待导入序列帧',
    'sequence.emptyHelp': '选择多张 PNG / JPEG / WebP。文件会按名称自然排序，本地生成 sprite.png、index.json 与 ZIP；GIF 使用本地服务接口。',
    'sequence.emptyTruth': '无 AI · 无任务队列 · 不保存到项目',
    'sequence.readyKicker': '帧已就绪',
    'sequence.readyTitle': '检查所选帧序列',
    'sequence.readyDynamic': '{count} 帧已载入 · 初始文件名顺序',
    'sequence.readyHelp': '帧会先按文件名自然排序；可用按钮上移、下移或移除，暂不支持拖拽和动画分组。',
    'sequence.readySort': '初始文件名顺序',
    'sequence.frameListLabel': '已选择的序列帧',
    'sequence.frames.empty': '尚未载入帧图。',
    'sequence.frames.moveUp': '上移 {name} · 第 {position} / {count} 帧',
    'sequence.frames.moveDown': '下移 {name} · 第 {position} / {count} 帧',
    'sequence.frames.remove': '移除 {name} · 第 {position} / {count} 帧',
    'sequence.planKicker': '生成计划',
    'sequence.planTitle': '本地合成参数',
    'sequence.plan.frames': '帧数',
    'sequence.plan.cell': '单元格',
    'sequence.plan.grid': '网格',
    'sequence.plan.sheetSize': '画布尺寸',
    'sequence.plan.playback': '播放',
    'sequence.plan.localOutputs': '本地产物',
    'sequence.plan.serviceOutput': '服务产物',
    'sequence.planHelp': 'PNG、索引 JSON 与 ZIP 在浏览器本地生成；GIF 是唯一服务请求。',
    'sequence.sheetKicker': '序列工作表',
    'sequence.sheetTitle': '真实生成输出',
    'sequence.canvasLabel': '序列工作表预览',
    'sequence.result.buildingKicker': '正在生成 GIF',
    'sequence.result.buildingTitle': '正在编码 preview.gif',
    'sequence.result.buildingHelp': '当前请求是唯一的服务端 POST。页面只等待该响应；不会创建后台任务，也不能承诺取消服务端编码。',
    'sequence.result.noJob': '同步 GIF 请求 · 无 Job / Cancel / Resume',
    'sequence.result.completeKicker': '生成完成',
    'sequence.result.completeTitle': '4 类产物可用',
    'sequence.result.completeHelp': '仅开放本次生成实际创建的文件。',
    'sequence.result.completeZip': 'sprite_sheet.zip（包含前三项）',
    'sequence.result.partialKicker': '部分完成',
    'sequence.result.partialTitle': 'preview.gif 未生成',
    'sequence.result.partialHelp': 'PNG、JSON 与 ZIP 保持可下载；GIF 继续锁定。',
    'sequence.result.partialReasonHelp': '服务返回的 reason 会原样显示。',
    'sequence.result.notJobRetry': '可重新发起同一真实 GIF 接口；不是 Job retry。',
    'sequence.result.partialLocalValid': 'PNG / JSON / ZIP 仍有效',
    'sequence.result.staleKicker': '输出已过期',
    'sequence.result.staleTitle': '需要重新生成',
    'sequence.result.staleHelp': '当前界面不会把旧 PNG、索引、GIF 或 ZIP 绑定到新参数。重新生成会创建新的 operation token。',
    'sequence.result.staleLocked': '旧下载已锁定',
    'sequence.resultHeading.buildingTitle': 'Sheet 已完成 · 等待 GIF',
    'sequence.resultHeading.buildingHelp': 'PNG、JSON 与 ZIP 已在浏览器本地；GIF 请求完成前不要生成 preview.gif。',
    'sequence.resultHeading.completeTitle': '序列资源已完成',
    'sequence.resultHeading.completeHelp': '预览与下载均绑定当前输入与参数；修改任一项后会立即失效。',
    'sequence.resultHeading.partialTitle': '本地产物预览已完成',
    'sequence.resultHeading.partialHelp': 'GIF 输出返回失败；保留当前 Sheet 与本地产物，不要把它生成为完整大包。',
    'sequence.resultHeading.staleTitle': '输出已失效',
    'sequence.resultHeading.staleHelp': '源文件或任一参数改变后，旧 Sheet/GIF 只作为预览参考，不再允许下载。',
    'sequence.result.statusLabel': '输出状态',
    'sequence.previewAlt': '序列 GIF 预览',
    'sequence.previewCaption': 'GIF 预览',
    'sequence.errorKicker': '输入错误',
    'sequence.errorTitle': '未生成任何输出',
    'sequence.errorNoOutput': '当前批次未提交 GIF 请求，也没有创建 PNG、JSON 或 ZIP。',
    'sequence.errorHelp': '请移除或替换失败文件，然后重新选择完整序列。刷新后也需要重新选择；当前没有 Resume。',
    'sequence.outputEyebrow': '输出',
    'sequence.outputTitle': '输出',
    'sequence.outputHelp': '未生成的格式保持锁定。',
    'sequence.output.pngType': 'PNG',
    'sequence.output.pngLabel': '序列工作表',
    'sequence.output.jsonType': 'JSON',
    'sequence.output.jsonLabel': '帧索引',
    'sequence.output.gifType': 'GIF',
    'sequence.output.gifLabel': '动画预览',
    'sequence.output.zipType': 'ZIP',
    'sequence.output.zipLabel': '序列压缩包',
    'sequence.status.empty': '等待帧',
    'sequence.status.ready': 'ready · 0 请求',
    'sequence.status.processing': 'local_processing · {requests} 请求',
    'sequence.status.building': 'building · {requests} 请求',
    'sequence.status.complete': 'complete',
    'sequence.status.partial': 'partial · GIF failed',
    'sequence.status.stale': 'stale · locked',
    'sequence.status.error': 'input_error · 0 请求',
    'sequence.status.localError': 'local_error · 0 请求',
    'sequence.status.packageError': 'local_error · {requests} 请求',
    'sequence.flowTitle': '序列打包',
    'sequence.phaseLabel.empty': '导入',
    'sequence.phaseLabel.ready': '就绪',
    'sequence.phaseLabel.processing': '处理中',
    'sequence.phaseLabel.building': '生成',
    'sequence.phaseLabel.complete': '完成',
    'sequence.phaseLabel.partial': '部分',
    'sequence.phaseLabel.stale': '失效',
    'sequence.phaseLabel.error': '错误',
    'sequence.phaseLabel.localError': '错误',
    'sequence.crumb.empty': '· 本地打包 · 等待导入',
    'sequence.crumb.ready': '· 本地打包 · 帧已就绪',
    'sequence.crumb.processing': '· 本地打包 · 本地处理中',
    'sequence.crumb.building': '· 本地打包 · GIF 生成中',
    'sequence.crumb.complete': '· 本地打包 · 全部完成',
    'sequence.crumb.partial': '· 本地打包 · GIF 失败 · 部分完成',
    'sequence.crumb.stale': '· 本地打包 · 输入或参数已变更',
    'sequence.crumb.error': '· 本地打包 · 输入解码失败',
    'sequence.crumb.localError': '· 本地打包 · 本地步骤失败',
    'sequence.primary.choose': '选择帧文件',
    'sequence.primary.generate': '生成序列资源',
    'sequence.primary.processing': '本地处理中…',
    'sequence.primary.building': '正在生成 GIF…',
    'sequence.primary.regenerate': '重新生成',
    'sequence.primary.retryGif': '重新生成 GIF',
    'sequence.primary.regenerateCurrent': '按当前参数重新生成',
    'sequence.primary.reselect': '重新选择帧文件',
    'sequence.primary.retryLocal': '重试本地合成',
    'sequence.primary.retryPackage': '重试生成 ZIP',
    'sequence.output.waiting': '等待',
    'sequence.output.available': '可下载',
    'sequence.output.generating': '生成中',
    'sequence.output.notGenerated': '未生成',
    'sequence.output.locked': '已锁定',
    'sequence.output.availableGifPending': '可下载 · 暂无 GIF',
    'sequence.output.availableWithoutGif': '可下载 · 不含 GIF',
    'sequence.output.availableWithGif': '可下载 · 含 GIF',
    'sequence.output.truth.empty': '没有输入时不展示示例输出或历史产物。',
    'sequence.output.truth.ready': '生成前所有下载保持禁用。',
    'sequence.output.truth.processing': '本地处理完成前，所有下载保持锁定。',
    'sequence.output.truth.building': 'GIF 是唯一 POST / 服务端步骤；没有 Job、轮询、Cancel 或 Resume。',
    'sequence.output.truth.complete': 'ZIP 固定包含 sprite.png、index.json 与 preview.gif。',
    'sequence.output.truth.partial': 'ZIP 不含 GIF；错误不会让本地产物失效。',
    'sequence.output.truth.stale': '旧 Blob 与下载链接不会继续冒充当前结果。',
    'sequence.output.truth.error': '错误态不展示模板、历史产物或上一次成功结果。',
    'sequence.output.truth.localError': 'GIF 尚未请求；所有下载均保持锁定。',
    'sequence.output.truth.packageError': 'PNG、JSON、GIF 与原有无 GIF ZIP 仍可下载；重试 ZIP 不会新增 GIF 请求。',
    'sequence.stagePhase.empty': '0 帧 · 尚未生成',
    'sequence.stagePhase.ready': '{count} 帧 · {columns} 列 · {width}×{height}',
    'sequence.stagePhase.processing.read': '{count} 个文件 · 本地处理',
    'sequence.stagePhase.processing.local_build': '{count} 帧 · 本地合成',
    'sequence.stagePhase.processing.package': '{count} 帧 · 本地打包',
    'sequence.stagePhase.building': '{count} 帧 · Sheet {width}×{height} · GIF 生成中',
    'sequence.stagePhase.complete': '{count} 帧 · 本地 + 服务 · 当前',
    'sequence.stagePhase.partial': '{count} 帧 · 本地产物可用',
    'sequence.stagePhase.stale': '{count} 帧 · 输入或参数已改变',
    'sequence.stagePhase.error': '输入失败 · 未生成',
    'sequence.stagePhase.local_error': '{count} 帧 · 本地合成失败 · 0 请求',
    'sequence.stagePhase.package_error': '{count} 帧 · GIF 已完成 · ZIP 步骤失败 · {requests} 请求',
    'sequence.binding.title': 'Binding Summary',
    'sequence.binding.emptyPrimary': '尚未建立生成绑定',
    'sequence.binding.emptySecondary': '0 帧 · 未生成画布',
    'sequence.binding.emptyTertiary': '本地产物与 GIF 均不可用',
    'sequence.binding.readyPrimary': '当前生成绑定',
    'sequence.binding.readySecondary': '{count} 帧 · source epoch {epoch}',
    'sequence.binding.readyTertiary': '参数 {width}×{height} · {columns} 列 · {fps} FPS',
    'sequence.binding.processingPrimary': '本地处理进行中',
    'sequence.binding.processingSecondary': '当前步骤：{step}',
    'sequence.binding.processingTertiary': '{requests} 个服务请求 · 下载全部锁定',
    'sequence.binding.buildingPrimary': '本地产物已封存',
    'sequence.binding.buildingSecondary': 'sprite.png · index.json',
    'sequence.binding.buildingTertiary': 'sprite_sheet.zip（暂不含 GIF）',
    'sequence.binding.completePrimary': '生成绑定一致',
    'sequence.binding.completeSecondary': 'source epoch {epoch} · options key 当前',
    'sequence.binding.completeTertiary': 'PNG / JSON / GIF / ZIP 已完成',
    'sequence.binding.partialPrimary': '部分成功',
    'sequence.binding.partialSecondary': 'PNG / JSON / ZIP 可下载',
    'sequence.binding.partialTertiary': 'preview.gif 未生成',
    'sequence.binding.stalePrimary': '旧输出已失效',
    'sequence.binding.staleSecondary': '预览来自上一个生成绑定',
    'sequence.binding.staleTertiary': '必须按当前参数重新生成',
    'sequence.binding.errorPrimary': '生成未开始',
    'sequence.binding.errorSecondary': '0 次服务请求',
    'sequence.binding.errorTertiary': '0 个输出 · 没有历史结果回填',
    'sequence.binding.localErrorPrimary': '失败时点 · GIF 请求前',
    'sequence.binding.localErrorSecondary': '0 个服务请求 · 0 个输出',
    'sequence.binding.localErrorTertiary': '下一步只重试本地合成',
    'sequence.binding.packageErrorPrimary': '最终 ZIP 本地打包失败',
    'sequence.binding.packageErrorSecondary': '{requests} 次 GIF 请求 · PNG / JSON / GIF 已保留',
    'sequence.binding.packageErrorTertiary': '仅重试本地 ZIP 步骤，不再 POST GIF',
    'sequence.sheetMeta': '{count} 帧 · {width}×{height} 单元格 · {columns}×{rows} · {sheetWidth}×{sheetHeight}',
    'sequence.meta.building': 'source epoch {epoch} · options key 已锁定',
    'sequence.meta.complete': 'source epoch {epoch} · options key 当前',
    'sequence.meta.partial': 'source epoch {epoch} · 本地产物当前',
    'sequence.meta.stale': '旧 options key ≠ 当前 options key',
    'sequence.errorDecodeSuffix': '无法解码。',
    'sequence.error.decodeCallout': '输入错误：无法读取 {file}。请替换文件后重新选择完整序列。',
    'sequence.error.localCallout': '原始错误：{reason}',
    'sequence.phase.emptyLabel': '空白',
    'sequence.phase.emptyTitle': '新建序列工作表',
    'sequence.phase.emptySummary': '导入多张本地图片，按自然文件名顺序生成序列资源。',
    'sequence.phase.readyTitle': '帧图与参数已就绪',
    'sequence.phase.readySummary': '帧已解码并排序；确认参数后开始一次合成。',
    'sequence.phase.processingTitle': '本地处理中',
    'sequence.phase.processingSummary': '正在浏览器内读取并校验帧；本步骤不会发起 GIF 请求。',
    'sequence.phase.processingSummary.local_build': '正在浏览器内生成 PNG、索引 JSON 与 ZIP；本步骤不会发起 GIF 请求。',
    'sequence.phase.processingSummary.package': '正在使用已有 GIF 重建 ZIP；不会再次发起 GIF 请求。',
    'sequence.phase.buildingTitle': '正在生成 GIF 预览',
    'sequence.phase.buildingSummary': '本地 Sheet、索引与 ZIP 已完成，正在等待 GIF 响应。',
    'sequence.phase.completeTitle': '序列输出已完成',
    'sequence.phase.completeSummary': 'Sheet 与 GIF 均来自当前帧和参数绑定，可安全下载。',
    'sequence.phase.partialTitle': 'GIF 生成失败',
    'sequence.phase.partialSummary': 'GIF 服务失败；本地 PNG、JSON 与 ZIP 仍保持有效。',
    'sequence.phase.staleTitle': '序列输出已过期',
    'sequence.phase.staleSummary': '当前输入已改变；旧预览仅作参考，下载全部锁定。',
    'sequence.phase.errorTitle': '所选帧图无法使用',
    'sequence.phase.errorSummary': '某个本地文件无法解码；本批次没有产生任何输出。',
    'sequence.phase.localErrorTitle': '本地步骤失败',
    'sequence.phase.localErrorSummary': '浏览器内的本地步骤失败；已完成的请求不会重复发起，可用产物继续保留。',
    'sequence.phase.packageErrorSummary': 'GIF 已生成成功；只有最终 ZIP 本地打包失败，重试不会再次发送请求。',
    'sequence.notice.reading': '正在读取并按文件名自然排序…',
    'sequence.notice.ready': '已准备 {count} 帧。',
    'sequence.notice.sourceStale': '已准备 {count} 个新帧；旧输出已作为过期参考锁定。',
    'sequence.notice.buildingLocal': '正在本地生成 PNG、索引 JSON 与 ZIP…',
    'sequence.notice.buildingGif': '本地产物已就绪，正在等待 GIF 返回…',
    'sequence.notice.complete': '本次四类输出均已就绪。',
    'sequence.notice.partial': 'GIF 生成失败，三个本地产物仍可下载。',
    'sequence.notice.localFailed': 'GIF 请求开始前，本地合成失败。',
    'sequence.notice.localPackageFailed': 'GIF 已完成，但最终 ZIP 本地打包失败。',
    'sequence.notice.packagingGif': '正在使用现有 GIF 本地重建 ZIP…',
    'sequence.processingBadge': '本地处理 · {requests} 请求',
    'sequence.processingCardTitle': '正在浏览器内处理',
    'sequence.processingCurrent': '当前步骤：{step}。',
    'sequence.processingHelp.read': '完成后可确认参数并开始本地生成；本步骤不会请求 GIF。',
    'sequence.processingHelp.local_build': '完成后将自动继续 GIF 生成；当前步骤不会请求 GIF。',
    'sequence.processingHelp.package': '保留已完成的 GIF，仅重建 ZIP；不会再次请求 GIF。',
    'sequence.processingRecovery.read': '完成后会进入可生成状态；当前无需再次点击。',
    'sequence.processingRecovery.local_build': '完成后会继续 GIF 生成；当前无需再次点击。',
    'sequence.processingRecovery.package': '完成后会进入完成状态；当前无需再次点击。',
    'sequence.processingLockNotice': '处理期间源文件与参数暂时锁定；不会重复提交。',
    'sequence.localErrorBadge': '本地步骤失败',
    'sequence.localErrorCardTitle': '本地步骤未完成',
    'sequence.localErrorCount': 'GIF 尚未请求 · 0 个输出。',
    'sequence.localErrorRecovery': '当前选择和参数仍保留；只重试本次失败的本地步骤。',
    'sequence.packageErrorCount': '已发起 {requests} 次 GIF 请求 · PNG / JSON / GIF 已保留。',
    'sequence.packageErrorRecovery': '仅重试最终 ZIP 打包；不会再次请求 GIF。',
    'sequence.notice.stale': '参数已变化；重新生成前旧输出保持锁定。',
    'sequence.notice.framesEdited': '帧顺序已更新 · {count} 帧可生成。',
    'sequence.notice.framesEditedStale': '帧顺序已更新 · {count} 帧；重新生成前旧输出保持锁定。',
    'sequence.notice.framesEmpty': '已移除全部帧；请重新选择帧图。',
    'sequence.error.canvasTooLarge': '当前布局过大，浏览器无法安全生成。请减小帧尺寸、列数或帧数量。',
    'sequence.error.canvasUnavailable': '浏览器无法创建序列画布。',
    'sequence.metric.frames': '帧数',
    'sequence.metric.grid': '网格',
    'sequence.metric.sheet': '画布',
    'sequence.metric.playback': '播放',
    'sequence.metrics.frames': '帧数',
    'sequence.metrics.sheet': '画布尺寸',
    'sequence.metrics.rows': '行数',
  }),
})

const STUDIO_TILES_TRANSLATIONS = Object.freeze({
  en: Object.freeze({
    'tiles.headerTitle': 'Tiles Studio',
    'tiles.languageLabel': 'Interface language',
    'tiles.langZh': '中文',
    'tiles.langEn': 'EN',
    'tiles.mode.local': 'Local build',
    'tiles.mode.ai': 'Advanced · Provider material evaluation',
    'tiles.crumb.empty': '· Local build · waiting to edit',
    'tiles.crumb.ready': '· Local build · edit ready',
    'tiles.crumb.building': '· Local build · building',
    'tiles.crumb.complete': '· Local build · validation complete',
    'tiles.crumb.failed': '· Local build · build failed',
    'tiles.crumb.stale': '· Local build · input changed',
    'tiles.crumb.aiSetup': '· AI material benchmark · plan setup',
    'tiles.crumb.aiPlanReady': '· AI material benchmark · zero-call plan ready',
    'tiles.crumb.aiRunning': '· AI material benchmark · running',
    'tiles.crumb.aiReview': '· AI material benchmark · report review',
    'tiles.crumb.aiFailed': '· AI material benchmark · failed',
    'tiles.status.empty': 'empty · 0 Provider',
    'tiles.status.ready': 'ready · 0 Provider',
    'tiles.status.building': 'building · 0 Provider',
    'tiles.status.complete': 'done · 0 Provider',
    'tiles.status.failed': 'failed · 0 Provider',
    'tiles.status.stale': 'stale · locked',
    'tiles.status.aiSetup': 'setup · 0/0 calls',
    'tiles.status.aiPlanReady': 'plan_ready · 0/4 calls',
    'tiles.status.aiRunning': 'generating · 0/4 calls',
    'tiles.status.aiReview': 'done · 4/4 calls',
    'tiles.status.aiFailed': 'failed_model_error',
    'tiles.flowEyebrow': 'Current flow',
    'tiles.phaseLabel.empty': 'Setup',
    'tiles.phaseLabel.ready': 'Edit',
    'tiles.phaseLabel.building': 'Building',
    'tiles.phaseLabel.complete': 'Complete',
    'tiles.phaseLabel.failed': 'Failed',
    'tiles.phaseLabel.stale': 'Stale',
    'tiles.phaseLabel.aiSetup': 'Plan',
    'tiles.phaseLabel.aiPlanReady': 'Confirm',
    'tiles.phaseLabel.aiRunning': 'Running',
    'tiles.phaseLabel.aiReview': 'Review',
    'tiles.phaseLabel.aiFailed': 'Failed',
    'tiles.phase.emptyTitle': 'Deterministic tileset build',
    'tiles.phase.emptySummary': 'Edit an 8×6 corner grid, then let the deterministic local pipeline create the strict atlas and verifiable exports.',
    'tiles.phase.readyTitle': 'Edit the corner grid',
    'tiles.phase.readySummary': 'Paint or erase rectangles, or directly toggle grid corners. Current edits are sealed into the next build.',
    'tiles.phase.buildingTitle': 'Build submitted',
    'tiles.phase.buildingSummary': 'The source, parameters, and edits are sealed. This screen only observes the same background Job.',
    'tiles.phase.completeTitle': 'Tileset complete',
    'tiles.phase.completeSummary': 'The current result passed local validation. Downloads and evidence are bound only to this Job.',
    'tiles.phase.failedTitle': 'Local build did not complete',
    'tiles.phase.failedSummary': 'The current Job is terminal. Partial artifacts are not shown and the build is not retried automatically.',
    'tiles.phase.staleTitle': 'Input and result do not match',
    'tiles.phase.staleSummary': 'The old result remains reference-only. Downloads and evidence are locked so it cannot masquerade as current output.',
    'tiles.phase.aiSetupTitle': 'Material candidate benchmark',
    'tiles.phase.aiSetupSummary': 'The Provider generates only raw material candidates. Final tile structure and exports remain owned by local code.',
    'tiles.phase.aiPlanReadyTitle': 'Confirm this Provider budget',
    'tiles.phase.aiPlanReadySummary': 'The plan is written as evidence. Confirmation authorizes at most 4 calls, one per candidate.',
    'tiles.phase.aiRunningTitle': 'Benchmark is running',
    'tiles.phase.aiRunningSummary': 'This plan is consumed. The screen only observes the same Job and offers neither resubmission nor Cancel.',
    'tiles.phase.aiReviewTitle': 'Benchmark report ready',
    'tiles.phase.aiReviewSummary': 'Review candidate usability, issue taxonomy, and next steps. Nothing is written back to local tiles automatically.',
    'tiles.phase.aiFailedTitle': 'AI material benchmark did not complete',
    'tiles.phase.aiFailedSummary': 'Show the current Job reason and retry_hint; do not retry automatically or add Provider calls.',
    'tiles.sourceTitle': 'Material source',
    'tiles.sourceChoose': 'Optional: choose a material source image',
    'tiles.sourceHelp': 'PNG / WebP / JPEG · atlas structure remains owned by local code',
    'tiles.contractTitle': 'Map contract',
    'tiles.field.width': 'Width',
    'tiles.field.height': 'Height',
    'tiles.field.density': 'Density',
    'tiles.field.seed': 'Seed',
    'tiles.field.solver': 'Solver',
    'tiles.field.border': 'Border',
    'tiles.bindingTitle': 'Build binding',
    'tiles.binding.emptyTitle': 'No build binding yet',
    'tiles.binding.readyTitle': 'Current input is ready',
    'tiles.binding.buildingTitle': 'Build binding sealed',
    'tiles.binding.completeTitle': 'Current build binding matches',
    'tiles.binding.failedTitle': 'Failed binding sealed',
    'tiles.binding.staleTitle': 'Build binding is stale',
    'tiles.primary.empty': 'Start editing',
    'tiles.primary.ready': 'Build tileset',
    'tiles.primary.building': 'Building…',
    'tiles.primary.rebuild': 'Rebuild from current input',
    'tiles.primary.aiPlan': 'Create zero-call plan',
    'tiles.primary.aiRun': 'Confirm and run 4 calls',
    'tiles.primary.aiRunning': 'Benchmark running…',
    'tiles.primary.aiReturn': 'Return to local build',
    'tiles.primary.aiReplan': 'Plan again (0 calls)',
    'tiles.stage.empty': 'Map canvas',
    'tiles.stage.ready': 'Corner-grid editor',
    'tiles.stage.building': 'Build observation',
    'tiles.stage.complete': 'Validation result',
    'tiles.stage.failed': 'Build failed',
    'tiles.stage.stale': 'Old result reference',
    'tiles.stage.aiSetup': 'Benchmark plan',
    'tiles.stage.aiPlanReady': 'Zero-call plan',
    'tiles.stage.aiRunning': 'Benchmark observation',
    'tiles.stage.aiReview': 'Benchmark report',
    'tiles.stage.aiFailed': 'Failure boundary',
    'tiles.empty.title': 'Start from the corner grid',
    'tiles.empty.body': 'Adjust map dimensions, density, and seed, and optionally choose a material source.\nStructure is always owned by the local 16-mask rules and deterministic code.',
    'tiles.empty.truth': 'No automatic AI calls · no example-result backfill',
    'tiles.editor.toolbarLabel': 'Corner-grid editing tools',
    'tiles.editor.paint': 'Paint area',
    'tiles.editor.erase': 'Erase',
    'tiles.editor.cornerSolid': 'Corner +',
    'tiles.editor.cornerEmpty': 'Corner −',
    'tiles.editor.clear': 'Clear edits',
    'tiles.editor.canvasLabel': '8×6 corner-grid map preview',
    'tiles.editor.canvasDynamicLabel': '{width}×{height} corner-grid map preview',
    'tiles.editor.resultAlt': 'Map-editor preview generated by the current Job',
    'tiles.contract.cardTitle': 'Local deterministic corner grid',
    'tiles.contract.cardBody': 'Rule: corner_mask_16\nLogical cell: 32×32\nSprite cell: 64×64\nFixed height: 24 px\nPalette: up to 32 colors\nProvider calls: 0',
    'tiles.editor.methodTitle': 'Editing method',
    'tiles.editor.methodBody': 'Drag across cells to paint or erase a rectangle.\nClick a grid corner to set solid or empty.\nEvery operation enters the current build binding.',
    'tiles.job.buildingTitle': 'Building the strict atlas locally',
    'tiles.job.buildingRecovery': 'Wait for the current Job. If transport is interrupted, resume observing only that Job.',
    'tiles.job.completeTitle': 'Validation and exports are ready',
    'tiles.job.completeRecovery': 'All 18 evidence and export classes are bound to the current Job.',
    'tiles.job.staleTitle': 'Old result locked',
    'tiles.job.staleRecovery': 'New downloads and evidence unlock only after rebuilding from current input.',
    'tiles.failed.title': 'Local build did not complete',
    'tiles.failed.reason': 'Original reason: current Job failed',
    'tiles.failed.recovery': 'The current input and edits are retained. Rebuilding creates a new Job.',
    'tiles.ai.briefTitle': 'Material description',
    'tiles.ai.descriptionDefault': 'Mossy cliff grass block, cool stone wall, clearly separated pixel-art materials.',
    'tiles.ai.descriptionPlaceholder': 'Mossy cliff grass block, cool stone wall, clearly separated pixel-art materials.',
    'tiles.ai.optionsTitle': 'Benchmark parameters',
    'tiles.ai.candidates': 'Candidates',
    'tiles.ai.imageSize': 'Image size',
    'tiles.ai.maxCalls': 'Maximum calls',
    'tiles.ai.provider': 'Provider',
    'tiles.ai.bindingTitle': 'Benchmark binding',
    'tiles.ai.bindingSetup': 'No benchmark plan yet',
    'tiles.ai.bindingFailed': 'Current Job terminated',
    'tiles.ai.failureBindingDetail': 'reason / retry_hint / calls used come only from the Job',
    'tiles.ai.confirmBudget': 'I confirm at most 4 Provider calls for this run',
    'tiles.ai.confirmReadOnly': 'Original plan and used calls remain read-only',
    'tiles.ai.providerStateTitle': 'Gemini native route awaiting plan validation',
    'tiles.ai.providerFailedTitle': 'Provider calls were not retried automatically',
    'tiles.ai.providerFailedDetail': 'Failed candidates are not reused as results; deterministic local code still owns the final tiles.',
    'tiles.ai.zeroCallNotice': 'This step writes only a zero-call plan and does not consume Provider quota.',
    'tiles.ai.planTitle': 'Create the benchmark plan before spending Provider quota',
    'tiles.ai.plan.subject': 'Benchmark subject',
    'tiles.ai.plan.subjectValue': 'Provider raw material sources, not the final atlas',
    'tiles.ai.plan.candidates': 'Candidates',
    'tiles.ai.plan.image': 'Image configuration',
    'tiles.ai.plan.provider': 'Provider',
    'tiles.ai.plan.budget': 'Current calls',
    'tiles.ai.plan.next': 'Next step',
    'tiles.ai.reviewTitle': 'Material candidate benchmark complete',
    'tiles.ai.reviewBoundary': 'The report compares only Provider raw material sources. The final strict atlas, validation, and exports remain owned by local code.',
    'tiles.ai.evaluationOutcome': 'Evaluation outcome',
    'tiles.ai.selectedCases': 'Selected candidates',
    'tiles.ai.reviewConclusion': 'Review conclusion',
    'tiles.ai.failed.kicker': 'FAILED BENCHMARK JOB',
    'tiles.ai.failed.title': 'Read the failure first; a new run requires a newly confirmed Provider budget',
    'tiles.ai.failed.job': 'Job',
    'tiles.ai.failed.status': 'Status',
    'tiles.ai.failed.plan': 'Plan',
    'tiles.ai.failed.budget': 'Budget',
    'tiles.ai.failed.cancel': 'Cancel',
    'tiles.ai.failed.outputs': 'Outputs',
    'tiles.ai.failed.currentReceipt': 'Current Job receipt',
    'tiles.ai.failed.planRetained': 'Original plan retained · no automatic resubmission',
    'tiles.ai.failed.noCancel': 'Not available',
    'tiles.ai.failed.notGenerated': 'not generated',
    'tiles.runtime.localPreview': 'Local preview · 0 Provider',
    'tiles.runtime.stale': 'Old result · outputs locked',
    'tiles.runtime.zeroCallPlan': 'Zero-call plan · Gemini not invoked',
    'tiles.runtime.submissionUnknown': 'submission_unknown · calls unknown',
    'tiles.runtime.localBuilding': 'Same Job · 0 Provider',
    'tiles.runtime.localComplete': 'Evidence ready',
    'tiles.runtime.localFailed': 'Terminal · 0 Provider',
    'tiles.runtime.localStale': 'Downloads locked',
    'tiles.runtime.aiSetup': 'Plan stage · 0 calls',
    'tiles.runtime.aiPlanReady': 'Sealed · 0/{max} calls',
    'tiles.runtime.aiRunning': 'Authoritative budget · {used}/{max}',
    'tiles.runtime.aiReview': 'Report ready',
    'tiles.runtime.aiFailed': 'Authoritative budget · read Job',
    'tiles.stageMetrics.localBuilding': '{status} · Job {job}',
    'tiles.stageMetrics.localEmpty': '{width}×{height} · corner grid not edited',
    'tiles.stageMetrics.localReady': '{width}×{height} · corner_mask_16 · {count} edits',
    'tiles.stageMetrics.localComplete': 'done · 18 artifact classes · 0 Provider',
    'tiles.stageMetrics.localFailed': '{status} · Job {job}',
    'tiles.stageMetrics.localStale': 'stale · current input not built',
    'tiles.stageMetrics.aiSetup': 'not sealed · 0 Provider calls',
    'tiles.stageMetrics.aiPlanReady': '{count} candidates · 1K · 1:1 · used 0',
    'tiles.stageMetrics.aiRunning': '{status} · Job {job}',
    'tiles.stageMetrics.aiReview': 'done · report bound · {used}/{max} calls',
    'tiles.stageMetrics.aiFailed': '{status} · current Job',
    'tiles.source.procedural': 'Procedural material',
    'tiles.editsCount': '{count} edits',
    'tiles.binding.zeroRequests': 'Procedural/local source · 0 service requests',
    'tiles.binding.notSubmitted': 'Not submitted · 0 Provider',
    'tiles.binding.failedDetail': 'Input and edits retained · outputs locked',
    'tiles.binding.oldKey': 'Old options key',
    'tiles.binding.newKey': 'Current options key',
    'tiles.jobLabel': 'Job',
    'tiles.stateLabel': 'Status',
    'tiles.error.originalReason': 'Original reason',
    'tiles.error.unknown': 'Unknown tiles workflow error',
    'tiles.error.reportBinding': 'Benchmark report does not match the current Job',
    'tiles.error.sourceType': 'Choose a PNG, JPEG, or WebP material source.',
    'tiles.error.sourceSize': 'Material source images must be 32 MiB or smaller.',
    'tiles.error.previewUnavailable': 'The current Job preview could not be displayed; outputs remain locked.',
    'tiles.output.available': 'Available',
    'tiles.output.downloadable': 'Download',
    'tiles.output.viewable': 'View',
    'tiles.output.generating': 'Generating',
    'tiles.output.locked': 'Locked',
    'tiles.output.waiting': 'Waiting',
    'tiles.output.notGenerated': 'Not generated',
    'tiles.primary.resumeSameJob': 'Resume observing this same Job',
    'tiles.primary.aiRunCount': 'Confirm and run {count} calls',
    'tiles.ai.bindingPlanReady': 'Zero-call benchmark plan verified',
    'tiles.ai.candidateSummary': '{count} candidates · 1K · 1:1',
    'tiles.ai.callSummary': 'Provider calls: {used}/{max}',
    'tiles.ai.providerReady': 'Native Gemini route ready · {model}',
    'tiles.ai.providerPending': 'Gemini route pending',
    'tiles.ai.nextConfirm': 'Confirm the sealed call budget',
    'tiles.ai.nextPlan': 'Create and review the zero-call plan',
    'tiles.ai.confirmBudgetCount': 'I confirm at most {count} Provider calls for this run',
    'tiles.ai.releaseReady': 'Ready to expand',
    'tiles.ai.releaseLocked': 'Review required',
    'tiles.jobStatus.queued': 'Queued',
    'tiles.jobStatus.generating': 'Generating',
    'tiles.jobStatus.post_processing': 'Post-processing',
    'tiles.jobStatus.done': 'Done',
    'tiles.jobStatus.failed_post_processing': 'Post-processing failed',
    'tiles.jobStatus.failed_model_error': 'Model failed',
    'tiles.jobStatus.failed_safety_filter': 'Safety filter blocked',
    'tiles.jobStatus.not_found': 'Job not found',
    'tiles.output.localTitle': 'Artifacts',
    'tiles.output.aiTitle': 'Evidence',
    'tiles.output.truth.empty': 'All artifact entries stay locked before build completion. The complete inventory contains 18 evidence and export classes.',
    'tiles.output.truth.ready': 'Keep outputs locked before generation. The preview represents current browser input, not a background build result.',
    'tiles.output.truth.building': 'Every artifact stays locked until the current Job completes and its binding verifies.',
    'tiles.output.truth.complete': 'The strict atlas, map preview, Tiled/LDtk outputs, and verified download pack all come from the current Job. Historical artifacts are never backfilled.',
    'tiles.output.truth.failed': 'Artifacts from a failed Job cannot become the current result. Rebuilding creates a new Job.',
    'tiles.output.truth.stale': 'The old preview remains comparison-only. Every download stays locked until current input is rebuilt.',
    'tiles.output.truth.aiSetup': 'Planning writes JSON and makes no Provider call. Run remains locked until the plan and human budget confirmation exist.',
    'tiles.output.truth.aiPlanReady': 'Confirmation authorizes exactly this plan’s 4 calls. Failure does not auto-retry or increase the budget.',
    'tiles.output.truth.aiRunning': 'Call counts come only from the Job provider_call_budget. Running never displays fake candidates or inferred progress.',
    'tiles.output.truth.aiReview': 'Plan, report, and notes bind to one run. Return to local build to generate the final strict atlas.',
    'tiles.output.truth.aiFailed': 'reason, retry_hint, and call counts come only from the current Job; recovery starts from a new zero-call plan.',
  }),
  zh: Object.freeze({
    'tiles.headerTitle': '图块工作室',
    'tiles.languageLabel': '界面语言',
    'tiles.langZh': '中文',
    'tiles.langEn': 'EN',
    'tiles.mode.local': '本地构建',
    'tiles.mode.ai': '高级 · Provider 材质评测',
    'tiles.crumb.empty': '· 本地构建 · 等待编辑',
    'tiles.crumb.ready': '· 本地构建 · 编辑就绪',
    'tiles.crumb.building': '· 本地构建 · 后台构建中',
    'tiles.crumb.complete': '· 本地构建 · 验证完成',
    'tiles.crumb.failed': '· 本地构建 · 构建失败',
    'tiles.crumb.stale': '· 本地构建 · 输入已变更',
    'tiles.crumb.aiSetup': '· AI 材质评测 · 计划设置',
    'tiles.crumb.aiPlanReady': '· AI 材质评测 · 零调用计划已就绪',
    'tiles.crumb.aiRunning': '· AI 材质评测 · 运行中',
    'tiles.crumb.aiReview': '· AI 材质评测 · 报告审阅',
    'tiles.crumb.aiFailed': '· AI 材质评测 · 失败',
    'tiles.status.empty': 'empty · 0 Provider',
    'tiles.status.ready': 'ready · 0 Provider',
    'tiles.status.building': 'building · 0 Provider',
    'tiles.status.complete': 'done · 0 Provider',
    'tiles.status.failed': 'failed · 0 Provider',
    'tiles.status.stale': 'stale · locked',
    'tiles.status.aiSetup': 'setup · 0/0 calls',
    'tiles.status.aiPlanReady': 'plan_ready · 0/4 calls',
    'tiles.status.aiRunning': 'generating · 0/4 calls',
    'tiles.status.aiReview': 'done · 4/4 calls',
    'tiles.status.aiFailed': 'failed_model_error',
    'tiles.flowEyebrow': '当前流程',
    'tiles.phaseLabel.empty': '设置',
    'tiles.phaseLabel.ready': '编辑',
    'tiles.phaseLabel.building': '构建中',
    'tiles.phaseLabel.complete': '完成',
    'tiles.phaseLabel.failed': '失败',
    'tiles.phaseLabel.stale': '已过期',
    'tiles.phaseLabel.aiSetup': '计划',
    'tiles.phaseLabel.aiPlanReady': '确认',
    'tiles.phaseLabel.aiRunning': '运行中',
    'tiles.phaseLabel.aiReview': '审阅',
    'tiles.phaseLabel.aiFailed': '失败',
    'tiles.phase.emptyTitle': '确定性图块构建',
    'tiles.phase.emptySummary': '先编辑 8×6 角点网格，再由本地确定性管线生成严格图集和可验证导出。',
    'tiles.phase.readyTitle': '编辑角点网格',
    'tiles.phase.readySummary': '绘制或擦除矩形，也可以直接切换网格角点；当前操作会封存在下一次构建中。',
    'tiles.phase.buildingTitle': '构建已提交',
    'tiles.phase.buildingSummary': '源文件、参数和编辑操作已封存；当前只观察同一个后台任务。',
    'tiles.phase.completeTitle': '图块集已完成',
    'tiles.phase.completeSummary': '当前结果已通过本地验证；下载和证据只绑定本次 Job。',
    'tiles.phase.failedTitle': '本地构建未完成',
    'tiles.phase.failedSummary': '当前 Job 已终止；不会展示部分产物，也不会自动重试。',
    'tiles.phase.staleTitle': '当前输入与结果不一致',
    'tiles.phase.staleSummary': '旧结果仅保留作参考；下载和证据已锁定，不能冒充当前输出。',
    'tiles.phase.aiSetupTitle': '材质候选评测',
    'tiles.phase.aiSetupSummary': 'Provider 只生成原始材质候选；最终图块结构和导出仍由本地代码负责。',
    'tiles.phase.aiPlanReadyTitle': '确认本次 Provider 配额',
    'tiles.phase.aiPlanReadySummary': '计划已写入证据；确认后最多调用 4 次，每个候选一次。',
    'tiles.phase.aiRunningTitle': '评测正在运行',
    'tiles.phase.aiRunningSummary': '本次计划已消费；页面只观察同一个 Job，不提供重复提交或 Cancel。',
    'tiles.phase.aiReviewTitle': '评测报告已就绪',
    'tiles.phase.aiReviewSummary': '检查候选可用率、问题分类与下一步建议；不会自动写回本地图块。',
    'tiles.phase.aiFailedTitle': 'AI 材质评测未完成',
    'tiles.phase.aiFailedSummary': '显示当前 Job 的 reason 与 retry_hint；不自动重试或追加调用。',
    'tiles.sourceTitle': '材质来源',
    'tiles.sourceChoose': '可选：选择材质源图片',
    'tiles.sourceHelp': 'PNG / WebP / JPEG · 图集结构仍由本地代码负责',
    'tiles.contractTitle': '地图合同',
    'tiles.field.width': '宽度',
    'tiles.field.height': '高度',
    'tiles.field.density': '密度',
    'tiles.field.seed': '种子',
    'tiles.field.solver': '求解器',
    'tiles.field.border': '边界',
    'tiles.bindingTitle': '构建绑定',
    'tiles.binding.emptyTitle': '尚未建立构建绑定',
    'tiles.binding.readyTitle': '当前输入已就绪',
    'tiles.binding.buildingTitle': '构建绑定已封存',
    'tiles.binding.completeTitle': '当前构建绑定一致',
    'tiles.binding.failedTitle': '失败绑定已封存',
    'tiles.binding.staleTitle': '构建绑定已过期',
    'tiles.primary.empty': '开始编辑',
    'tiles.primary.ready': '构建图块集',
    'tiles.primary.building': '正在构建…',
    'tiles.primary.rebuild': '按当前输入重新构建',
    'tiles.primary.aiPlan': '生成零调用计划',
    'tiles.primary.aiRun': '确认并运行 4 次调用',
    'tiles.primary.aiRunning': '评测运行中…',
    'tiles.primary.aiReturn': '返回本地构建',
    'tiles.primary.aiReplan': '重新计划（0 调用）',
    'tiles.stage.empty': '地图画布',
    'tiles.stage.ready': '角点网格编辑器',
    'tiles.stage.building': '构建观察',
    'tiles.stage.complete': '验证结果',
    'tiles.stage.failed': '构建失败',
    'tiles.stage.stale': '旧结果参考',
    'tiles.stage.aiSetup': '评测计划',
    'tiles.stage.aiPlanReady': '零调用计划',
    'tiles.stage.aiRunning': '评测观察',
    'tiles.stage.aiReview': '评测报告',
    'tiles.stage.aiFailed': '失败边界',
    'tiles.empty.title': '从角点网格开始',
    'tiles.empty.body': '调整地图尺寸、密度与种子，也可以选择一张材质源。\n结构始终由本地 16-mask 规则和确定性代码负责。',
    'tiles.empty.truth': '无自动 AI 调用 · 无示例结果回填',
    'tiles.editor.toolbarLabel': '角点网格编辑工具',
    'tiles.editor.paint': '绘制区域',
    'tiles.editor.erase': '擦除',
    'tiles.editor.cornerSolid': '角点 +',
    'tiles.editor.cornerEmpty': '角点 −',
    'tiles.editor.clear': '清除编辑',
    'tiles.editor.canvasLabel': '8×6 角点网格地图预览',
    'tiles.editor.canvasDynamicLabel': '{width}×{height} 角点网格地图预览',
    'tiles.editor.resultAlt': '当前任务生成的地图编辑器预览',
    'tiles.contract.cardTitle': '本地确定性角点网格',
    'tiles.contract.cardBody': '规则：corner_mask_16\n逻辑格：32×32\nSprite cell：64×64\n固定高度：24 px\n调色板：最多 32 色\nProvider 调用：0',
    'tiles.editor.methodTitle': '编辑方式',
    'tiles.editor.methodBody': '拖动单元格绘制/擦除矩形；\n点击网格角点设置实心或空白。\n所有操作都会进入本次构建绑定。',
    'tiles.job.buildingTitle': '后台正在构建严格图集',
    'tiles.job.buildingRecovery': '等待当前 Job 完成；传输中断时只继续观察该 Job。',
    'tiles.job.completeTitle': '验证与导出已就绪',
    'tiles.job.completeRecovery': '18 类证据与导出均绑定当前 Job。',
    'tiles.job.staleTitle': '旧结果已锁定',
    'tiles.job.staleRecovery': '按当前输入重新构建后，新的下载和证据才会解锁。',
    'tiles.failed.title': '本地构建未完成',
    'tiles.failed.reason': '原始原因：当前任务失败',
    'tiles.failed.recovery': '当前输入和编辑操作仍保留；重新构建会创建一个新的 Job。',
    'tiles.ai.briefTitle': '材质说明',
    'tiles.ai.descriptionDefault': '苔藓悬崖草地方块，冷色石壁，清晰像素材质分区。',
    'tiles.ai.descriptionPlaceholder': '苔藓悬崖草地方块，冷色石壁，清晰像素材质分区。',
    'tiles.ai.optionsTitle': '评测参数',
    'tiles.ai.candidates': '候选数',
    'tiles.ai.imageSize': '图像尺寸',
    'tiles.ai.maxCalls': '最大调用',
    'tiles.ai.provider': 'Provider',
    'tiles.ai.bindingTitle': '评测绑定',
    'tiles.ai.bindingSetup': '尚未生成评测计划',
    'tiles.ai.bindingFailed': '当前 Job 已终止',
    'tiles.ai.failureBindingDetail': 'reason / retry_hint / 已用调用均以 Job 返回为准',
    'tiles.ai.confirmBudget': '已确认本次最多 4 次 Provider 调用',
    'tiles.ai.confirmReadOnly': '原计划与已用调用只读保留',
    'tiles.ai.providerStateTitle': 'Gemini 原生路由待计划校验',
    'tiles.ai.providerFailedTitle': 'Provider 调用未自动重试',
    'tiles.ai.providerFailedDetail': '失败候选不作结果复用；最终图块仍由本地确定性代码生成。',
    'tiles.ai.zeroCallNotice': '本步骤只写入零调用计划，不会消费 Provider 配额。',
    'tiles.ai.planTitle': '先生成评测计划，再决定是否消耗 Provider 配额',
    'tiles.ai.plan.subject': '评测对象',
    'tiles.ai.plan.subjectValue': 'Provider 原始材质源，不是最终图集',
    'tiles.ai.plan.candidates': '候选数',
    'tiles.ai.plan.image': '图像配置',
    'tiles.ai.plan.provider': 'Provider',
    'tiles.ai.plan.budget': '当前调用',
    'tiles.ai.plan.next': '下一步',
    'tiles.ai.reviewTitle': '材质候选评测完成',
    'tiles.ai.reviewBoundary': '报告只比较 Provider 原始材质源；最终严格图集、验证和导出仍由本地代码负责。',
    'tiles.ai.evaluationOutcome': '评测结论',
    'tiles.ai.selectedCases': '选中候选',
    'tiles.ai.reviewConclusion': '审阅结论',
    'tiles.ai.failed.kicker': 'FAILED BENCHMARK JOB',
    'tiles.ai.failed.title': '先读取失败原因；新运行必须重新确认新的 Provider 配额',
    'tiles.ai.failed.job': 'Job',
    'tiles.ai.failed.status': '状态',
    'tiles.ai.failed.plan': '计划',
    'tiles.ai.failed.budget': '预算',
    'tiles.ai.failed.cancel': '取消',
    'tiles.ai.failed.outputs': '输出',
    'tiles.ai.failed.currentReceipt': '当前 Job receipt',
    'tiles.ai.failed.planRetained': '原计划保留 · 不可自动重交',
    'tiles.ai.failed.noCancel': '无此能力',
    'tiles.ai.failed.notGenerated': 'not generated',
    'tiles.runtime.localPreview': '本地预览 · 0 Provider',
    'tiles.runtime.stale': '旧结果 · 输出已锁定',
    'tiles.runtime.zeroCallPlan': '零调用计划 · 未调用 Gemini',
    'tiles.runtime.submissionUnknown': '提交结果未知 · 调用次数未知',
    'tiles.runtime.localBuilding': '同一 Job · 0 Provider',
    'tiles.runtime.localComplete': '证据已就绪',
    'tiles.runtime.localFailed': '终态 · 0 Provider',
    'tiles.runtime.localStale': '下载已锁定',
    'tiles.runtime.aiSetup': '计划阶段 · 0 calls',
    'tiles.runtime.aiPlanReady': '已封存 · 0/{max} calls',
    'tiles.runtime.aiRunning': '权威预算 · {used}/{max}',
    'tiles.runtime.aiReview': '报告已就绪',
    'tiles.runtime.aiFailed': '权威预算 · 读取 Job',
    'tiles.stageMetrics.localBuilding': '{status} · Job {job}',
    'tiles.stageMetrics.localEmpty': '{width}×{height} · 角点网格未编辑',
    'tiles.stageMetrics.localReady': '{width}×{height} · corner_mask_16 · {count} 项编辑',
    'tiles.stageMetrics.localComplete': 'done · 18 类产物 · 0 Provider',
    'tiles.stageMetrics.localFailed': '{status} · Job {job}',
    'tiles.stageMetrics.localStale': 'stale · 当前输入未构建',
    'tiles.stageMetrics.aiSetup': '尚未封存 · 0 Provider 调用',
    'tiles.stageMetrics.aiPlanReady': '{count} candidates · 1K · 1:1 · used 0',
    'tiles.stageMetrics.aiRunning': '{status} · Job {job}',
    'tiles.stageMetrics.aiReview': 'done · report bound · {used}/{max} calls',
    'tiles.stageMetrics.aiFailed': '{status} · 当前 Job',
    'tiles.source.procedural': '程序化材质',
    'tiles.editsCount': '{count} 项编辑',
    'tiles.binding.zeroRequests': '程序化/本地来源 · 0 个服务请求',
    'tiles.binding.notSubmitted': '尚未提交 · 0 Provider',
    'tiles.binding.failedDetail': '输入与编辑仍保留 · 输出锁定',
    'tiles.binding.oldKey': '旧选项 Key',
    'tiles.binding.newKey': '当前选项 Key',
    'tiles.jobLabel': '任务',
    'tiles.stateLabel': '状态',
    'tiles.error.originalReason': '原始原因',
    'tiles.error.unknown': '未知图块流程错误',
    'tiles.error.reportBinding': '评测报告与当前任务不匹配',
    'tiles.error.sourceType': '请选择 PNG、JPEG 或 WebP 材质源。',
    'tiles.error.sourceSize': '材质源图片不能超过 32 MiB。',
    'tiles.error.previewUnavailable': '当前任务的预览无法显示；所有输出继续锁定。',
    'tiles.output.available': '可用',
    'tiles.output.downloadable': '可下载',
    'tiles.output.viewable': '可查看',
    'tiles.output.generating': '生成中',
    'tiles.output.locked': '已锁定',
    'tiles.output.waiting': '等待',
    'tiles.output.notGenerated': '未生成',
    'tiles.primary.resumeSameJob': '继续观察同一个任务',
    'tiles.primary.aiRunCount': '确认并运行 {count} 次调用',
    'tiles.ai.bindingPlanReady': '零调用评测计划已核验',
    'tiles.ai.candidateSummary': '{count} 个候选 · 1K · 1:1',
    'tiles.ai.callSummary': 'Provider 调用：{used}/{max}',
    'tiles.ai.providerReady': 'Gemini 原生路由已就绪 · {model}',
    'tiles.ai.providerPending': 'Gemini 路由待校验',
    'tiles.ai.nextConfirm': '确认已封存的调用预算',
    'tiles.ai.nextPlan': '生成并审阅零调用计划',
    'tiles.ai.confirmBudgetCount': '已确认本次最多 {count} 次 Provider 调用',
    'tiles.ai.releaseReady': '可扩大样本',
    'tiles.ai.releaseLocked': '需要审阅',
    'tiles.jobStatus.queued': '排队中',
    'tiles.jobStatus.generating': '生成中',
    'tiles.jobStatus.post_processing': '后处理中',
    'tiles.jobStatus.done': '已完成',
    'tiles.jobStatus.failed_post_processing': '后处理失败',
    'tiles.jobStatus.failed_model_error': '模型失败',
    'tiles.jobStatus.failed_safety_filter': '安全过滤阻断',
    'tiles.jobStatus.not_found': '任务不存在',
    'tiles.output.localTitle': '产物',
    'tiles.output.aiTitle': '证据',
    'tiles.output.truth.empty': '构建完成前，所有产物入口保持锁定；完整清单共 18 类证据与导出。',
    'tiles.output.truth.ready': '生成前保持锁定；预览只代表当前浏览器输入，不是后台构建结果。',
    'tiles.output.truth.building': '当前任务完成并通过绑定校验前，所有产物保持锁定。',
    'tiles.output.truth.complete': '严格图集、地图预览、Tiled/LDtk 与已验证下载包均来自当前 Job；不回填历史产物。',
    'tiles.output.truth.failed': '失败 Job 的产物不可作为当前结果；重新构建会创建新的 Job。',
    'tiles.output.truth.stale': '保留旧预览只用于比较；所有可下载入口在当前输入重新构建前保持锁定。',
    'tiles.output.truth.aiSetup': '计划操作只写入 JSON，不调用 Provider；运行按钮在计划与人工配额确认前不可用。',
    'tiles.output.truth.aiPlanReady': '确认只授权本计划的 4 次调用；失败不会自动重试，也不会提高配额。',
    'tiles.output.truth.aiRunning': '调用次数只取 Job 返回的 provider_call_budget；运行时不展示假候选或推测进度。',
    'tiles.output.truth.aiReview': '计划、报告和说明绑定同一 run；最终严格图集仍需回到本地构建流程生成。',
    'tiles.output.truth.aiFailed': 'reason、retry_hint 与调用次数只取当前 Job；恢复从新的 0 调用计划开始。',
  }),
})

export const STUDIO_TRANSLATIONS = Object.freeze({
  en: Object.freeze({
    ...STUDIO_ACTION_TRANSLATIONS.en,
    ...STUDIO_SEQUENCE_TRANSLATIONS.en,
    ...STUDIO_TILES_TRANSLATIONS.en,
    'app.title': 'MoteWeave Studio',
    'app.previewNotice': 'Parallel preview — the current workspace remains available.',
    'app.fileModeTitle': 'File preview: real interactions are locked',
    'app.fileModeMessage': 'Run npm start and open Studio through the local service. A direct file:// page cannot access /api.',
    'nav.settings': 'Settings',
    'nav.mainLabel': 'Main navigation',
    'nav.legacy': 'Current workspace',
    'nav.character': 'Character',
    'nav.motion': 'Motion',
    'nav.sequence': 'Sequence',
    'nav.tiles': 'Tiles',
    'nav.scene': 'Scene',
    'nav.project': 'Project',
    'nav.qa': 'Self-check',
    'settings.headerTitle': 'Settings',
    'settings.headerCrumb': '· Application',
    'settings.headerLocalSession': 'Local & session',
    'settings.langZh': '中文',
    'settings.langEn': 'EN',
    'settings.dashboard.title': 'Application settings',
    'settings.dashboard.subtitle': 'Only cross-module capabilities that really exist in this project are shown.',
    'settings.dashboard.realBadge': 'Real capabilities',
    'common.loading': 'Loading…',
    'common.checking': 'Checking…',
    'settings.title': 'Settings / Preferences',
    'settings.subtitle': 'Language, provider session, and local tool availability.',
    'settings.scope.title': 'Settings scope',
    'settings.scope.description': 'This first slice connects settings only. Generation remains disabled.',
    'settings.scope.parallel': 'The current workspace is unchanged and remains available.',
    'settings.scope.noGeneration': 'No image-generation request is made from this page.',
    'settings.language.title': 'Language',
    'settings.language.description': 'Choose the interface language for this browser.',
    'settings.language.label': 'Interface language',
    'settings.language.storageLabel': 'Stored in',
    'settings.language.storageValue': 'This browser: gameToolLanguage',
    'settings.language.persistNote': 'Applies immediately · stored in this browser',
    'settings.currentRoute.title': 'Current session Provider route',
    'settings.currentRoute.description': 'The server has one shared route at a time. The forms below switch it; “configured” does not mean a live connection was tested.',
    'settings.currentRoute.route': 'Current route',
    'settings.currentRoute.source': 'Configuration source',
    'settings.currentRoute.impact': 'Current impact',
    'settings.currentRoute.loading': 'Reading current route…',
    'settings.currentRoute.sessionSource': 'Current service session',
    'settings.currentRoute.environmentSource': 'Local environment',
    'settings.currentRoute.noSource': 'Not configured',
    'settings.currentRoute.unavailableSource': 'Status unavailable',
    'settings.currentRoute.undisclosedRoute': 'Advanced route undisclosed',
    'settings.currentRoute.nativeImpact': 'Native Gemini: Character Strict and advanced Tiles evaluation; also available to compatible Character and Scene.',
    'settings.currentRoute.sharedImpact': 'Compatible Character and Scene only; Character Strict and advanced Tiles evaluation remain locked until native Gemini is selected.',
    'settings.currentRoute.noneImpact': 'Provider-backed actions remain locked until a route is configured.',
    'settings.currentRoute.unknownImpact': 'Impact cannot be confirmed until the current route state is available.',
    'settings.provider.title': 'Switch to native Gemini',
    'settings.provider.description': 'Character Strict and advanced Tiles material evaluation require native Gemini. Saving replaces the current session route.',
    'settings.provider.type': 'Provider type',
    'settings.provider.geminiLocked': 'The primary route remains separate and capability-locked',
    'settings.provider.model': 'Model',
    'settings.provider.apiKey': 'API key',
    'settings.provider.apiKeyPlaceholder': 'Enter API key',
    'settings.provider.noEchoBadge': 'Not echoed',
    'settings.provider.showKey': 'Show API key',
    'settings.provider.hideKey': 'Hide API key',
    'settings.provider.save': 'Use for this session',
    'settings.provider.clear': 'Clear session config',
    'settings.provider.note': 'Keys are kept only in the running server process and are cleared from this field after saving.',
    'settings.provider.loadingBadge': 'Checking',
    'settings.provider.loading': 'Reading provider configuration…',
    'settings.provider.savingBadge': 'Saving',
    'settings.provider.saving': 'Saving the service-session provider…',
    'settings.provider.clearingBadge': 'Clearing',
    'settings.provider.clearing': 'Clearing the service-session provider…',
    'settings.provider.browserBadge': 'Service session',
    'settings.provider.browserConfigured': '{identity} is loaded for this service session. Connection has not been verified.',
    'settings.provider.localBadge': 'Local environment',
    'settings.provider.localConfigured': '{identity} is loaded from the local environment. Connection has not been verified.',
    'settings.provider.unconfiguredBadge': 'Not configured',
    'settings.provider.unconfigured': 'No service-session or local-environment credentials were detected.',
    'settings.provider.configErrorBadge': 'Configuration error',
    'settings.provider.configError': 'Provider configuration error: {error}',
    'settings.provider.unsupportedBadge': 'Unavailable',
    'settings.provider.unsupported': 'This server does not expose an implemented image provider.',
    'settings.provider.nonGeminiBadge': 'Gemini not active',
    'settings.provider.nonGemini': 'A non-Gemini provider is configured outside Studio. Saving this form replaces the service-session configuration with Gemini.',
    'settings.provider.stateErrorBadge': 'Status unavailable',
    'settings.provider.stateError': 'Could not read provider configuration: {error}',
    'settings.provider.serviceRequiredBadge': 'Local service required',
    'settings.provider.serviceRequired': 'Provider settings are unavailable in a direct file preview. Open Studio through the local MoteWeave service.',
    'settings.provider.actionErrorBadge': 'Update failed',
    'settings.provider.actionError': 'Provider configuration was not changed: {error}',
    'settings.provider.identityUnavailable': 'Provider configuration',
    'settings.provider.providerRequired': 'Choose a Provider before saving.',
    'settings.provider.modelAndKeyRequired': 'Model and API key are required.',
    'settings.provider.saved': 'Provider configuration saved',
    'settings.provider.cleared': 'Service-session provider cleared',
    'settings.provider.boundaryTitle': 'Session boundary',
    'settings.provider.boundaryProcess': 'Kept only in the current local Node service process',
    'settings.provider.boundaryRestart': 'Lost after a service restart or “Clear session config”',
    'settings.provider.boundaryUnverified': '“Configured” does not mean the connection has been verified',
    'settings.provider.boundarySources': 'Source is this service session, the local environment, or unconfigured',
    'settings.provider.supportedLabel': 'Studio configuration target',
    'settings.provider.explanationLabel': 'Note',
    'settings.provider.explanation': 'Model and API key are required and apply only to the current service session.',
    'settings.advancedProvider.title': 'Switch to advanced Provider',
    'settings.advancedProvider.summary': 'OpenRouter and compatible Base URL · service session only',
    'settings.advancedProvider.collapsedBadge': 'Advanced config',
    'settings.advancedProvider.description': 'Only advanced compatible Character and Scene online generation use this route. Saving replaces the current session route.',
    'settings.advancedProvider.provider': 'Provider',
    'settings.advancedProvider.baseUrl': 'Base URL (required for compatible mode)',
    'settings.advancedProvider.keyNote': 'The key input is cleared after saving, never echoed, and never written to browser storage.',
    'settings.advancedProvider.save': 'Save and activate',
    'settings.advancedProvider.readyToConfigure': 'Configure OpenRouter or a compatible Base URL.',
    'settings.advancedProvider.notActive': 'Not active',
    'settings.advancedProvider.active': 'Current session active',
    'settings.advancedProvider.environmentActive': 'Local environment active',
    'settings.advancedProvider.saving': 'Saving compatible Provider…',
    'settings.advancedProvider.saveFailed': 'Compatible Provider save failed: {error}',
    'settings.advancedProvider.statusRetained': 'The previous Provider state was retained. No Job, retry, or fallback was started.',
    'settings.advancedProvider.baseUrlRequired': 'Base URL is required for compatible mode.',
    'settings.advancedProvider.routeRequired': 'Select Provider route again',
    'settings.advancedProvider.routeUndisclosed': 'Active · route undisclosed',
    'settings.advancedProvider.routeUndisclosedDetail': 'The existing API does not return whether this session uses OpenRouter or a compatible Base URL. Select the route and enter the key again before saving.',
    'settings.advancedProvider.noCallsOnSave': 'Saving configuration does not start a Job or make a Provider call',
    'settings.advancedProvider.matrixTitle': 'Compatibility matrix',
    'settings.advancedProvider.compatCharacter': 'Advanced compatible Character',
    'settings.advancedProvider.sceneOnline': 'Scene online generation',
    'settings.advancedProvider.shared': 'Shared Provider',
    'settings.advancedProvider.nativeGemini': 'Native Gemini',
    'settings.tools.title': 'Local Tools',
    'settings.tools.description': 'Read-only detection of tools used by local media and matte workflows.',
    'settings.tools.ffmpeg': 'FFmpeg',
    'settings.tools.rembg': 'rembg',
    'settings.tools.refresh': 'Refresh detection',
    'settings.tools.noPolling': 'Detected once when this page opens and only again when you refresh it.',
    'settings.tools.checking': 'Checking…',
    'settings.tools.ready': 'Available',
    'settings.tools.unavailable': 'Unavailable',
    'settings.tools.unknown': 'Unknown',
    'settings.tools.loadingMessage': 'Checking local tool availability…',
    'settings.tools.completeMessage': 'Local tool detection completed.',
    'settings.tools.partialMessage': 'Detection completed; one or more local tools are unavailable.',
    'settings.tools.errorMessage': 'Could not read local tool status: {error}',
    'settings.tools.serviceRequired': 'Local service required',
    'settings.tools.serviceRequiredMessage': 'Local tool detection is locked in a direct file preview.',
    'settings.tools.ffmpegDescription': 'Video and motion-source processing',
    'settings.tools.rembgDescription': 'Optional local background removal',
    'settings.scope.workspaceTitle': 'Kept in the corresponding workspace',
    'settings.scope.characterScale': 'Character export scale 1x–4x',
    'settings.scope.exports': 'Godot / RPG Maker / OCAD exports',
    'settings.scope.editor': 'Editor Grid / Snap / Viewport',
    'settings.scope.motion': 'Motion, cleanup, and per-task options',
    'settings.scope.notProvidedTitle': 'Not currently provided',
    'settings.scope.notProvidedOne': 'Theme switching · shortcut editing · default export engine',
    'settings.scope.notProvidedTwo': 'Output-path picker · cloud sync · permanent API-key storage',
    'settings.scope.notProvidedReason': 'These capabilities are not implemented, so they are not shown as available controls.',
    'character.headerTitle': 'Character Studio',
    'character.headerCrumb': '· Strict Review',
    'character.localEntry': 'Local import',
    'character.aiEntry': 'AI generation',
    'character.export': 'Export pack',
    'character.exportLocked': 'Export after Accept',
    'character.exportRunning': 'Generating · export locked',
    'character.exportReviewRequired': 'Waiting for human Accept',
    'character.exportBlocked': 'Export blocked',
    'character.flowEyebrow': 'Current flow',
    'character.flowReview': 'Review',
    'character.reviewTitle': 'Create a one-call plan',
    'character.reviewSummary': 'Build a Provider-free Review, then explicitly confirm the only live call.',
    'character.profileSelectorLabel': 'Generation layout',
    'character.fixedProfileTab': 'Fixed-region',
    'character.topdownProfileTab': 'Topdown unavailable · authoritative Structure missing',
    'character.descriptionLabel': 'Character description',
    'character.descriptionPlaceholder': 'Example: a copper-haired ranger in a green coat with a crisp pixel silhouette',
    'character.descriptionHelp': 'This text is sealed into the Prompt and cannot change after Review is sealed.',
    'character.contractTitle': 'Strict Profile',
    'character.profileLabel': 'Profile',
    'character.layoutLabel': 'Layout',
    'character.imageLabel': 'Image',
    'character.budgetLabel': 'Call budget',
    'character.matteLabel': 'Background matte',
    'character.overridesLabel': 'Manual overrides',
    'character.overridesValue': 'none · Anchor (0, 0)',
    'character.frameLocksLabel': 'Frame adjustments',
    'character.frameLocksValue': 'empty · Locked animations empty',
    'character.normalizationLabel': 'Normalization',
    'character.normalizationValue': 'Auto-correct on · Stabilization on',
    'character.sealedTitle': 'Sealed binding',
    'character.reviewIdLabel': 'Review ID',
    'character.planHashLabel': 'Plan Hash',
    'character.referenceHashLabel': 'Reference Hash',
    'character.providerLabel': 'Provider',
    'character.modelLabel': 'Model',
    'character.sealedArtifactsLabel': 'Sealed Review artifacts',
    'character.reviewLinkReview': 'Review',
    'character.reviewLinkRequest': 'Request',
    'character.reviewLinkReferences': 'References',
    'character.reviewLinkPrompt': 'Prompt',
    'character.reviewEvidenceTitle': 'Human review',
    'character.strictFixedRegionLabel': 'Strict fixed-region',
    'character.oneCallSealedJob': '1-call sealed Job',
    'character.sealedSubmissionUnknown': 'sealed submission · Job receipt unknown',
    'character.pendingRestoreExistingArtifacts': 'existing sealed Job / Review artifacts only',
    'character.runningAuthorityTitle': 'Job phase is derived only from the server receipt',
    'character.runningProviderComplete': 'Provider response received · Raw persisted before post-processing',
    'character.runningProviderPending': 'Waiting for the Provider response and Raw persistence',
    'character.runningStopped': 'The strict Job stopped before Raw was persisted',
    'character.runningSubmissionUnknown': 'Submission outcome is unknown; no Job receipt was returned',
    'character.runningPendingRestoreLoading': 'Reading the sealed Job / Review artifacts',
    'character.runningPendingRestoreInterrupted': 'The artifact read was interrupted; the same selector can be retried',
    'character.runningPendingRestoreFailed': 'The sealed artifacts failed structural or binding verification',
    'character.networkFinished': '· network phase finished',
    'character.networkStatePending': '· waiting for network-phase receipt',
    'character.networkStateStopped': '· network phase stopped',
    'character.networkStateUnknown': '· network outcome unknown',
    'character.networkPendingRestoreReadOnly': '· read-only artifact GET · no Provider POST',
    'character.providerCallsLabel': 'Provider calls',
    'character.rawProvenanceLabel': 'Raw provenance',
    'character.currentPhaseLabel': 'Current phase',
    'character.rawSealedPhase': 'Raw sealed',
    'character.publicationLabel': 'Accepted download record',
    'character.bindingLabel': 'Binding',
    'character.sealedValue': 'sealed',
    'character.sourceJobLabel': 'Source Job',
    'character.releaseEvidenceLabel': 'Download verification evidence',
    'character.gateLabel': 'Gate',
    'character.acceptedSealedValue': 'accepted · sealed',
    'character.outputLabel': 'Output',
    'character.packLabel': 'Pack',
    'character.enginesLabel': 'Engines',
    'character.topdownProfileLabel': 'Topdown Profile',
    'character.strictProfileLabel': 'Strict Profile',
    'character.structureLabel': 'Structure',
    'character.missingRequiredValue': 'missing · required',
    'character.blockedPreCallValue': '0 · blocked pre-call',
    'character.statusLabel': 'Status',
    'character.comingLaterValue': 'Coming later',
    'character.manualGateLabel': 'Manual gate',
    'character.explicitHumanAcceptValue': 'explicit human Accept',
    'character.nextLabel': 'Next',
    'character.sealPublicationValue': 'seal accepted verified download',
    'character.issueCountLabel': 'Confirmed issue count',
    'character.evidencePending': 'Waiting for real evidence integrity checks.',
    'character.reviewAction': 'Build Review package (0 calls)',
    'character.resetAction': 'Return to Review (no automatic call)',
    'character.stageLabel': 'Preview stage',
    'character.reviewKicker': 'Waiting for Review package',
    'character.reviewStageTitle': 'Plan / Reference Hash not sealed',
    'character.reviewStageSummary': 'Review does not call the Provider and cannot show Raw or generated output.',
    'character.placeholderLabel': 'Waiting for real result',
    'character.placeholderText': 'Waiting for real evidence',
    'character.rawEvidence': 'Raw · SHA bound',
    'character.rawAlt': 'Raw Provider output',
    'character.backgroundEvidence': 'Full-resolution background-removed result',
    'character.backgroundAlt': 'Full-resolution background-removed Provider output',
    'character.normalizedEvidence': 'Normalized · derived',
    'character.normalizedAlt': 'Normalized production sheet; derived evidence, not Raw',
    'character.normalizedFileNote': 'normalized_sheet.png · not Raw',
    'character.previewEvidence': 'Six-base preview',
    'character.previewAlt': 'Six-base background preview',
    'character.previewEvidenceHelp': 'White-speck and edge inspection',
    'character.spillEvidence': 'Spill Overlay',
    'character.spillAlt': 'Spill and mask diagnostic overlay',
    'character.sureBackgroundAlt': 'Sure Background classification mask',
    'character.unknownAlt': 'Unknown Band classification mask',
    'character.sureForegroundAlt': 'Sure Foreground classification mask',
    'character.alphaAlt': 'Background Matte V2 estimated Alpha',
    'character.reconstructionAlt': 'Background Matte V2 foreground reconstruction',
    'character.sureBackgroundEvidence': 'Sure Background',
    'character.unknownEvidence': 'Unknown Band',
    'character.sureForegroundEvidence': 'Sure Foreground',
    'character.alphaEvidence': 'Alpha Estimate',
    'character.reconstructionEvidence': 'Foreground Reconstruction',
    'character.verifiedArtifactsLabel': 'Verified evidence files and SHA-256 hashes',
    'character.blockingTitle': 'Blocking requirements',
    'character.blockProfile': 'Profile · locked',
    'character.blockStructure': 'Structure · missing',
    'character.blockPrompt': 'Prompt · blocked',
    'character.blockModel': 'Model · locked',
    'character.blockBudget': 'Budget · zero',
    'character.blockHashes': 'Hashes · unsealed',
    'character.blockReview': 'Review · unavailable',
    'character.releasePack': 'Verified Character download',
    'character.releaseEngine': 'Engine pack',
    'character.pipelineLabel': 'Pipeline',
    'character.pipelineRaw': 'Raw',
    'character.pipelineMatte': 'Matte',
    'character.pipelineCount': 'Subject count',
    'character.pipelineEvidence': 'Evidence',
    'character.pipelineQuality': 'Quality',
    'character.pipelinePreview': 'Preview',
    'character.pipelineAccept': 'Manual Accept',
    'character.pipelineReview': 'Review',
    'character.pipelineOutput': 'Output',
    'character.pipelineSixBase': 'Six-base',
    'character.pipelineSpill': 'Spill',
    'character.pipelineSureBackground': 'Sure BG',
    'character.pipelineUnknown': 'Unknown',
    'character.pipelineSureForeground': 'Sure FG',
    'character.pipelineIdle': 'idle',
    'character.pipelineWalkDown': 'walk_down',
    'character.pipelineWalkUp': 'walk_up',
    'character.pipelineWalkLeft': 'walk_left',
    'character.pipelineWalkRight': 'walk_right',
    'character.pipelineAttack': 'attack',
    'character.pipelineHurt': 'hurt',
    'character.pipelineProfile': 'Profile',
    'character.pipelineStructure': 'Structure',
    'character.pipelinePrompt': 'Prompt',
    'character.pipelineModel': 'Model',
    'character.pipelineBudget': 'Budget',
    'character.pipelineHashes': 'Hashes',
    'character.pipelineWait': 'waiting',
    'character.pipelineCurrent': 'current',
    'character.pipelineLocked': 'locked',
    'character.noProviderYet': 'Provider has not been called',
    'character.rawPersisted': 'Raw persisted before local post-processing',
    'character.jobCallsUnknown': 'Provider call usage unknown · observing this Job only',
    'character.jobCallsKnown': '{status} · Provider calls {used}/1 · no retry',
    'character.reviewArtifactCount': '{count}/11 Matte V2 artifacts verified · manual review required',
    'character.acceptedPipelineDetail': 'Accepted result verified · download unlocked',
    'character.topdownPipelineDetail': 'Blocked before Review · Provider calls 0',
    'character.descriptionRequired': 'Enter a character description before building Review.',
    'character.issueCountInvalid': 'Confirmed issue count must be a non-negative integer.',
    'character.unknownError': 'Unknown error',
    'character.failureDetail': 'Failure detail: {error}',
    'character.matteNotActivated': 'not activated',
    'character.maskSummary': '{count}/11 · Sure Background / Unknown Band / Sure Foreground',
    'character.discardReviewAction': 'Discard this sealed Review and return to editing (0 calls)',
    'character.statusReviewPending': 'review_pending · 0 calls',
    'character.statusRestoringPublication': 'Restoring accepted download · 0 Provider calls',
    'character.statusPendingRestoreLoading': 'restoring_pending_evidence · read-only GET',
    'character.statusPendingRestoreInterrupted': 'pending_evidence_read_interrupted · 0 Provider calls',
    'character.statusPendingRestoreFailed': 'pending_evidence_rejected · fail-closed',
    'character.statusBlockedPreReview': 'blocked_pre_review · 0 calls',
    'character.statusReady': 'ready · 0/1',
    'character.statusReviewRequired': 'review_required · 1/1',
    'character.statusReviewRequiredZero': 'review_required · 0 Provider calls',
    'character.statusAccepted': 'accepted',
    'character.statusCallsKnown': '{status} · {used}/1',
    'character.statusCallsUnknown': '{status} · calls unknown',
    'character.phaseReview': 'Review',
    'character.phaseConfirm': 'Confirm',
    'character.phaseReviewRequired': 'Review Required',
    'character.phaseAccepted': 'Accepted',
    'character.phaseTopdown': 'Topdown',
    'character.phasePendingRestoreLoading': 'Restore Pending Evidence',
    'character.phasePendingRestoreInterrupted': 'Restore Interrupted',
    'character.phasePendingRestoreFailed': 'Restore Rejected',
    'character.jobStatusQueued': 'queued',
    'character.jobStatusGenerating': 'generating',
    'character.jobStatusPostProcessing': 'post_processing',
    'character.jobStatusDone': 'done',
    'character.jobStatusFailedQuality': 'failed_quality_gate',
    'character.jobStatusFailedSafety': 'failed_safety_filter',
    'character.jobStatusFailedModel': 'failed_model_error',
    'character.jobStatusFailedPost': 'failed_post_processing',
    'character.jobStatusNotFound': 'not_found',
    'character.jobStatusRequestFailed': 'request_failed',
    'character.jobStatusEvidenceError': 'evidence_error',
    'character.jobStatusPollInterrupted': 'poll_interrupted',
    'character.jobStatusSubmissionUnknown': 'submission_unknown',
    'character.reviewBuilding': 'Building a Provider-free Review package…',
    'character.reviewReady': 'Review is sealed. Verify the hashes before confirming the one live call.',
    'character.confirmTitle': 'Confirm one Provider call',
    'character.confirmSummary': 'Profile, Prompt, references, model, 2K / 1:1, and the 1-call budget are sealed.',
    'character.confirmKicker': 'Review package sealed',
    'character.confirmStageTitle': 'Profile / Prompt / References are immutable',
    'character.confirmStageSummary': 'Confirmation may use Gemini once. There is no retry, Provider fallback, or model fallback.',
    'character.confirmAction': 'Confirm and start generation (maximum 1 call)',
    'character.confirming': 'Submitting the sealed binding. This action is never retried automatically…',
    'character.runningTitle': 'Provider finished or generation in progress',
    'character.runningSummary': 'The current job is the only authority. No additional Provider call will be made.',
    'character.runningKicker': 'One-call job in progress',
    'character.runningStageTitle': 'Waiting for real job evidence',
    'character.runningStageSummary': 'Raw imagery stays hidden until the complete review_required evidence gate.',
    'character.runningAction': 'Processing · no further Provider call',
    'character.reviewRequiredTitle': 'Evidence is ready; human Accept is required',
    'character.reviewRequiredSummary': 'Automatic analysis is evidence only. It never accepts or rejects the result.',
    'character.reviewRequiredKicker': 'Real evidence loaded',
    'character.reviewRequiredStageTitle': 'Inspect Raw, six-base preview, Spill, and Masks',
    'character.reviewRequiredStageSummary': 'Export remains locked until an explicit manual Accept passes integrity checks.',
    'character.acceptAction': 'Accept and unlock download (human)',
    'character.accepting': 'Creating the verified download from the exact reviewed evidence with 0 Provider calls…',
    'character.evidenceVerified': 'Evidence hashes verified. Manual Accept is available.',
    'character.evidenceInvalid': 'Evidence integrity check failed: {error}',
    'character.acceptFailed': 'The reviewed evidence remains displayed, but the verified download did not complete: {error}. Retrying sends only the same 0-call Accept request.',
    'character.evidenceImageFailed': 'A verified evidence image could not be displayed. Accept remains locked.',
    'character.acceptedTitle': 'Accepted manually; export is available',
    'character.acceptedSummary': 'The Character download passed its integrity and download gates.',
    'character.acceptedKicker': 'Accepted · download verified',
    'character.acceptedStageTitle': 'character_pack.zip · immutable',
    'character.acceptedStageSummary': 'The links below come only from the successful manual Accept response.',
    'character.acceptedImageAlt': 'Accepted normalized character sheet',
    'character.openAccepted': 'Open accepted export',
    'character.topdownTitle': 'Topdown Profile is not activated',
    'character.topdownSummary': 'The authoritative Structure is unavailable, so Review and Provider use are blocked before any call.',
    'character.topdownKicker': 'Topdown disabled',
    'character.topdownStageTitle': 'No authoritative Review can be sealed',
    'character.topdownStageSummary': 'There is no fixed-region substitution, fallback, Provider call, Accept, or export.',
    'character.topdownAction': 'Unavailable · authoritative Structure missing',
    'character.failedTitle': 'The strict job stopped safely',
    'character.failedSummary': 'No retry or fallback was started. Inspect the exact failure before returning to Review.',
    'character.failedKicker': 'Fail-closed',
    'character.failedStageTitle': 'Generation did not reach the manual review gate',
    'character.failedStageSummary': 'The failure reason and call budget below come from the real job response.',
    'character.submissionUnknownTitle': 'The generation submission result is unknown',
    'character.submissionUnknownSummary': 'No Job receipt was returned, so Provider-call usage cannot be inferred and this Review cannot be resubmitted.',
    'character.submissionUnknownKicker': 'Submission outcome unknown',
    'character.submissionUnknownStageTitle': 'No authoritative Job is available',
    'character.submissionUnknownStageSummary': 'No retry or fallback is offered. Inspect server records before creating any new Review.',
    'character.observationInterruptedTitle': 'Job observation was interrupted',
    'character.observationInterruptedSummary': 'The existing Job remains authoritative. Resume GET observation without another generation call.',
    'character.observationInterruptedKicker': 'Observation interrupted',
    'character.observationInterruptedStageTitle': 'Resume this same Job only',
    'character.observationInterruptedStageSummary': 'The Studio will not POST another generation request or infer a terminal status.',
    'character.pendingRestoreLoadingTitle': 'Restoring the completed Job for human review',
    'character.pendingRestoreLoadingSummary': 'Only the sealed Job and Review artifacts are being read. No Provider request is sent.',
    'character.pendingRestoreLoadingKicker': 'Read-only recovery',
    'character.pendingRestoreLoadingStageTitle': 'Verifying the exact Job / Review binding',
    'character.pendingRestoreLoadingStageSummary': 'Profile, hashes, one successful 1/1 attempt, verified-download gate, and evidence ledger must all match.',
    'character.pendingRestoreLoadingAction': 'Restoring pending evidence (0 Provider calls)',
    'character.pendingRestoreInterruptedTitle': 'Pending evidence read was interrupted',
    'character.pendingRestoreInterruptedSummary': 'The same Job and Review remain authoritative; retry only their read-only artifact GETs.',
    'character.pendingRestoreInterruptedKicker': 'Artifact observation interrupted',
    'character.pendingRestoreInterruptedStageTitle': 'Retry this same Job / Review selector only',
    'character.pendingRestoreInterruptedStageSummary': 'No Review or generation POST is permitted by this recovery path.',
    'character.retryPendingRestore': 'Retry this evidence restore (0 Provider calls)',
    'character.pendingRestoreFailedTitle': 'Pending evidence was rejected safely',
    'character.pendingRestoreFailedSummary': 'The sealed artifacts did not match the required structure or binding. Accept and export stay locked.',
    'character.pendingRestoreFailedKicker': 'Recovery fail-closed',
    'character.pendingRestoreFailedStageTitle': 'This selector is not a valid review-required candidate',
    'character.pendingRestoreFailedStageSummary': 'Structural and binding failures are terminal; no generation, fallback, or retry is offered.',
    'character.pendingRestoreFailedAction': 'Pending evidence invalid · no generation started',
    'character.evidenceFailedTitle': 'Local evidence verification stopped safely',
    'character.evidenceFailedSummary': 'No generation or Provider call was started; Accept and export stay locked until the existing evidence or accepted download verifies.',
    'character.evidenceFailedKicker': 'Evidence fail-closed',
    'character.evidenceFailedStageTitle': 'Evidence is incomplete or could not be displayed',
    'character.evidenceFailedStageSummary': 'Verify only the existing generated or accepted-download files with 0 Provider calls.',
    'character.evidenceUnavailableAction': 'Existing accepted-download evidence unavailable · no generation started',
    'character.requestFailed': '{error}',
    'character.callsNone': '0/1 · no retry / no fallback',
    'character.callsOne': '1/1 · no retry / no fallback',
    'character.callsUnknown': 'unknown · no retry / no fallback',
    'character.geminiNotReady': 'No eligible native Gemini session is configured. Open Settings and configure Gemini before Review.',
    'character.recheckEvidence': 'Recheck the same Job evidence (0 calls)',
    'character.restoringPublicationAction': 'Restoring accepted download (0 calls)',
    'character.resumeObservation': 'Resume observing this Job (0 calls)',
    'character.acceptNotReady': 'Accept stays locked until all 11 Matte V2 artifacts and byte hashes verify.',
  }),
  zh: Object.freeze({
    ...STUDIO_ACTION_TRANSLATIONS.zh,
    ...STUDIO_SEQUENCE_TRANSLATIONS.zh,
    ...STUDIO_TILES_TRANSLATIONS.zh,
    'app.title': 'MoteWeave Studio',
    'app.previewNotice': '并行预览——当前工作区仍可继续使用。',
    'app.fileModeTitle': '当前是文件预览，真实交互已锁定',
    'app.fileModeMessage': '请先运行 npm start，再通过本地服务打开 Studio；直接 file:// 打开无法访问 /api。',
    'nav.settings': '设置',
    'nav.mainLabel': '主导航',
    'nav.legacy': '当前工作区',
    'nav.character': '角色',
    'nav.motion': '动作',
    'nav.sequence': '序列',
    'nav.tiles': '图块',
    'nav.scene': '场景',
    'nav.project': '项目',
    'nav.qa': '自检',
    'settings.headerTitle': '设置',
    'settings.headerCrumb': '· 应用',
    'settings.headerLocalSession': '本地与会话',
    'settings.langZh': '中文',
    'settings.langEn': 'EN',
    'settings.dashboard.title': '应用设置',
    'settings.dashboard.subtitle': '只包含跨模块生效且项目中真实存在的能力。',
    'settings.dashboard.realBadge': '真实能力',
    'common.loading': '加载中…',
    'common.checking': '检查中…',
    'settings.title': '设置 / 偏好',
    'settings.subtitle': '管理语言、Provider 会话和本地工具可用状态。',
    'settings.scope.title': '设置范围',
    'settings.scope.description': '第一阶段只接入设置；生成功能仍保持禁用。',
    'settings.scope.parallel': '当前工作区没有改变，仍可继续使用。',
    'settings.scope.noGeneration': '此页面不会发起图像生成请求。',
    'settings.language.title': '语言',
    'settings.language.description': '选择此浏览器中的界面语言。',
    'settings.language.label': '界面语言',
    'settings.language.storageLabel': '保存位置',
    'settings.language.storageValue': '此浏览器的 gameToolLanguage',
    'settings.language.persistNote': '立即生效 · 保存在此浏览器',
    'settings.currentRoute.title': '当前会话 Provider 路由',
    'settings.currentRoute.description': '服务端同一时间只有一条共享路由；下方表单用于切换它；“已配置”不代表已实测连接。',
    'settings.currentRoute.route': '当前路由',
    'settings.currentRoute.source': '配置来源',
    'settings.currentRoute.impact': '当前影响',
    'settings.currentRoute.loading': '正在读取当前路由…',
    'settings.currentRoute.sessionSource': '当前服务会话',
    'settings.currentRoute.environmentSource': '本地环境',
    'settings.currentRoute.noSource': '未配置',
    'settings.currentRoute.unavailableSource': '状态不可用',
    'settings.currentRoute.undisclosedRoute': '高级路由未披露',
    'settings.currentRoute.nativeImpact': '原生 Gemini：Character Strict 与高级 Tiles 材质评测；也可供兼容 Character 与 Scene 使用。',
    'settings.currentRoute.sharedImpact': '仅兼容 Character 与 Scene 可用；切回原生 Gemini 前，Character Strict 与高级 Tiles 材质评测保持锁定。',
    'settings.currentRoute.noneImpact': '配置一条路由前，所有 Provider 支持的操作保持锁定。',
    'settings.currentRoute.unknownImpact': '读取当前路由状态前无法确认影响范围。',
    'settings.provider.title': '切换到原生 Gemini',
    'settings.provider.description': 'Character Strict 与高级 Tiles 材质评测要求原生 Gemini；保存会替换当前会话路由。',
    'settings.provider.type': '服务提供方',
    'settings.provider.geminiLocked': '主路由保持独立，能力真值固定',
    'settings.provider.model': '模型',
    'settings.provider.apiKey': 'API Key',
    'settings.provider.apiKeyPlaceholder': '输入 API Key',
    'settings.provider.noEchoBadge': '不回显',
    'settings.provider.showKey': '显示 API Key',
    'settings.provider.hideKey': '隐藏 API Key',
    'settings.provider.save': '用于本次会话',
    'settings.provider.clear': '清除会话配置',
    'settings.provider.note': '密钥只保存在当前服务器进程中；保存后会立即从此输入框清除。',
    'settings.provider.loadingBadge': '检查中',
    'settings.provider.loading': '正在读取服务提供方配置…',
    'settings.provider.savingBadge': '保存中',
    'settings.provider.saving': '正在保存服务会话配置…',
    'settings.provider.clearingBadge': '清除中',
    'settings.provider.clearing': '正在清除服务会话配置…',
    'settings.provider.browserBadge': '服务会话',
    'settings.provider.browserConfigured': '已为本次服务会话加载 {identity}；尚未验证实际连接。',
    'settings.provider.localBadge': '本地环境',
    'settings.provider.localConfigured': '已从本地环境加载 {identity}；尚未验证实际连接。',
    'settings.provider.unconfiguredBadge': '未配置',
    'settings.provider.unconfigured': '未检测到服务会话或本地环境凭据。',
    'settings.provider.configErrorBadge': '配置错误',
    'settings.provider.configError': '服务提供方配置错误：{error}',
    'settings.provider.unsupportedBadge': '不可用',
    'settings.provider.unsupported': '当前服务器没有可用的图像服务提供方实现。',
    'settings.provider.nonGeminiBadge': 'Gemini 未启用',
    'settings.provider.nonGemini': 'Studio 外部当前配置了非 Gemini 服务提供方；保存本表单后，服务会话将切换为 Gemini。',
    'settings.provider.stateErrorBadge': '状态不可用',
    'settings.provider.stateError': '无法读取服务提供方配置状态：{error}',
    'settings.provider.serviceRequiredBadge': '需要本地服务',
    'settings.provider.serviceRequired': '直接文件预览无法使用服务提供方设置；请通过本地 MoteWeave 服务打开 Studio。',
    'settings.provider.actionErrorBadge': '更新失败',
    'settings.provider.actionError': '服务提供方配置未更改：{error}',
    'settings.provider.identityUnavailable': '服务提供方配置',
    'settings.provider.providerRequired': '保存前请先选择服务提供方。',
    'settings.provider.modelAndKeyRequired': '模型和 API Key 均为必填项。',
    'settings.provider.saved': '服务提供方配置已保存',
    'settings.provider.cleared': '服务会话配置已清除',
    'settings.provider.boundaryTitle': '会话边界',
    'settings.provider.boundaryProcess': '仅保留在当前本地 Node 服务进程',
    'settings.provider.boundaryRestart': '服务重启或“清除会话配置”后失效',
    'settings.provider.boundaryUnverified': '状态“已配置”不等于连接已经验证',
    'settings.provider.boundarySources': '配置来源可为本次服务会话、本地环境或未配置',
    'settings.provider.supportedLabel': 'Studio 配置目标',
    'settings.provider.explanationLabel': '说明',
    'settings.provider.explanation': '模型与 API Key 必填；仅用于当前服务会话。',
    'settings.advancedProvider.title': '切换到高级 Provider',
    'settings.advancedProvider.summary': 'OpenRouter 与兼容 Base URL · 仅服务会话',
    'settings.advancedProvider.collapsedBadge': '高级配置',
    'settings.advancedProvider.description': '仅供高级兼容 Character 与 Scene 在线生成；保存会替换当前会话路由。',
    'settings.advancedProvider.provider': 'Provider',
    'settings.advancedProvider.baseUrl': 'Base URL（兼容模式必填）',
    'settings.advancedProvider.keyNote': '保存后清空输入、不回显，也不写入浏览器存储。',
    'settings.advancedProvider.save': '保存并激活',
    'settings.advancedProvider.readyToConfigure': '可配置 OpenRouter 或兼容 Base URL。',
    'settings.advancedProvider.notActive': '未激活',
    'settings.advancedProvider.active': '当前会话已激活',
    'settings.advancedProvider.environmentActive': '本地环境已激活',
    'settings.advancedProvider.saving': '正在保存兼容 Provider…',
    'settings.advancedProvider.saveFailed': '兼容 Provider 保存失败：{error}',
    'settings.advancedProvider.statusRetained': '状态保持原配置；没有 Provider 调用、Job、自动重试或回退。',
    'settings.advancedProvider.baseUrlRequired': '兼容模式必须填写 Base URL。',
    'settings.advancedProvider.routeRequired': '请重新选择 Provider 路线',
    'settings.advancedProvider.routeUndisclosed': '已激活 · 路线未披露',
    'settings.advancedProvider.routeUndisclosedDetail': '现有接口不会回传当前会话使用 OpenRouter 还是兼容 Base URL；再次保存前必须重新选择路线并输入 Key。',
    'settings.advancedProvider.noCallsOnSave': '保存配置不会启动 Job，也不会发起 Provider 调用',
    'settings.advancedProvider.matrixTitle': '兼容矩阵',
    'settings.advancedProvider.compatCharacter': '高级兼容 Character',
    'settings.advancedProvider.sceneOnline': 'Scene 在线生成',
    'settings.advancedProvider.shared': '共享 Provider',
    'settings.advancedProvider.nativeGemini': '原生 Gemini',
    'settings.tools.title': '本地工具',
    'settings.tools.description': '只读检测本地媒体与去背景流程所需工具。',
    'settings.tools.ffmpeg': 'FFmpeg',
    'settings.tools.rembg': 'rembg',
    'settings.tools.refresh': '重新检测',
    'settings.tools.noPolling': '页面打开时检测一次，之后仅在你主动刷新时再次检测。',
    'settings.tools.checking': '检测中…',
    'settings.tools.ready': '可用',
    'settings.tools.unavailable': '不可用',
    'settings.tools.unknown': '未知',
    'settings.tools.loadingMessage': '正在检测本地工具可用状态…',
    'settings.tools.completeMessage': '本地工具检测完成。',
    'settings.tools.partialMessage': '检测完成；一个或多个本地工具不可用。',
    'settings.tools.errorMessage': '无法读取本地工具状态：{error}',
    'settings.tools.serviceRequired': '需要本地服务',
    'settings.tools.serviceRequiredMessage': '直接文件预览中，本地工具检测保持锁定。',
    'settings.tools.ffmpegDescription': '视频与动效源处理',
    'settings.tools.rembgDescription': '可选本地背景移除',
    'settings.scope.workspaceTitle': '保留在对应工作区',
    'settings.scope.characterScale': '角色导出倍率 1x–4x',
    'settings.scope.exports': 'Godot / RPG Maker / OCAD 导出',
    'settings.scope.editor': '编辑器网格 / 吸附 / 视口',
    'settings.scope.motion': '动作、清理与单次任务参数',
    'settings.scope.notProvidedTitle': '当前不提供',
    'settings.scope.notProvidedOne': '主题切换 · 快捷键编辑 · 默认导出引擎',
    'settings.scope.notProvidedTwo': '输出路径选择 · 云同步 · 永久保存 API Key',
    'settings.scope.notProvidedReason': '这些能力尚未实现，因此不会显示为可用控件。',
    'character.headerTitle': '角色工作室',
    'character.headerCrumb': '· 严格审阅',
    'character.localEntry': '本地导入',
    'character.aiEntry': 'AI 生成',
    'character.export': '导出资源包',
    'character.exportLocked': '接受后可导出',
    'character.exportRunning': '生成中 · 暂不可导出',
    'character.exportReviewRequired': '等待人工接受',
    'character.exportBlocked': '导出已阻断',
    'character.flowEyebrow': '当前流程',
    'character.flowReview': '审阅',
    'character.reviewTitle': '新建一次调用计划',
    'character.reviewSummary': '先在本地生成零调用审阅包，再由你明确确认唯一一次在线调用。',
    'character.profileSelectorLabel': '生成布局',
    'character.fixedProfileTab': '固定区域（Fixed-region）',
    'character.topdownProfileTab': '俯视布局不可用 · 缺少权威 Structure',
    'character.descriptionLabel': '角色描述',
    'character.descriptionPlaceholder': '例如：一名铜发游侠，绿色外套，清晰像素轮廓',
    'character.descriptionHelp': '这段文字会写入封存提示词；审阅包封存后不能更改。',
    'character.contractTitle': '严格配置（Profile）',
    'character.profileLabel': '配置档（Profile）',
    'character.layoutLabel': '布局',
    'character.imageLabel': '图像',
    'character.budgetLabel': '调用预算',
    'character.matteLabel': '去背景',
    'character.overridesLabel': '手动覆盖',
    'character.overridesValue': '无 · 锚点 (0, 0)',
    'character.frameLocksLabel': '帧调整',
    'character.frameLocksValue': '空 · 锁定动画为空',
    'character.normalizationLabel': '规范化',
    'character.normalizationValue': '自动校正：开 · 稳定处理：开',
    'character.sealedTitle': '封存绑定',
    'character.reviewIdLabel': '审阅 ID',
    'character.planHashLabel': '计划 Hash',
    'character.referenceHashLabel': '参考清单 Hash',
    'character.providerLabel': '服务提供方',
    'character.modelLabel': '模型',
    'character.sealedArtifactsLabel': '封存的审阅证据',
    'character.reviewLinkReview': '审阅记录',
    'character.reviewLinkRequest': '请求清单',
    'character.reviewLinkReferences': '参考清单',
    'character.reviewLinkPrompt': '提示词',
    'character.reviewEvidenceTitle': '人工审阅',
    'character.strictFixedRegionLabel': '严格固定区域',
    'character.oneCallSealedJob': '一次调用任务 · 已封存',
    'character.sealedSubmissionUnknown': '封存提交 · 任务回执未知',
    'character.pendingRestoreExistingArtifacts': '仅使用现有封存任务 / 审阅证据',
    'character.runningAuthorityTitle': '任务阶段只依据服务端回执',
    'character.runningProviderComplete': '服务提供方响应已结束 · Raw 已在后处理前持久化',
    'character.runningProviderPending': '等待服务提供方响应与 Raw 持久化',
    'character.runningStopped': '严格任务在 Raw 持久化前停止',
    'character.runningSubmissionUnknown': '提交结果未知；服务端未返回任务回执',
    'character.runningPendingRestoreLoading': '正在读取封存的任务 / 审阅证据',
    'character.runningPendingRestoreInterrupted': '证据读取中断；可以只重读同一选择器',
    'character.runningPendingRestoreFailed': '封存证据未通过结构或绑定校验',
    'character.networkFinished': '· 网络阶段已结束',
    'character.networkStatePending': '· 等待网络阶段回执',
    'character.networkStateStopped': '· 网络阶段已停止',
    'character.networkStateUnknown': '· 网络结果未知',
    'character.networkPendingRestoreReadOnly': '· 只读证据 GET · 不会 POST 服务提供方',
    'character.providerCallsLabel': '服务提供方调用',
    'character.rawProvenanceLabel': 'Raw 来源证据',
    'character.currentPhaseLabel': '当前阶段',
    'character.rawSealedPhase': 'Raw 已封存',
    'character.publicationLabel': '已接受下载记录',
    'character.bindingLabel': '绑定',
    'character.sealedValue': '已封存',
    'character.sourceJobLabel': '源任务',
    'character.releaseEvidenceLabel': '下载验证证据',
    'character.gateLabel': '门',
    'character.acceptedSealedValue': 'accepted · 已封存',
    'character.outputLabel': '输出',
    'character.packLabel': '资源包',
    'character.enginesLabel': '引擎',
    'character.topdownProfileLabel': '俯视布局配置档',
    'character.strictProfileLabel': '严格配置档',
    'character.structureLabel': '结构（Structure）',
    'character.missingRequiredValue': '缺失 · 必填',
    'character.blockedPreCallValue': '0 · 调用前阻断',
    'character.statusLabel': '状态',
    'character.comingLaterValue': '稍后提供',
    'character.manualGateLabel': '人工门',
    'character.explicitHumanAcceptValue': '显式人工接受',
    'character.nextLabel': '下一步',
    'character.sealPublicationValue': '封存已接受的验证下载',
    'character.issueCountLabel': '已确认问题数',
    'character.evidencePending': '等待真实证据完整性校验。',
    'character.reviewAction': '生成审阅包（0 次调用）',
    'character.resetAction': '返回审阅设置（不会自动调用）',
    'character.stageLabel': '预览舞台',
    'character.reviewKicker': '等待生成审阅包',
    'character.reviewStageTitle': '计划与参考清单 Hash 尚未封存',
    'character.reviewStageSummary': '审阅阶段不调用服务提供方，也不会出现 Raw 原图或生成结果。',
    'character.placeholderLabel': '等待真实结果',
    'character.placeholderText': '等待真实证据',
    'character.rawEvidence': 'Raw · SHA 已绑定',
    'character.rawAlt': '服务提供方原始 Raw 输出',
    'character.backgroundEvidence': '原尺寸去背景结果',
    'character.backgroundAlt': '原尺寸服务提供方去背景结果',
    'character.normalizedEvidence': '规范化结果 · 派生证据',
    'character.normalizedAlt': '规范化生产图；它是派生证据，不是 Raw 原图',
    'character.normalizedFileNote': 'normalized_sheet.png · 不是 Raw 原图',
    'character.previewEvidence': '六底预览',
    'character.previewAlt': '六种背景底色预览',
    'character.previewEvidenceHelp': '白点与边缘检查',
    'character.spillEvidence': '溢色诊断叠加图',
    'character.spillAlt': '溢色与 Mask 诊断叠加图',
    'character.sureBackgroundAlt': '确定背景分类 Mask',
    'character.unknownAlt': '未知带分类 Mask',
    'character.sureForegroundAlt': '确定前景分类 Mask',
    'character.alphaAlt': 'Background Matte V2 Alpha 估计图',
    'character.reconstructionAlt': 'Background Matte V2 前景重建图',
    'character.sureBackgroundEvidence': '确定背景（Sure Background）',
    'character.unknownEvidence': '未知带（Unknown Band）',
    'character.sureForegroundEvidence': '确定前景（Sure Foreground）',
    'character.alphaEvidence': 'Alpha 估计',
    'character.reconstructionEvidence': '前景重建',
    'character.verifiedArtifactsLabel': '已核验的证据文件与 SHA-256',
    'character.blockingTitle': '阻断条件',
    'character.blockProfile': '配置档（Profile）· 已锁定',
    'character.blockStructure': '结构（Structure）· 缺失',
    'character.blockPrompt': '提示词（Prompt）· 已阻断',
    'character.blockModel': '模型 · 已锁定',
    'character.blockBudget': '预算 · 0 次',
    'character.blockHashes': 'Hash · 未封存',
    'character.blockReview': '审阅 · 不可用',
    'character.releasePack': '已验证角色下载',
    'character.releaseEngine': '引擎包',
    'character.pipelineLabel': '处理流程',
    'character.pipelineRaw': 'Raw 原图',
    'character.pipelineMatte': '去背景',
    'character.pipelineCount': '主体计数',
    'character.pipelineEvidence': '证据',
    'character.pipelineQuality': '质量',
    'character.pipelinePreview': '预览',
    'character.pipelineAccept': '人工接受',
    'character.pipelineReview': '审阅',
    'character.pipelineOutput': '输出',
    'character.pipelineSixBase': '六底',
    'character.pipelineSpill': '溢色',
    'character.pipelineSureBackground': '确定背景',
    'character.pipelineUnknown': '未知带',
    'character.pipelineSureForeground': '确定前景',
    'character.pipelineIdle': '待机',
    'character.pipelineWalkDown': '向下行走',
    'character.pipelineWalkUp': '向上行走',
    'character.pipelineWalkLeft': '向左行走',
    'character.pipelineWalkRight': '向右行走',
    'character.pipelineAttack': '攻击',
    'character.pipelineHurt': '受击',
    'character.pipelineProfile': '配置档',
    'character.pipelineStructure': '结构',
    'character.pipelinePrompt': '提示词',
    'character.pipelineModel': '模型',
    'character.pipelineBudget': '预算',
    'character.pipelineHashes': 'Hash',
    'character.pipelineWait': '等待',
    'character.pipelineCurrent': '当前',
    'character.pipelineLocked': '已锁定',
    'character.noProviderYet': '服务提供方尚未调用',
    'character.rawPersisted': 'Raw 已在本地后处理前持久化',
    'character.jobCallsUnknown': '服务提供方调用次数未知 · 只观察当前任务',
    'character.jobCallsKnown': '{status} · 服务提供方调用 {used}/1 · 无重试',
    'character.reviewArtifactCount': '{count}/11 件 Matte V2 证据已核验 · 等待人工审阅',
    'character.acceptedPipelineDetail': '结果已接受并验证 · 下载已解锁',
    'character.topdownPipelineDetail': '审阅前已阻断 · 服务提供方调用 0 次',
    'character.descriptionRequired': '生成审阅包前请先填写角色描述。',
    'character.issueCountInvalid': '已确认问题数必须是大于或等于 0 的整数。',
    'character.unknownError': '未知错误',
    'character.failureDetail': '失败详情：{error}',
    'character.matteNotActivated': '尚未激活',
    'character.maskSummary': '{count}/11 · 确定背景 / 未知带 / 确定前景',
    'character.discardReviewAction': '放弃本次封存并返回编辑（0 次调用）',
    'character.statusReviewPending': 'review_pending · 0 次调用',
    'character.statusRestoringPublication': '正在恢复已接受下载 · 服务提供方调用 0',
    'character.statusPendingRestoreLoading': 'restoring_pending_evidence · 只读 GET',
    'character.statusPendingRestoreInterrupted': 'pending_evidence_read_interrupted · 服务提供方调用 0',
    'character.statusPendingRestoreFailed': 'pending_evidence_rejected · 失败即关闭',
    'character.statusBlockedPreReview': 'blocked_pre_review · 0 次调用',
    'character.statusReady': '已就绪 · 0/1',
    'character.statusReviewRequired': 'review_required · 1/1',
    'character.statusReviewRequiredZero': 'review_required · 服务提供方调用 0',
    'character.statusAccepted': 'accepted · 已接受',
    'character.statusCallsKnown': '{status} · {used}/1',
    'character.statusCallsUnknown': '{status} · 调用次数未知',
    'character.phaseReview': '审阅',
    'character.phaseConfirm': '确认',
    'character.phaseReviewRequired': '等待人工审阅',
    'character.phaseAccepted': '已接受',
    'character.phaseTopdown': '俯视布局',
    'character.phasePendingRestoreLoading': '恢复待审证据',
    'character.phasePendingRestoreInterrupted': '恢复读取中断',
    'character.phasePendingRestoreFailed': '恢复证据已拒绝',
    'character.jobStatusQueued': 'queued（排队中）',
    'character.jobStatusGenerating': 'generating（生成中）',
    'character.jobStatusPostProcessing': 'post_processing（本地后处理）',
    'character.jobStatusDone': 'done（完成）',
    'character.jobStatusFailedQuality': 'failed_quality_gate（质量门失败）',
    'character.jobStatusFailedSafety': 'failed_safety_filter（安全过滤失败）',
    'character.jobStatusFailedModel': 'failed_model_error（模型失败）',
    'character.jobStatusFailedPost': 'failed_post_processing（后处理失败）',
    'character.jobStatusNotFound': 'not_found（任务不存在）',
    'character.jobStatusRequestFailed': 'request_failed（请求失败）',
    'character.jobStatusEvidenceError': 'evidence_error（证据错误）',
    'character.jobStatusPollInterrupted': 'poll_interrupted（观察中断）',
    'character.jobStatusSubmissionUnknown': 'submission_unknown（提交结果未知）',
    'character.reviewBuilding': '正在生成零调用审阅包…',
    'character.reviewReady': '审阅包已封存。确认唯一一次调用前请核对 Hash。',
    'character.confirmTitle': '确认一次服务提供方调用',
    'character.confirmSummary': '配置档（Profile）、提示词、参考清单、模型、2K / 1:1 与一次调用预算均已锁定。',
    'character.confirmKicker': '审阅包已封存',
    'character.confirmStageTitle': '配置档 / 提示词 / 参考清单不可更改',
    'character.confirmStageSummary': '确认后 Gemini 最多调用一次；没有重试、服务提供方回退或模型回退。',
    'character.confirmAction': '确认并开始生成（最多 1 次调用）',
    'character.confirming': '正在提交封存绑定；此动作绝不会自动重试…',
    'character.runningTitle': '服务提供方调用已结束或生成仍在进行',
    'character.runningSummary': '当前任务是唯一权威；不会追加任何服务提供方调用。',
    'character.runningKicker': '一次调用任务进行中',
    'character.runningStageTitle': '等待真实任务证据',
    'character.runningStageSummary': 'Raw 图像只在完整的 review_required 证据门后展示。',
    'character.runningAction': '处理中 · 不会再次调用服务提供方',
    'character.reviewRequiredTitle': '证据已就绪，等待人工接受',
    'character.reviewRequiredSummary': '自动分析只提供证据，不会自动接受或拒绝。',
    'character.reviewRequiredKicker': '真实证据已加载',
    'character.reviewRequiredStageTitle': '检查 Raw 原图、六底预览、溢色叠加图与分类 Mask',
    'character.reviewRequiredStageSummary': '只有显式人工接受通过完整性校验后，导出才会解锁。',
    'character.acceptAction': '接受并解锁下载（人工）',
    'character.accepting': '正在用精确审阅证据生成已验证下载；服务提供方调用为 0…',
    'character.evidenceVerified': '证据 Hash 已核对，人工接受可用。',
    'character.evidenceInvalid': '证据完整性校验失败：{error}',
    'character.acceptFailed': '已审阅证据仍保留显示，但已验证下载未完成：{error}。重试只会发送同一个零调用接受请求。',
    'character.evidenceImageFailed': '已核验证据图无法显示，人工接受继续保持锁定。',
    'character.acceptedTitle': '已人工接受，可以导出',
    'character.acceptedSummary': '角色下载已通过完整性与下载门。',
    'character.acceptedKicker': '已接受 · 下载已验证',
    'character.acceptedStageTitle': 'character_pack.zip · 不可变',
    'character.acceptedStageSummary': '下方链接只来自成功的人工接受响应。',
    'character.acceptedImageAlt': '已接受的规范化角色图',
    'character.openAccepted': '打开已接受导出',
    'character.topdownTitle': '俯视布局配置档尚未激活',
    'character.topdownSummary': '缺少权威结构（Structure），因此审阅和服务提供方在任何调用前均被阻断。',
    'character.topdownKicker': '俯视布局已禁用',
    'character.topdownStageTitle': '无法封存权威审阅包',
    'character.topdownStageSummary': '不会替换成固定区域布局，也没有回退、服务提供方调用、人工接受或导出。',
    'character.topdownAction': '不可用 · 缺少权威结构',
    'character.failedTitle': '严格任务已安全停止',
    'character.failedSummary': '没有启动重试或回退；返回审阅配置前先检查准确失败原因。',
    'character.failedKicker': '失败即关闭（Fail-closed）',
    'character.failedStageTitle': '生成未到达人工审阅门',
    'character.failedStageSummary': '失败原因和调用预算均来自真实任务响应。',
    'character.submissionUnknownTitle': '生成提交结果未知',
    'character.submissionUnknownSummary': '服务端没有返回任务回执，因此不能推测服务提供方调用次数，也不能重交同一审阅包。',
    'character.submissionUnknownKicker': '提交结果未知',
    'character.submissionUnknownStageTitle': '当前没有权威任务',
    'character.submissionUnknownStageSummary': '不提供重试或回退；创建新审阅包前应先检查服务端记录。',
    'character.observationInterruptedTitle': '任务观察已中断',
    'character.observationInterruptedSummary': '现有任务仍是唯一权威；只恢复 GET 状态观察，不会再次提交生成。',
    'character.observationInterruptedKicker': '观察已中断',
    'character.observationInterruptedStageTitle': '只继续观察同一个任务',
    'character.observationInterruptedStageSummary': 'Studio 不会再次 POST 生成请求，也不会推测终态。',
    'character.pendingRestoreLoadingTitle': '正在恢复已完成任务以供人工审阅',
    'character.pendingRestoreLoadingSummary': '只读取封存的任务与审阅证据，不会发送服务提供方请求。',
    'character.pendingRestoreLoadingKicker': '只读恢复',
    'character.pendingRestoreLoadingStageTitle': '正在核验精确的任务 / 审阅绑定',
    'character.pendingRestoreLoadingStageSummary': '配置档、Hash、唯一一次 1/1 成功调用、已验证下载门与证据清单必须全部匹配。',
    'character.pendingRestoreLoadingAction': '正在恢复待审证据（服务提供方调用 0）',
    'character.pendingRestoreInterruptedTitle': '待审证据读取已中断',
    'character.pendingRestoreInterruptedSummary': '同一任务与审阅仍是唯一权威；只重试它们的只读证据 GET。',
    'character.pendingRestoreInterruptedKicker': '证据观察中断',
    'character.pendingRestoreInterruptedStageTitle': '只重试同一个任务 / 审阅选择器',
    'character.pendingRestoreInterruptedStageSummary': '此恢复路径不允许发送审阅或生成 POST。',
    'character.retryPendingRestore': '重新恢复当前证据（服务提供方调用 0）',
    'character.pendingRestoreFailedTitle': '待审证据已安全拒绝',
    'character.pendingRestoreFailedSummary': '封存证据与要求的结构或绑定不匹配；人工接受与导出继续锁定。',
    'character.pendingRestoreFailedKicker': '恢复失败即关闭',
    'character.pendingRestoreFailedStageTitle': '此选择器不是有效的待人工审阅候选',
    'character.pendingRestoreFailedStageSummary': '结构或绑定错误是终态；不提供生成、回退或重试。',
    'character.pendingRestoreFailedAction': '待审证据无效 · 未启动生成',
    'character.evidenceFailedTitle': '本地证据核验已安全停止',
    'character.evidenceFailedSummary': '未启动生成或服务提供方调用；现有证据或已接受下载完成核验前，人工接受与导出保持锁定。',
    'character.evidenceFailedKicker': '证据失败即关闭',
    'character.evidenceFailedStageTitle': '证据不完整或无法显示',
    'character.evidenceFailedStageSummary': '仅核验现有生成或已接受下载文件，服务提供方调用为 0。',
    'character.evidenceUnavailableAction': '现有已接受下载证据不可用 · 未启动生成',
    'character.requestFailed': '{error}',
    'character.callsNone': '0/1 · 无重试 / 无回退',
    'character.callsOne': '1/1 · 无重试 / 无回退',
    'character.callsUnknown': '未知 · 无重试 / 无回退',
    'character.geminiNotReady': '当前没有满足条件的原生 Gemini 会话。请先在设置中配置 Gemini，再生成审阅包。',
    'character.recheckEvidence': '重新核验当前任务证据（0 次调用）',
    'character.restoringPublicationAction': '正在恢复已接受下载（0 次调用）',
    'character.resumeObservation': '继续观察当前任务（0 次调用）',
    'character.acceptNotReady': '全部 11 件 Matte V2 证据和字节 Hash 核验前，人工接受保持锁定。',
  }),
})

const PROVIDER_CONTROL_IDS = Object.freeze([
  'studio-runtime-model',
  'studio-runtime-base-url',
  'studio-runtime-api-key',
  'studio-toggle-api-key',
  'studio-save-provider-config',
  'studio-clear-provider-config',
])

const ADVANCED_PROVIDER_CONTROL_IDS = Object.freeze([
  'studio-advanced-runtime-provider',
  'studio-advanced-runtime-model',
  'studio-advanced-runtime-base-url',
  'studio-advanced-runtime-api-key',
  'studio-advanced-toggle-api-key',
  'studio-save-advanced-provider',
  'studio-clear-advanced-provider',
])

const ADVANCED_PROVIDER_TYPES = new Set(['openrouter', 'openrouter_compatible'])

let initialized = false
let initializationPromise = null
let providerSnapshot = { kind: 'loading' }
let lastResolvedProvider = {}
let providerActionPending = null
let advancedProviderSnapshot = { kind: 'idle' }
let advancedProviderRouteSelection = null
let toolSnapshot = { kind: 'loading' }
let serviceConnectionAvailable = true

function byId(id) {
  return document.getElementById(id)
}

function studioLanguage(language = getCurrentLanguage()) {
  return language === 'en' ? 'en' : 'zh'
}

export function studioT(key, replacements = {}, language = getCurrentLanguage()) {
  const lang = studioLanguage(language)
  const template = STUDIO_TRANSLATIONS[lang][key] ?? STUDIO_TRANSLATIONS.en[key] ?? key
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(replacements[name] ?? ''))
}

function translationVariables(element) {
  const replacements = {}
  for (const attribute of element.attributes ?? []) {
    if (!attribute.name.startsWith('data-studio-i18n-var-')) continue
    replacements[attribute.name.slice('data-studio-i18n-var-'.length)] = attribute.value
  }
  return replacements
}

function translateAttribute(root, attribute, targetAttribute, language) {
  root.querySelectorAll(`[${attribute}]`).forEach((element) => {
    const key = element.getAttribute(attribute)
    if (key) element.setAttribute(targetAttribute, studioT(key, {}, language))
  })
}

export function translateStudioDocument(root = document, language = getCurrentLanguage()) {
  if (!root?.querySelectorAll) return
  const lang = studioLanguage(language)
  root.querySelectorAll('[data-studio-i18n]').forEach((element) => {
    element.textContent = studioT(element.dataset.studioI18n, translationVariables(element), lang)
  })
  translateAttribute(root, 'data-studio-i18n-placeholder', 'placeholder', lang)
  translateAttribute(root, 'data-studio-i18n-title', 'title', lang)
  translateAttribute(root, 'data-studio-i18n-aria-label', 'aria-label', lang)
  translateAttribute(root, 'data-studio-i18n-alt', 'alt', lang)
}

function setStatus(node, text, state) {
  if (!node) return
  node.textContent = text
  node.dataset.state = state
  node.setAttribute('aria-busy', String(state === 'loading'))
}

function providerIdentity(provider) {
  const identity = [provider?.provider, provider?.model]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' / ')
  return identity || studioT('settings.provider.identityUnavailable')
}

function providerRouteIdentity(provider, selectedAdvancedRoute = null) {
  if (advancedProviderRouteIsUndisclosed(provider, selectedAdvancedRoute)) {
    return studioT('settings.currentRoute.undisclosedRoute')
  }
  if (isAdvancedProviderRoute(selectedAdvancedRoute) && provider?.provider === 'openrouter') {
    return providerIdentity({ ...provider, provider: selectedAdvancedRoute })
  }
  return providerIdentity(provider)
}

function providerPresentation(snapshot = providerSnapshot) {
  if (snapshot.kind === 'service_required') {
    return {
      state: 'error',
      badge: studioT('settings.provider.serviceRequiredBadge'),
      detail: studioT('settings.provider.serviceRequired'),
    }
  }
  if (snapshot.kind === 'loading') {
    return {
      state: 'loading',
      badge: studioT('settings.provider.loadingBadge'),
      detail: studioT('settings.provider.loading'),
    }
  }
  if (snapshot.kind === 'saving') {
    return {
      state: 'loading',
      badge: studioT('settings.provider.savingBadge'),
      detail: studioT('settings.provider.saving'),
    }
  }
  if (snapshot.kind === 'clearing') {
    return {
      state: 'loading',
      badge: studioT('settings.provider.clearingBadge'),
      detail: studioT('settings.provider.clearing'),
    }
  }
  if (snapshot.kind === 'state_error') {
    return {
      state: 'error',
      badge: studioT('settings.provider.stateErrorBadge'),
      detail: studioT('settings.provider.stateError', { error: snapshot.error }),
    }
  }
  if (snapshot.kind === 'action_error') {
    return {
      state: 'error',
      badge: studioT('settings.provider.actionErrorBadge'),
      detail: studioT('settings.provider.actionError', { error: snapshot.error }),
    }
  }

  const provider = snapshot.provider ?? {}
  if (provider.status === 'configuration_error') {
    return {
      state: 'error',
      badge: studioT('settings.provider.configErrorBadge'),
      detail: studioT('settings.provider.configError', {
        error: provider.error || provider.status,
      }),
    }
  }
  if (provider.implemented === false) {
    return {
      state: 'error',
      badge: studioT('settings.provider.unsupportedBadge'),
      detail: studioT('settings.provider.unsupported'),
    }
  }
  if (provider.available === true && provider.provider !== 'gemini') {
    return {
      state: 'idle',
      badge: studioT('settings.provider.nonGeminiBadge'),
      detail: studioT('settings.provider.nonGemini'),
    }
  }
  if (provider.available === true && provider.runtime_configured === true) {
    return {
      state: 'ready',
      badge: studioT('settings.provider.browserBadge'),
      detail: studioT('settings.provider.browserConfigured', {
        identity: providerIdentity(provider),
      }),
    }
  }
  if (provider.available === true) {
    return {
      state: 'ready',
      badge: studioT('settings.provider.localBadge'),
      detail: studioT('settings.provider.localConfigured', {
        identity: providerIdentity(provider),
      }),
    }
  }
  return {
    state: 'idle',
    badge: studioT('settings.provider.unconfiguredBadge'),
    detail: studioT('settings.provider.unconfigured'),
  }
}

export function currentProviderRoutePresentation(
  snapshot = providerSnapshot,
  resolvedProvider = lastResolvedProvider,
  selectedAdvancedRoute = advancedProviderRouteSelection,
) {
  const status = providerPresentation(snapshot)
  const provider = snapshot?.provider ?? resolvedProvider ?? {}
  const unsettled = ['loading', 'saving', 'clearing'].includes(snapshot?.kind)
  const unavailable = ['service_required', 'state_error', 'action_error'].includes(snapshot?.kind)

  if (unsettled) {
    return Object.freeze({
      state: status.state,
      badge: status.badge,
      route: provider?.available
        ? providerRouteIdentity(provider, selectedAdvancedRoute)
        : studioT('settings.currentRoute.loading'),
      source: studioT('settings.currentRoute.loading'),
      impact: studioT('settings.currentRoute.unknownImpact'),
    })
  }
  if (unavailable || provider?.status === 'configuration_error' || provider?.implemented === false) {
    return Object.freeze({
      state: 'error',
      badge: status.badge,
      route: provider?.available
        ? providerRouteIdentity(provider, selectedAdvancedRoute)
        : studioT('settings.provider.identityUnavailable'),
      source: studioT('settings.currentRoute.unavailableSource'),
      impact: studioT('settings.currentRoute.unknownImpact'),
    })
  }
  if (provider?.available !== true) {
    return Object.freeze({
      state: 'idle',
      badge: studioT('settings.provider.unconfiguredBadge'),
      route: studioT('settings.currentRoute.noSource'),
      source: studioT('settings.currentRoute.noSource'),
      impact: studioT('settings.currentRoute.noneImpact'),
    })
  }

  const nativeGemini = provider.provider === 'gemini'
  return Object.freeze({
    state: 'ready',
    badge: provider.runtime_configured === true
      ? studioT('settings.provider.browserBadge')
      : studioT('settings.provider.localBadge'),
    route: providerRouteIdentity(provider, selectedAdvancedRoute),
    source: provider.runtime_configured === true
      ? studioT('settings.currentRoute.sessionSource')
      : studioT('settings.currentRoute.environmentSource'),
    impact: studioT(nativeGemini
      ? 'settings.currentRoute.nativeImpact'
      : 'settings.currentRoute.sharedImpact'),
  })
}

function renderCurrentProviderRoute() {
  const presentation = currentProviderRoutePresentation()
  setStatus(
    byId('studio-current-provider-badge'),
    presentation.badge,
    presentation.state,
  )
  const values = {
    'studio-current-provider-route': presentation.route,
    'studio-current-provider-source': presentation.source,
    'studio-current-provider-impact': presentation.impact,
  }
  for (const [id, value] of Object.entries(values)) {
    const node = byId(id)
    if (node) node.textContent = value
  }
}

function setProviderControlsLoading(loading) {
  for (const id of PROVIDER_CONTROL_IDS) {
    const control = byId(id)
    if (!control) continue
    control.disabled = loading
    control.dataset.pending = String(loading)
  }
  setAdvancedProviderControlsLoading(loading)
}

function restoreProviderControlAvailability() {
  setProviderControlsLoading(false)
  const clearButton = byId('studio-clear-provider-config')
  if (clearButton) {
    clearButton.disabled = !(
      lastResolvedProvider.runtime_configured === true && lastResolvedProvider.provider === 'gemini'
    )
  }
}

function syncProviderControls(provider = {}) {
  const providerSelect = byId('studio-runtime-provider')
  const modelInput = byId('studio-runtime-model')
  const apiKeyInput = byId('studio-runtime-api-key')
  const clearButton = byId('studio-clear-provider-config')
  const exactProvider = 'gemini'

  if (providerSelect && [...providerSelect.options].some((option) => option.value === exactProvider)) {
    providerSelect.value = exactProvider
    providerSelect.dispatchEvent(new Event('change'))
  }
  if (modelInput) {
    modelInput.value = provider.provider === 'gemini' && provider.model
      ? String(provider.model)
      : DEFAULT_RUNTIME_MODELS.gemini
  }
  if (apiKeyInput) apiKeyInput.value = ''
  if (clearButton) {
    clearButton.disabled = !(provider.runtime_configured === true && provider.provider === 'gemini')
  }
}

function setAdvancedProviderControlsLoading(loading) {
  for (const id of ADVANCED_PROVIDER_CONTROL_IDS) {
    const control = byId(id)
    if (!control) continue
    control.disabled = loading || !serviceConnectionAvailable
    control.dataset.pending = String(loading)
  }
  if (!loading) {
    const clearButton = byId('studio-clear-advanced-provider')
    if (clearButton) {
      clearButton.disabled = !(
        lastResolvedProvider.runtime_configured === true && ADVANCED_PROVIDER_TYPES.has(lastResolvedProvider.provider)
      )
    }
  }
}

function updateAdvancedProviderFields({ resetModel = false } = {}) {
  const provider = byId('studio-advanced-runtime-provider')?.value || 'openrouter'
  const model = byId('studio-advanced-runtime-model')
  const baseUrlField = byId('studio-advanced-runtime-base-url-field')
  if (baseUrlField) baseUrlField.hidden = provider !== 'openrouter_compatible'
  if (model) {
    model.placeholder = DEFAULT_RUNTIME_MODELS[provider] || DEFAULT_RUNTIME_MODELS.openrouter
    if (resetModel || !model.value.trim()) model.value = model.placeholder
  }
}

function syncAdvancedProviderControls(provider = {}) {
  const providerSelect = byId('studio-advanced-runtime-provider')
  const modelInput = byId('studio-advanced-runtime-model')
  const baseUrlInput = byId('studio-advanced-runtime-base-url')
  const keyInput = byId('studio-advanced-runtime-api-key')
  const advancedProvider = ADVANCED_PROVIDER_TYPES.has(provider.provider)
  const route = advancedProviderRouteForState(provider, advancedProviderRouteSelection)
  if (providerSelect) providerSelect.value = route
  if (!route && baseUrlInput) baseUrlInput.value = ''
  updateAdvancedProviderFields()
  if (modelInput && advancedProvider && provider.model) modelInput.value = String(provider.model)
  clearAdvancedProviderSecret(keyInput)
  setAdvancedProviderControlsLoading(false)
}

function advancedProviderPresentation() {
  if (!serviceConnectionAvailable) {
    return {
      state: 'error',
      badge: studioT('settings.provider.serviceRequiredBadge'),
      detail: studioT('settings.provider.serviceRequired'),
    }
  }
  if (advancedProviderSnapshot.kind === 'saving') {
    return {
      state: 'loading',
      badge: studioT('settings.provider.savingBadge'),
      detail: studioT('settings.advancedProvider.saving'),
    }
  }
  if (advancedProviderSnapshot.kind === 'error') {
    return {
      state: 'error',
      badge: studioT('settings.provider.actionErrorBadge'),
      detail: `${studioT('settings.advancedProvider.saveFailed', { error: advancedProviderSnapshot.error })} ${studioT('settings.advancedProvider.statusRetained')}`,
    }
  }
  if (providerSnapshot.kind === 'loading') {
    return {
      state: 'loading',
      badge: studioT('settings.provider.loadingBadge'),
      detail: studioT('settings.provider.loading'),
    }
  }
  if (providerSnapshot.kind === 'state_error') {
    return {
      state: 'error',
      badge: studioT('settings.provider.actionErrorBadge'),
      detail: studioT('settings.provider.stateError', { error: providerSnapshot.error }),
    }
  }
  const provider = lastResolvedProvider ?? {}
  if (advancedProviderRouteIsUndisclosed(provider, advancedProviderRouteSelection)) {
    return {
      state: 'error',
      badge: studioT('settings.advancedProvider.routeUndisclosed'),
      detail: studioT('settings.advancedProvider.routeUndisclosedDetail'),
    }
  }
  if (provider.available === true && ADVANCED_PROVIDER_TYPES.has(provider.provider)) {
    return {
      state: 'ready',
      badge: studioT(provider.runtime_configured === true
        ? 'settings.advancedProvider.active'
        : 'settings.advancedProvider.environmentActive'),
      detail: studioT(provider.runtime_configured === true
        ? 'settings.provider.browserConfigured'
        : 'settings.provider.localConfigured', { identity: providerIdentity(provider) }),
    }
  }
  return {
    state: 'idle',
    badge: studioT('settings.advancedProvider.notActive'),
    detail: studioT('settings.advancedProvider.readyToConfigure'),
  }
}

function renderAdvancedProviderState() {
  const presentation = advancedProviderPresentation()
  const details = byId('studio-advanced-provider')
  if (details) {
    details.dataset.state = presentation.state
    if (presentation.state === 'ready' || presentation.state === 'error') details.open = true
  }
  setStatus(byId('studio-advanced-provider-badge'), presentation.badge, presentation.state)
  setStatus(byId('studio-advanced-provider-state'), presentation.badge, presentation.state)
  setStatus(byId('studio-advanced-provider-message'), presentation.detail, presentation.state)
}

function renderProviderState() {
  const presentation = providerPresentation()
  setStatus(byId('studio-provider-state-badge'), presentation.badge, presentation.state)
  setStatus(byId('studio-provider-config-status'), presentation.detail, presentation.state)
  renderCurrentProviderRoute()
  renderAdvancedProviderState()
}

function applyProviderState(provider, { advancedRoute = null } = {}) {
  providerActionPending = null
  advancedProviderSnapshot = { kind: 'idle' }
  advancedProviderRouteSelection = isAdvancedProviderRoute(advancedRoute) ? advancedRoute : null
  lastResolvedProvider = provider
  providerSnapshot = { kind: 'resolved', provider }
  setProviderControlsLoading(false)
  syncProviderControls(provider)
  syncAdvancedProviderControls(provider)
  renderProviderState()
  queueMicrotask(() => {
    if (providerSnapshot.kind === 'resolved' && providerSnapshot.provider === provider) {
      restoreProviderControlAvailability()
    }
  })
}

function validProviderPayload() {
  const providerControl = byId('studio-runtime-provider')
  const modelControl = byId('studio-runtime-model')
  const apiKeyControl = byId('studio-runtime-api-key')
  const provider = providerControl?.value.trim() || ''
  const model = modelControl?.value.trim() || ''
  const apiKey = apiKeyControl?.value.trim() || ''
  if (!provider) {
    return { valid: false, message: studioT('settings.provider.providerRequired'), control: providerControl }
  }
  if (!model || !apiKey) {
    return {
      valid: false,
      message: studioT('settings.provider.modelAndKeyRequired'),
      control: !model ? modelControl : apiKeyControl,
    }
  }
  return { valid: true }
}

function prepareProviderActions() {
  const saveButton = byId('studio-save-provider-config')
  const clearButton = byId('studio-clear-provider-config')

  saveButton?.addEventListener('click', (event) => {
    event.preventDefault()
    const validation = validProviderPayload()
    if (!validation.valid) {
      event.stopImmediatePropagation()
      setStatus(byId('studio-provider-config-status'), validation.message, 'error')
      validation.control?.setAttribute('aria-invalid', 'true')
      validation.control?.focus()
      return
    }
    byId('studio-runtime-model')?.removeAttribute('aria-invalid')
    byId('studio-runtime-api-key')?.removeAttribute('aria-invalid')
    providerActionPending = 'save'
    providerSnapshot = { kind: 'saving' }
    setProviderControlsLoading(true)
    renderProviderState()
  })

  clearButton?.addEventListener('click', (event) => {
    event.preventDefault()
    providerActionPending = 'clear'
    providerSnapshot = { kind: 'clearing' }
    setProviderControlsLoading(true)
    renderProviderState()
  })
}

function advancedProviderPayload() {
  const providerControl = byId('studio-advanced-runtime-provider')
  const modelControl = byId('studio-advanced-runtime-model')
  const baseUrlControl = byId('studio-advanced-runtime-base-url')
  const keyControl = byId('studio-advanced-runtime-api-key')
  const provider = providerControl?.value.trim() || ''
  const model = modelControl?.value.trim() || ''
  const baseUrl = baseUrlControl?.value.trim() || ''
  const apiKey = keyControl?.value.trim() || ''
  if (!ADVANCED_PROVIDER_TYPES.has(provider)) {
    return { valid: false, message: studioT('settings.provider.providerRequired'), control: providerControl }
  }
  if (!model || !apiKey) {
    return {
      valid: false,
      message: studioT('settings.provider.modelAndKeyRequired'),
      control: !model ? modelControl : keyControl,
    }
  }
  if (provider === 'openrouter_compatible' && !baseUrl) {
    return { valid: false, message: studioT('settings.advancedProvider.baseUrlRequired'), control: baseUrlControl }
  }
  return { valid: true, payload: { provider, model, apiKey, baseUrl: provider === 'openrouter_compatible' ? baseUrl : '' } }
}

async function saveAdvancedProvider() {
  if (providerActionPending || !serviceConnectionAvailable) return
  const validation = advancedProviderPayload()
  if (!validation.valid) {
    clearAdvancedProviderSecret(byId('studio-advanced-runtime-api-key'))
    setStatus(byId('studio-advanced-provider-message'), validation.message, 'error')
    validation.control?.setAttribute('aria-invalid', 'true')
    validation.control?.focus()
    return
  }
  for (const id of ['studio-advanced-runtime-model', 'studio-advanced-runtime-base-url', 'studio-advanced-runtime-api-key']) {
    byId(id)?.removeAttribute('aria-invalid')
  }
  providerActionPending = 'advanced-save'
  advancedProviderSnapshot = { kind: 'saving' }
  setProviderControlsLoading(true)
  renderProviderState()
  try {
    const provider = await postProviderConfig(validation.payload)
    applyProviderState(provider, { advancedRoute: validation.payload.provider })
  } catch (error) {
    providerActionPending = null
    advancedProviderSnapshot = { kind: 'error', error: String(error?.message || error) }
    restoreProviderControlAvailability()
    setAdvancedProviderControlsLoading(false)
    renderProviderState()
  } finally {
    clearAdvancedProviderSecret(byId('studio-advanced-runtime-api-key'))
  }
}

async function clearAdvancedProvider() {
  if (providerActionPending || !serviceConnectionAvailable) return
  providerActionPending = 'advanced-clear'
  advancedProviderSnapshot = { kind: 'saving' }
  setProviderControlsLoading(true)
  renderProviderState()
  try {
    const provider = await postProviderConfig({ clear: true })
    applyProviderState(provider)
  } catch (error) {
    providerActionPending = null
    advancedProviderSnapshot = { kind: 'error', error: String(error?.message || error) }
    restoreProviderControlAvailability()
    setAdvancedProviderControlsLoading(false)
    renderProviderState()
  } finally {
    clearAdvancedProviderSecret(byId('studio-advanced-runtime-api-key'))
  }
}

function prepareAdvancedProviderActions() {
  byId('studio-advanced-runtime-provider')?.addEventListener('change', () => {
    updateAdvancedProviderFields({ resetModel: true })
  })
  for (const id of ['studio-advanced-runtime-model', 'studio-advanced-runtime-base-url', 'studio-advanced-runtime-api-key']) {
    byId(id)?.addEventListener('input', (event) => {
      if (event.currentTarget?.value.trim()) event.currentTarget.removeAttribute('aria-invalid')
    })
  }
  byId('studio-save-advanced-provider')?.addEventListener('click', (event) => {
    event.preventDefault()
    void saveAdvancedProvider()
  })
  byId('studio-clear-advanced-provider')?.addEventListener('click', (event) => {
    event.preventDefault()
    void clearAdvancedProvider()
  })
}

function observeProviderActionErrors() {
  const status = byId('studio-provider-config-status')
  if (!status || typeof MutationObserver === 'undefined') return
  const observer = new MutationObserver(() => {
    if (!providerActionPending) return
    const message = status.textContent.trim()
    const pendingMessages = new Set([
      'Saving provider...',
      'Clearing provider...',
      studioT('settings.provider.saving'),
      studioT('settings.provider.clearing'),
    ])
    if (!message || pendingMessages.has(message)) return
    providerActionPending = null
    providerSnapshot = { kind: 'action_error', error: message }
    restoreProviderControlAvailability()
    renderProviderState()
  })
  observer.observe(status, { childList: true, characterData: true, subtree: true })
}

function localizeApiKeyToggle() {
  const toggle = byId('studio-toggle-api-key')
  if (!toggle) return
  const visible = toggle.getAttribute('aria-pressed') === 'true'
  const key = visible ? 'settings.provider.hideKey' : 'settings.provider.showKey'
  const label = studioT(key)
  toggle.setAttribute('aria-label', label)
  toggle.title = label
}

function localizeAdvancedApiKeyToggle() {
  const toggle = byId('studio-advanced-toggle-api-key')
  const input = byId('studio-advanced-runtime-api-key')
  if (!toggle || !input) return
  const visible = input.type === 'text'
  toggle.setAttribute('aria-pressed', String(visible))
  const label = studioT(visible ? 'settings.provider.hideKey' : 'settings.provider.showKey')
  toggle.setAttribute('aria-label', label)
  toggle.title = label
}

async function refreshProviderState() {
  providerSnapshot = { kind: 'loading' }
  setProviderControlsLoading(true)
  renderProviderState()
  try {
    const provider = await fetchProviderState()
    if (!provider || typeof provider !== 'object' || typeof provider.status !== 'string') {
      throw new Error('invalid provider state response')
    }
    applyProviderState(provider)
  } catch (error) {
    providerSnapshot = { kind: 'state_error', error: String(error?.message || error) }
    advancedProviderRouteSelection = null
    setProviderControlsLoading(false)
    syncProviderControls({})
    syncAdvancedProviderControls({})
    const clearButton = byId('studio-clear-provider-config')
    if (clearButton) clearButton.disabled = true
    renderProviderState()
  }
}

function toolPresentation(tool) {
  if (toolSnapshot.kind === 'service_required') {
    return { state: 'error', text: studioT('settings.tools.serviceRequired') }
  }
  if (toolSnapshot.kind === 'loading') {
    return { state: 'loading', text: studioT('settings.tools.checking') }
  }
  if (toolSnapshot.kind === 'error' || !tool) {
    return { state: 'unknown', text: studioT('settings.tools.unknown') }
  }
  if (tool.available === true) {
    return { state: 'ready', text: studioT('settings.tools.ready') }
  }
  if (tool.available === false) {
    return { state: 'idle', text: studioT('settings.tools.unavailable') }
  }
  return { state: 'unknown', text: studioT('settings.tools.unknown') }
}

function renderToolNode(id, tool) {
  const node = byId(id)
  const presentation = toolPresentation(tool)
  setStatus(node, presentation.text, presentation.state)
  if (!node) return
  const detail = tool?.reason || tool?.summary || ''
  if (detail) {
    node.title = detail
    node.tabIndex = 0
    node.setAttribute('aria-label', `${presentation.text}: ${detail}`)
  } else {
    node.removeAttribute('title')
    node.removeAttribute('tabindex')
    node.removeAttribute('aria-label')
  }
}

function renderToolState() {
  const status = toolSnapshot.status ?? {}
  renderToolNode('studio-ffmpeg-status', status.ffmpeg)
  renderToolNode('studio-rembg-status', status.rembg)
  const message = byId('studio-tool-status-message')
  if (toolSnapshot.kind === 'loading') {
    setStatus(message, studioT('settings.tools.loadingMessage'), 'loading')
    return
  }
  if (toolSnapshot.kind === 'service_required') {
    setStatus(message, studioT('settings.tools.serviceRequiredMessage'), 'error')
    return
  }
  if (toolSnapshot.kind === 'error') {
    setStatus(
      message,
      studioT('settings.tools.errorMessage', { error: toolSnapshot.error }),
      'error',
    )
    return
  }
  const tools = [status.ffmpeg, status.rembg]
  const allAvailable = tools.every((tool) => tool?.available === true)
  setStatus(
    message,
    studioT(allAvailable ? 'settings.tools.completeMessage' : 'settings.tools.partialMessage'),
    allAvailable ? 'ready' : 'idle',
  )
}

async function refreshToolState() {
  if (!serviceConnectionAvailable) return
  const refreshButton = byId('studio-refresh-tools')
  toolSnapshot = { kind: 'loading' }
  if (refreshButton) refreshButton.disabled = true
  renderToolState()
  try {
    const status = await fetchMotionSourceToolStatus()
    if (!status || typeof status !== 'object') throw new Error('invalid local tool status response')
    toolSnapshot = { kind: 'resolved', status }
  } catch (error) {
    toolSnapshot = { kind: 'error', error: String(error?.message || error) }
  } finally {
    if (refreshButton) refreshButton.disabled = false
    renderToolState()
  }
}

function renderLocalizedState() {
  const language = studioLanguage(getCurrentLanguage())
  translateStudioDocument(document, language)
  document.querySelectorAll('[data-studio-language]').forEach((element) => {
    const current = element.dataset.studioLanguage === language
    element.classList.toggle('is-current', current)
    if (element.matches('button')) element.setAttribute('aria-pressed', String(current))
  })
  document.title = language === 'en' ? 'MoteWeave · Settings' : 'MoteWeave · 设置'
  renderProviderState()
  renderToolState()
  localizeApiKeyToggle()
  localizeAdvancedApiKeyToggle()
}

export function refreshStudioSettingsLanguage() {
  renderLocalizedState()
}

export function initStudioSettings({ serviceAvailable = true } = {}) {
  if (initialized) return initializationPromise ?? Promise.resolve()
  initialized = true
  serviceConnectionAvailable = Boolean(serviceAvailable)

  initI18n()
  if (serviceConnectionAvailable) {
    prepareProviderActions()
    prepareAdvancedProviderActions()
    for (const id of ['studio-runtime-model', 'studio-runtime-api-key']) {
      byId(id)?.addEventListener('input', (event) => {
        if (event.currentTarget?.value.trim()) event.currentTarget.removeAttribute('aria-invalid')
      })
    }
    initProviderConfigSurface({
      providerSelector: '#studio-runtime-provider',
      modelSelector: '#studio-runtime-model',
      baseUrlFieldSelector: '#studio-runtime-base-url-field',
      baseUrlSelector: '#studio-runtime-base-url',
      apiKeySelector: '#studio-runtime-api-key',
      toggleSelector: '#studio-toggle-api-key',
      saveSelector: '#studio-save-provider-config',
      clearSelector: '#studio-clear-provider-config',
      statusSelector: '#studio-provider-config-status',
      onProviderState: applyProviderState,
      get saveToastMessage() {
        return studioT('settings.provider.saved')
      },
      get clearToastMessage() {
        return studioT('settings.provider.cleared')
      },
    })
    observeProviderActionErrors()
    localizeApiKeyToggle()
    byId('studio-toggle-api-key')?.addEventListener('click', localizeApiKeyToggle)
    updateAdvancedProviderFields()
    localizeAdvancedApiKeyToggle()
    byId('studio-advanced-toggle-api-key')?.addEventListener('click', () => {
      const input = byId('studio-advanced-runtime-api-key')
      if (!input) return
      input.type = input.type === 'password' ? 'text' : 'password'
      localizeAdvancedApiKeyToggle()
    })
  } else {
    providerSnapshot = { kind: 'service_required' }
    toolSnapshot = { kind: 'service_required' }
    setProviderControlsLoading(true)
    setAdvancedProviderControlsLoading(true)
    const refreshButton = byId('studio-refresh-tools')
    if (refreshButton) refreshButton.disabled = true
  }

  const languageSelect = byId('language-select')
  if (languageSelect) {
    languageSelect.value = getCurrentLanguage()
    languageSelect.addEventListener('change', renderLocalizedState)
  }
  document.querySelectorAll('.settings-language[data-studio-language]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!languageSelect) return
      languageSelect.value = button.dataset.studioLanguage
      languageSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
  })

  byId('studio-refresh-tools')?.addEventListener('click', (event) => {
    event.preventDefault()
    void refreshToolState()
  })

  renderLocalizedState()
  if (!serviceConnectionAvailable) {
    initializationPromise = Promise.resolve([])
    return initializationPromise
  }
  initializationPromise = Promise.allSettled([
    refreshProviderState(),
    refreshToolState(),
  ])
  return initializationPromise
}
