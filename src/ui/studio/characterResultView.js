import { getAnimationNameForIntent, getMovementIntent, movePreviewActor } from '../../character-pack/playablePreview.js'
import { getCurrentLanguage } from '../i18n.js'
import { requestStudioCharacterJson } from './characterLocalApi.js'
import { studioT } from './settingsView.js'

const EXPORT_LINKS = Object.freeze([
  ['character-local-export-pack', 'zip_url'],
  ['character-local-export-godot', 'godot_npc_zip_url'],
  ['character-local-export-rpgmaker', 'rpgmaker_zip_url'],
  ['character-local-export-ocad', 'ocad_zip_url'],
])

const MOVEMENT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'])
const CLIP_THUMB_SIZE = 48
const CLIP_THUMB_FILL = 0.8
const SHEET_ZOOM_CONTROLS = Object.freeze([
  ['character-sheet-zoom-fit-button', 'fit', 0],
  ['character-sheet-zoom-actual-button', 'actual', 1],
  ['character-sheet-zoom-double-button', 'double', 2],
  ['character-sheet-zoom-quad-button', 'quad', 4],
])

const RESULT_COPY = Object.freeze({
  en: Object.freeze({
    qualityPass: 'PASS',
    qualityWarning: 'WARNING',
    qualityFail: 'FAIL',
    qualityIssues: 'Findings',
    qualityNone: 'No blocking errors. Verified download links are bound to this Job.',
    clipsWaiting: 'Clips appear only after animations.json verifies.',
    previewState: '{animation} · x {x} · y {y}',
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
    exportReady: 'Export',
    exportLocked: 'Process before export',
  }),
  zh: Object.freeze({
    qualityPass: '通过',
    qualityWarning: '警告',
    qualityFail: '失败',
    qualityIssues: '发现',
    qualityNone: '没有阻断错误。已核验下载链接绑定到当前任务。',
    clipsWaiting: 'animations.json 核验通过后才会出现动画片段。',
    previewState: '{animation} · x {x} · y {y}',
    issueImpact: '影响',
    issueSuggestion: '建议',
    issueEmptyTitle: '必填帧为空',
    issueEmptyImpact: '对应动画不能作为已核验结果下载。',
    issueEmptySuggestion: '在指定单元格补上可见像素，然后重新处理源图。',
    issueCropTitle: '帧贴边或越出单元格',
    issueCropImpact: '动画可能被裁切，或渗到相邻单元格。',
    issueCropSuggestion: '把精灵向内收，留出透明边后再处理。',
    issueRegionTitle: '必填源区域为空',
    issueRegionImpact: '该运行时动作没有可用源图。',
    issueRegionSuggestion: '填满指定布局区域，然后重新处理源图。',
    issueGenericTitle: '维护中的质量门报告了问题',
    issueGenericImpact: '真实诊断未通过，已核验下载保持锁定。',
    issueGenericSuggestion: '打开质量报告并修正对应的源图条件。',
    exportReady: '导出',
    exportLocked: '处理完成后可导出',
  }),
})

let documentRef = null
let initialized = false
let boundOwner = null
let boundKey = null
let bindGeneration = 0
let lastPresentation = createEmptyCharacterResultPresentation()
let imageLoader = defaultLoadImageUrl
let preview = createPreviewState()
let sharedResultRouteActive = true
let sheetZoomMode = 'actual'

function defaultLoadImageUrl(url) {
  if (typeof globalThis.Image !== 'function') {
    return Promise.resolve({ src: url, width: 96, height: 96 })
  }
  return new Promise((resolve, reject) => {
    const image = new globalThis.Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      const error = new Error(`Could not display ${url}`)
      error.code = 'request_failed'
      reject(error)
    }
    image.src = url
  })
}

export function setCharacterResultImageLoader(loader) {
  imageLoader = typeof loader === 'function' ? loader : defaultLoadImageUrl
}

function beginResultGeneration() {
  bindGeneration += 1
  return bindGeneration
}

function isLiveResultBinding(generation, owner, key) {
  return bindGeneration === generation && boundOwner === owner && boundKey === key
}

function resolveDocument() {
  return documentRef ?? globalThis.document ?? null
}

export function setCharacterResultDocument(doc) {
  documentRef = doc ?? null
  boundOwner = null
  boundKey = null
  lastPresentation = createEmptyCharacterResultPresentation()
  preview = createPreviewState()
  sheetZoomMode = 'actual'
}

function byId(id) {
  return resolveDocument()?.getElementById?.(id) ?? null
}

function resultT(key, replacements = {}) {
  const language = getCurrentLanguage() === 'en' ? 'en' : 'zh'
  const template = RESULT_COPY[language][key] ?? RESULT_COPY.en[key] ?? key
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

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

export function createEmptyCharacterResultPresentation() {
  return Object.freeze({
    source: null,
    status: 'empty',
    playable: false,
    reviewStatic: false,
    acceptedStatic: false,
    sheetUrl: '',
    imageAltKey: 'character.acceptedImageAlt',
    animations: null,
    debugReport: null,
    reportUrl: '',
    exportUrls: null,
    exportUnlocked: false,
    bindKey: 'empty',
    hydrateError: null,
    missingQualityUrl: false,
  })
}

export function acceptedCharacterArtifactsReady(artifacts = null) {
  return Boolean(
    artifacts?.complete
    && artifacts.animations
    && artifacts.debugReport
    && !artifacts.error
    && !artifacts.missingQualityUrl,
  )
}

function characterResultExportable({ status, sheetUrl, animations, debugReport, exportUrls }) {
  return (
    status === 'playable'
    && Boolean(sheetUrl)
    && Boolean(animations)
    && Boolean(debugReport)
    && Boolean(exportUrls?.zip_url)
    && Boolean(exportUrls?.debug_report_url)
  )
}

export function createCharacterResultPresentation({
  source = null,
  status = 'empty',
  sheetUrl = '',
  animations = null,
  debugReport = null,
  reportUrl = '',
  exportUrls = null,
} = {}) {
  const url = String(sheetUrl ?? '')
  const playable = status === 'playable' && Boolean(url && animations && debugReport)
  const reviewStatic = status === 'review_static' && Boolean(url)
  const acceptedStatic = status === 'accepted_static' && Boolean(url)
  const qualityReport = playable || status === 'quality_only' ? debugReport : null
  const exportable = characterResultExportable({
    status,
    sheetUrl: url,
    animations,
    debugReport,
    exportUrls,
  })
  return Object.freeze({
    source,
    status,
    playable,
    reviewStatic,
    acceptedStatic,
    sheetUrl: playable || reviewStatic || acceptedStatic ? url : '',
    imageAltKey: reviewStatic
      ? 'character.reviewSheetAlt'
      : acceptedStatic && source === 'ai'
        ? 'character.acceptedSourceImageAlt'
        : 'character.acceptedImageAlt',
    animations: playable ? animations : null,
    debugReport: qualityReport,
    reportUrl: qualityReport ? String(reportUrl || exportUrls?.debug_report_url || '') : '',
    exportUrls: exportable ? exportUrls : status === 'quality_only' ? exportUrls : null,
    exportUnlocked: exportable,
    bindKey: `${source || 'none'}:${status}:${url}:${playable ? 'playable' : reviewStatic ? 'review' : acceptedStatic ? 'accepted-static' : 'empty'}`,
    hydrateError: null,
    missingQualityUrl: false,
  })
}

export function createLocalCompleteResultPresentation(result) {
  return createCharacterResultPresentation({
    source: 'local',
    status: 'playable',
    sheetUrl: result?.job?.normalized_sheet_url,
    animations: result?.animations,
    debugReport: result?.debugReport,
    reportUrl: result?.job?.debug_report_url,
    exportUrls: result?.job,
  })
}

export function createLocalQualityOnlyPresentation(report, reportUrl = '') {
  return createCharacterResultPresentation({
    source: 'local',
    status: 'quality_only',
    debugReport: report,
    reportUrl,
    exportUrls: reportUrl ? { debug_report_url: reportUrl } : null,
  })
}

export function createAiReviewResultPresentation(job) {
  return createCharacterResultPresentation({
    source: 'ai',
    status: 'review_static',
    sheetUrl: job?.raw_provider_output_url,
  })
}

export function createAiAcceptedSourceResultPresentation(sheetUrl) {
  return createCharacterResultPresentation({
    source: 'ai',
    status: 'accepted_static',
    sheetUrl,
  })
}

export function assertSharedCharacterDebugReport(report) {
  const validation = report?.validation
  if (
    !isRecord(report) ||
    !isRecord(validation) ||
    !['pass', 'warning', 'fail'].includes(validation.status) ||
    !Array.isArray(validation.warnings) ||
    !Array.isArray(validation.blocking_errors)
  ) {
    const error = new Error('Quality Report is malformed')
    error.code = 'invalid_quality_report'
    throw error
  }
  return report
}

function animationDimensionError(message) {
  const error = new Error(message)
  error.code = 'invalid_animations'
  return error
}

export function sharedCharacterSheetCellCount(animations) {
  const frameWidth = animations?.frame_size?.w
  const frameHeight = animations?.frame_size?.h
  const sheetWidth = animations?.sheet_size?.w
  const sheetHeight = animations?.sheet_size?.h
  if (
    !Number.isSafeInteger(frameWidth) || frameWidth <= 0 ||
    !Number.isSafeInteger(frameHeight) || frameHeight <= 0 ||
    !Number.isSafeInteger(sheetWidth) || sheetWidth <= 0 ||
    !Number.isSafeInteger(sheetHeight) || sheetHeight <= 0 ||
    sheetWidth % frameWidth !== 0 ||
    sheetHeight % frameHeight !== 0
  ) return null
  return (sheetWidth / frameWidth) * (sheetHeight / frameHeight)
}

export function intrinsicCharacterSheetSize(image) {
  const width = Number(image?.naturalWidth > 0 ? image.naturalWidth : image?.width)
  const height = Number(image?.naturalHeight > 0 ? image.naturalHeight : image?.height)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

export function assertSharedCharacterSheetMatchesImage(animations, image) {
  const size = intrinsicCharacterSheetSize(image)
  if (!size) {
    const error = new Error('Accepted sheet image dimensions are missing')
    error.code = 'sheet_image_size_missing'
    throw error
  }
  if (size.width !== animations.sheet_size.w || size.height !== animations.sheet_size.h) {
    const error = new Error('Accepted sheet image size does not match animations.sheet_size')
    error.code = 'sheet_image_size_mismatch'
    throw error
  }
  return size
}

export function assertSharedCharacterAnimations(animations) {
  if (
    !isRecord(animations) ||
    !isRecord(animations.frame_size) ||
    !isRecord(animations.sheet_size) ||
    !isRecord(animations.animations) ||
    Object.keys(animations.animations).length === 0
  ) {
    throw animationDimensionError('Animations manifest is malformed')
  }
  for (const dimension of [
    animations.frame_size.w,
    animations.frame_size.h,
    animations.sheet_size.w,
    animations.sheet_size.h,
  ]) {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw animationDimensionError('Animations dimensions are invalid')
    }
  }
  const cellCount = sharedCharacterSheetCellCount(animations)
  if (cellCount == null) {
    throw animationDimensionError('Sheet size must be divisible by frame size')
  }
  for (const animation of Object.values(animations.animations)) {
    if (
      !isRecord(animation) ||
      !Array.isArray(animation.frames) ||
      animation.frames.length === 0 ||
      animation.frames.some((frame) => !Number.isSafeInteger(frame) || frame < 0 || frame >= cellCount)
    ) {
      throw animationDimensionError('Animation frames are invalid')
    }
  }
  return animations
}

export async function loadAcceptedCharacterResultArtifacts(acceptance, {
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const animationsUrl = String(acceptance?.animations_url ?? '')
  const hasReportField = Object.hasOwn(acceptance || {}, 'debug_report_url')
  const reportUrl = hasReportField ? String(acceptance.debug_report_url ?? '') : ''
  if (!animationsUrl) {
    return Object.freeze({
      complete: false,
      animations: null,
      debugReport: null,
      missingQualityUrl: !hasReportField || !reportUrl,
      error: Object.freeze({ code: 'missing_animations_url', message: 'Accepted response has no animations_url' }),
    })
  }
  if (!hasReportField || !reportUrl) {
    return Object.freeze({
      complete: false,
      animations: null,
      debugReport: null,
      missingQualityUrl: true,
      error: Object.freeze({ code: 'missing_debug_report_url', message: 'Accepted response has no debug_report_url' }),
    })
  }
  if (/\/api\/process-sheet(?:\?|$)/.test(animationsUrl) || /\/api\/process-sheet(?:\?|$)/.test(reportUrl)) {
    const error = new Error('Accepted artifacts must not be loaded through process-sheet')
    error.code = 'invalid_acceptance_artifact'
    throw error
  }
  const animations = assertSharedCharacterAnimations(
    await requestStudioCharacterJson(animationsUrl, { signal }, fetchImpl),
  )
  const debugReport = assertSharedCharacterDebugReport(
    await requestStudioCharacterJson(reportUrl, { signal }, fetchImpl),
  )
  return Object.freeze({
    complete: true,
    animations,
    debugReport,
    missingQualityUrl: false,
    error: null,
  })
}

function chooseAnimation(animations, preferred, fallback = null) {
  if (animations[preferred]) return preferred
  if (fallback && animations[fallback]) return fallback
  return Object.keys(animations)[0] ?? null
}

function sheetFrameSource(manifest, frameIndex) {
  const frameSize = manifest?.frame_size
  const sheetSize = manifest?.sheet_size
  if (!frameSize || !sheetSize) return null
  const columns = Math.max(1, Math.floor(sheetSize.w / frameSize.w))
  return {
    x: (Number(frameIndex) % columns) * frameSize.w,
    y: Math.floor(Number(frameIndex) / columns) * frameSize.h,
    w: frameSize.w,
    h: frameSize.h,
  }
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

function opaqueClipBounds(image, source) {
  const doc = resolveDocument()
  if (!doc?.createElement || !image) return null
  const scratch = doc.createElement('canvas')
  scratch.width = source.w
  scratch.height = source.h
  const scratchCtx = scratch.getContext?.('2d')
  if (!scratchCtx?.drawImage || !scratchCtx.getImageData) return null
  try {
    scratchCtx.drawImage(image, source.x, source.y, source.w, source.h, 0, 0, source.w, source.h)
    const pixels = scratchCtx.getImageData(0, 0, source.w, source.h).data
    let minX = source.w
    let minY = source.h
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < source.h; y += 1) {
      for (let x = 0; x < source.w; x += 1) {
        if (pixels[(y * source.w + x) * 4 + 3] <= 8) continue
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    if (maxX < minX || maxY < minY) return null
    return {
      x: source.x + minX,
      y: source.y + minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    }
  } catch {
    return null
  }
}

function drawClipThumbnail(canvas, image, manifest, animation) {
  const ctx = canvas?.getContext?.('2d')
  const frameIndex = animation?.frames?.[0]
  const source = Number.isFinite(Number(frameIndex)) ? sheetFrameSource(manifest, frameIndex) : null
  if (!ctx || !image || !source) return
  const content = opaqueClipBounds(image, source) ?? source
  canvas.width = CLIP_THUMB_SIZE
  canvas.height = CLIP_THUMB_SIZE
  ctx.imageSmoothingEnabled = false
  drawChecker(ctx)
  const maxEdge = CLIP_THUMB_SIZE * CLIP_THUMB_FILL
  const scale = Math.min(maxEdge / content.w, maxEdge / content.h)
  const dw = Math.max(1, Math.round(content.w * scale))
  const dh = Math.max(1, Math.round(content.h * scale))
  ctx.drawImage?.(
    image,
    content.x,
    content.y,
    content.w,
    content.h,
    Math.round((CLIP_THUMB_SIZE - dw) / 2),
    Math.round((CLIP_THUMB_SIZE - dh) / 2),
    dw,
    dh,
  )
}

function syncLocalPreviewCanvas(canvas) {
  const host = canvas?.parentElement
  if (!canvas || !host) return false
  const width = Math.max(1, Math.round(host.clientWidth || canvas.width || 960))
  const height = Math.max(1, Math.round(host.clientHeight || canvas.height || 500))
  if (canvas.width === width && canvas.height === height) return false
  canvas.width = width
  canvas.height = height
  return true
}

function centerPreviewActor(canvas) {
  preview.position = {
    x: Math.round((canvas?.width ?? 900) / 2),
    y: Math.round((canvas?.height ?? 470) * 0.68),
  }
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

function repairedFrameCount(report) {
  const normalization = report?.normalization ?? {}
  return [
    normalization.auto_correction?.applied_count,
    normalization.motion_stabilization?.applied_count,
    normalization.manual_adjustments?.applied_count,
  ].reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0)
}

function renderIssueList(report) {
  const list = byId('character-local-quality-issues')
  if (!list) return
  list.replaceChildren?.()
  if (typeof list.replaceChildren !== 'function') list.textContent = ''
  const messages = qualityMessages(report)
  const doc = resolveDocument()
  if (!messages.length) {
    if (!doc?.createElement) {
      list.textContent = resultT('qualityNone')
      return
    }
    const empty = doc.createElement('p')
    empty.className = 'character-local-issue-empty'
    empty.textContent = resultT('qualityNone')
    list.append?.(empty)
    return
  }
  for (const code of messages) {
    const [titleKey, impactKey, suggestionKey] = issueCopy(code)
    if (!doc?.createElement) {
      list.textContent = `${list.textContent}${code} `
      continue
    }
    const article = doc.createElement('article')
    const title = doc.createElement('strong')
    const diagnostic = doc.createElement('code')
    const impact = doc.createElement('p')
    const suggestion = doc.createElement('p')
    title.textContent = resultT(titleKey)
    diagnostic.textContent = code
    impact.textContent = `${resultT('issueImpact')} · ${resultT(impactKey)}`
    suggestion.textContent = `${resultT('issueSuggestion')} · ${resultT(suggestionKey)}`
    article.append?.(title, diagnostic, impact, suggestion)
    list.append?.(article)
  }
}

function renderQuality(presentation) {
  const report = presentation.debugReport
  const validation = report?.validation
  setHidden('character-local-quality', !validation)
  if (!validation) {
    setText('character-local-quality-frames', '—')
    setText('character-local-quality-repaired', '—')
    setText('character-local-quality-findings', '—')
    setText('character-local-quality-summary', '')
    const reportLink = byId('character-local-quality-link')
    if (reportLink) reportLink.removeAttribute?.('href')
    const list = byId('character-local-quality-issues')
    if (list) {
      list.replaceChildren?.()
      if (typeof list.replaceChildren !== 'function') list.textContent = ''
    }
    return
  }
  const status = ['pass', 'warning', 'fail'].includes(validation.status) ? validation.status : 'fail'
  const statusKey = status === 'pass' ? 'qualityPass' : status === 'warning' ? 'qualityWarning' : 'qualityFail'
  const badge = byId('character-local-quality-status')
  if (badge) {
    badge.textContent = resultT(statusKey)
    badge.dataset.state = status
  }
  const findingCount = qualityMessages(report).length
  setText('character-local-quality-frames', String(validation.frame_count ?? report.frames?.length ?? '—'))
  setText('character-local-quality-repaired', String(repairedFrameCount(report)))
  setText('character-local-quality-findings', String(findingCount))
  setText('character-local-quality-summary', `${resultT('qualityIssues')} ${findingCount}`)
  const reportLink = byId('character-local-quality-link')
  if (reportLink) {
    if (presentation.reportUrl) {
      reportLink.href = presentation.reportUrl
      reportLink.setAttribute?.('href', presentation.reportUrl)
    } else {
      reportLink.removeAttribute?.('href')
    }
  }
  renderIssueList(report)
}

function renderClipButtons(presentation) {
  const container = byId('character-local-clips')
  if (!container) return
  container.replaceChildren?.()
  if (typeof container.replaceChildren !== 'function') container.textContent = ''
  const animations = presentation.animations?.animations
  const doc = resolveDocument()
  if (!animations) {
    if (!doc?.createElement) {
      container.textContent = resultT('clipsWaiting')
      return
    }
    const waiting = doc.createElement('p')
    waiting.textContent = resultT('clipsWaiting')
    container.append?.(waiting)
    return
  }
  for (const [name, animation] of Object.entries(animations)) {
    if (animation?.ui_hidden) continue
    if (!doc?.createElement) {
      container.textContent = `${container.textContent || ''}${name} `
      continue
    }
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'character-local-clip'
    button.classList?.toggle?.('is-active', name === preview.animationName)
    button.setAttribute?.('aria-pressed', String(name === preview.animationName))
    const thumb = doc.createElement('canvas')
    thumb.className = 'character-local-clip-thumb'
    thumb.width = 48
    thumb.height = 48
    thumb.setAttribute?.('aria-hidden', 'true')
    drawClipThumbnail(thumb, preview.image, presentation.animations, animation)
    const title = doc.createElement('strong')
    const detail = doc.createElement('span')
    title.textContent = animation.display_label || animation.label || name
    detail.textContent = `${animation.frames.length}f · ${animation.fps ?? 8} FPS`
    button.append?.(thumb, title, detail)
    button.addEventListener?.('click', () => {
      preview.animationName = name
      const direction = name.split('_').at(-1)
      if (['down', 'up', 'left', 'right'].includes(direction)) preview.direction = direction
      preview.frameCursor = 0
      preview.lastFrameTime = 0
      renderClipButtons(presentation)
    })
    container.append?.(button)
  }
}

function renderExportLinks(presentation) {
  const release = presentation.exportUnlocked ? presentation.exportUrls : null
  for (const [id, field] of EXPORT_LINKS) {
    const link = byId(id)
    if (!link) continue
    const url = release?.[field]
    if (url) {
      link.href = url
      link.setAttribute?.('href', url)
      link.removeAttribute?.('aria-disabled')
      link.removeAttribute?.('tabindex')
    } else {
      if ('href' in link) link.href = ''
      link.removeAttribute?.('href')
      link.setAttribute?.('aria-disabled', 'true')
      if ('tabIndex' in link) link.tabIndex = -1
    }
  }
  const topExport = byId('character-export-link')
  if (!topExport) return
  if (presentation.exportUnlocked && release?.zip_url) {
    topExport.href = '#character-local-export-dialog'
    topExport.setAttribute?.('href', '#character-local-export-dialog')
    topExport.removeAttribute?.('aria-disabled')
    topExport.removeAttribute?.('tabindex')
    topExport.textContent = resultT('exportReady')
  } else {
    if ('href' in topExport) topExport.href = ''
    topExport.removeAttribute?.('href')
    topExport.setAttribute?.('aria-disabled', 'true')
    if ('tabIndex' in topExport) topExport.tabIndex = -1
    topExport.textContent = resultT('exportLocked')
  }
}

function bindSheetImage(presentation) {
  const image = byId('character-accepted-image')
  if (!image) return
  const showImage = presentation.reviewStatic || presentation.acceptedStatic
  image.hidden = !showImage
  image.alt = studioT(presentation.imageAltKey)
  image.dataset.studioI18nAlt = presentation.imageAltKey
  if (showImage && presentation.sheetUrl) {
    image.src = presentation.sheetUrl
    image.setAttribute?.('src', presentation.sheetUrl)
  } else {
    if ('src' in image) image.src = ''
    image.removeAttribute?.('src')
  }
}

function sheetDimensions(image = byId('character-accepted-image')) {
  const width = Number(image?.naturalWidth || image?.width || 0)
  const height = Number(image?.naturalHeight || image?.height || 0)
  return {
    width: Number.isFinite(width) && width > 0 ? width : 0,
    height: Number.isFinite(height) && height > 0 ? height : 0,
  }
}

function applySharedCharacterSheetZoom({ resetScroll = false } = {}) {
  const viewport = byId('character-sheet-viewport')
  const image = byId('character-accepted-image')
  const { width, height } = sheetDimensions(image)
  const selected = SHEET_ZOOM_CONTROLS.find(([, mode]) => mode === sheetZoomMode) ?? SHEET_ZOOM_CONTROLS[1]
  const scale = selected[2]
  if (viewport) {
    viewport.dataset.characterSheetZoom = sheetZoomMode
    viewport.setAttribute?.('data-character-sheet-zoom', sheetZoomMode)
  }
  if (image?.style) {
    if (scale > 0 && width > 0) {
      image.style.width = `${Math.round(width * scale)}px`
      image.style.maxWidth = 'none'
    } else {
      image.style.width = ''
      image.style.maxWidth = ''
    }
    image.style.height = 'auto'
  }
  setText('character-sheet-size', width && height ? `${width} × ${height} px` : '')
  for (const [id, mode] of SHEET_ZOOM_CONTROLS) {
    byId(id)?.setAttribute?.('aria-pressed', String(mode === sheetZoomMode))
  }
  if (resetScroll && viewport) {
    viewport.scrollLeft = 0
    viewport.scrollTop = 0
  }
  return sheetZoomMode
}

export function setSharedCharacterSheetZoom(mode, options = {}) {
  if (!SHEET_ZOOM_CONTROLS.some(([, value]) => value === mode)) return false
  sheetZoomMode = mode
  applySharedCharacterSheetZoom({ resetScroll: options.resetScroll !== false })
  return true
}

function syncStaticSheetInspector(presentation) {
  const showInspector = Boolean(presentation.reviewStatic || presentation.acceptedStatic)
  setHidden('character-sheet-inspector', !showInspector)
  setHidden('character-local-preview-state', !presentation.playable)
  const previewHost = byId('character-local-preview')
  if (previewHost) {
    const kind = showInspector ? 'static' : presentation.playable ? 'playable' : 'empty'
    previewHost.dataset.characterPreviewKind = kind
    previewHost.setAttribute?.('data-character-preview-kind', kind)
    previewHost.setAttribute?.(
      'aria-labelledby',
      showInspector ? 'character-sheet-inspector-title' : 'character-local-preview-state',
    )
  }
  const openOriginal = byId('character-sheet-open-original')
  if (openOriginal) {
    openOriginal.hidden = !showInspector || !presentation.sheetUrl
    if (showInspector && presentation.sheetUrl) {
      openOriginal.href = presentation.sheetUrl
      openOriginal.setAttribute?.('href', presentation.sheetUrl)
    } else {
      if ('href' in openOriginal) openOriginal.href = ''
      openOriginal.removeAttribute?.('href')
    }
  }
  if (showInspector) applySharedCharacterSheetZoom()
}

export function stopSharedCharacterPreview() {
  if (preview.raf != null) {
    const cancel = globalThis.cancelAnimationFrame
    if (typeof cancel === 'function') cancel(preview.raf)
    else clearTimeout(preview.raf)
  }
  preview.raf = null
  preview.keys.clear()
}

export function setSharedCharacterResultRouteActive(active) {
  sharedResultRouteActive = Boolean(active)
  if (!sharedResultRouteActive) {
    stopSharedCharacterPreview()
  } else if (lastPresentation.playable && preview.image && preview.animations) {
    startSharedCharacterPreview()
  }
  return sharedResultRouteActive
}

function drawPreviewFrame(timestamp = 0) {
  preview.raf = null
  if (!sharedResultRouteActive || !preview.image || !preview.animations) return
  const canvas = byId('character-local-canvas')
  if (syncLocalPreviewCanvas(canvas)) centerPreviewActor(canvas)
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
  const delay = 1000 / Math.max(1, Number(animation.fps) || 8)
  if (!preview.lastFrameTime || timestamp - preview.lastFrameTime >= delay) {
    preview.frameCursor = (preview.frameCursor + 1) % animation.frames.length
    preview.lastFrameTime = timestamp
  }
  const source = sheetFrameSource(preview.animations, animation.frames[preview.frameCursor])
  if (!source) return
  drawChecker(ctx)
  ctx.imageSmoothingEnabled = false
  ctx.strokeStyle = 'rgba(51, 215, 197, .28)'
  ctx.beginPath?.()
  ctx.moveTo?.(0, preview.position.y)
  ctx.lineTo?.(canvas.width, preview.position.y)
  ctx.stroke?.()
  const scale = Math.max(1, Math.min(3, Math.floor(canvas.height / Math.max(1, source.h * 2.1))))
  const anchor = preview.animations.anchor ?? { x: source.w / 2, y: source.h - 8 }
  const targetX = Math.round(preview.position.x - anchor.x * scale)
  const targetY = Math.round(preview.position.y - anchor.y * scale)
  ctx.drawImage?.(
    preview.image,
    source.x,
    source.y,
    source.w,
    source.h,
    targetX,
    targetY,
    source.w * scale,
    source.h * scale,
  )
  setText('character-local-preview-state', resultT('previewState', {
    animation: preview.animationName,
    x: Math.round(preview.position.x),
    y: Math.round(preview.position.y),
  }))
  if (typeof globalThis.requestAnimationFrame === 'function') {
    preview.raf = globalThis.requestAnimationFrame(drawPreviewFrame)
  }
}

export function startSharedCharacterPreview() {
  stopSharedCharacterPreview()
  if (!sharedResultRouteActive || !preview.image || !preview.animations) return
  if (typeof globalThis.requestAnimationFrame !== 'function') return
  preview.lastMoveTime = 0
  preview.raf = globalThis.requestAnimationFrame(drawPreviewFrame)
}

function resetPreviewRuntime() {
  stopSharedCharacterPreview()
  preview = createPreviewState()
  setText('character-local-preview-state', '')
}

export function closeSharedCharacterExportDialog() {
  const dialog = byId('character-local-export-dialog')
  if (!dialog) return
  if (typeof dialog.close === 'function' && dialog.open) dialog.close()
  else dialog.removeAttribute?.('open')
}

export function openSharedCharacterExportDialog() {
  if (!lastPresentation.exportUnlocked) return false
  const dialog = byId('character-local-export-dialog')
  if (!dialog) return false
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal()
  } else {
    dialog.setAttribute?.('open', '')
  }
  return true
}

export function clearSharedCharacterResult({ force = false, owner = null } = {}) {
  if (!force && owner && boundOwner && boundOwner !== owner) return lastPresentation
  beginResultGeneration()
  boundOwner = null
  boundKey = null
  lastPresentation = createEmptyCharacterResultPresentation()
  resetPreviewRuntime()
  closeSharedCharacterExportDialog()
  writeEmptySharedResult()
  return lastPresentation
}

function writeEmptySharedResult() {
  const previewHost = byId('character-local-preview')
  if (previewHost) previewHost.hidden = true
  const canvas = byId('character-local-canvas')
  if (canvas) canvas.hidden = false
  const image = byId('character-accepted-image')
  if (image) {
    image.hidden = true
    if ('src' in image) image.src = ''
    image.removeAttribute?.('src')
    image.alt = studioT('character.acceptedImageAlt')
    image.dataset.studioI18nAlt = 'character.acceptedImageAlt'
  }
  const empty = createEmptyCharacterResultPresentation()
  syncStaticSheetInspector(empty)
  renderQuality(empty)
  renderClipButtons(empty)
  renderExportLinks(empty)
  setText('character-result-error', '')
  setHidden('character-result-error', true)
  setHidden('character-accepted-retry', true)
}

function writeSharedResultPresentation(next, { imageError = null } = {}) {
  lastPresentation = next
  bindSheetImage(next)
  const previewHost = byId('character-local-preview')
  const canvas = byId('character-local-canvas')
  const showPreviewHost = next.playable || next.reviewStatic || next.acceptedStatic
  if (previewHost) previewHost.hidden = !showPreviewHost
  if (canvas) canvas.hidden = !next.playable
  syncStaticSheetInspector(next)
  if (next.playable && preview.image && preview.animations) startSharedCharacterPreview()
  else resetPreviewRuntime()
  renderQuality(next)
  renderClipButtons(next)
  renderExportLinks(next)
  const errorText = imageError
    ? studioT('character.resultImageFailed')
    : next.hydrateError
      ? studioT('character.acceptedHydrateFailed', { error: next.hydrateError.message || next.hydrateError.code })
      : ''
  setText('character-result-error', errorText)
  setHidden('character-result-error', !errorText)
  setHidden('character-accepted-retry', true)
}

export const ADVANCED_CONFIG_CONTROL_SELECTOR = 'input, select, textarea, button'

export function queryAdvancedConfigControls(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return []
  return [...root.querySelectorAll(ADVANCED_CONFIG_CONTROL_SELECTOR)]
}

function setHostInert(host, inert) {
  if (!host) return
  host.hidden = inert
  host.inert = inert
  if (inert) host.setAttribute?.('aria-hidden', 'true')
  else host.removeAttribute?.('aria-hidden')
}

export function applyCharacterSourceParameterIsolation() {
  const presentation = Object.freeze({
    visible: true,
    editable: true,
    showLocalAdvancedForm: true,
  })
  const config = byId('character-advanced-config')
  if (config) {
    config.hidden = false
    config.inert = false
    config.removeAttribute?.('aria-hidden')
  }
  const form = byId('character-local-advanced-form')
  setHostInert(form, false)
  return presentation
}

export function getSharedCharacterExportPresentation() {
  return lastPresentation
}

export function getSharedCharacterBindGeneration() {
  return bindGeneration
}

export function readSharedCharacterResultSnapshot() {
  const image = byId('character-accepted-image')
  const canvas = byId('character-local-canvas')
  const quality = byId('character-local-quality')
  const clips = byId('character-local-clips')
  const previewHost = byId('character-local-preview')
  const exportPack = byId('character-local-export-pack')
  const findings = byId('character-local-quality-findings')
  const inspector = byId('character-sheet-inspector')
  const viewport = byId('character-sheet-viewport')
  return {
    owner: boundOwner,
    bindKey: boundKey,
    previewHidden: Boolean(previewHost?.hidden),
    previewLabelledBy: previewHost?.getAttribute?.('aria-labelledby') || '',
    canvasHidden: Boolean(canvas?.hidden),
    imageHidden: Boolean(image?.hidden),
    imageSrc: image?.getAttribute?.('src') || image?.src || '',
    imageAlt: image?.alt || '',
    imageAltKey: image?.dataset?.studioI18nAlt || '',
    inspectorHidden: Boolean(inspector?.hidden),
    sheetZoom: viewport?.dataset?.characterSheetZoom || viewport?.getAttribute?.('data-character-sheet-zoom') || '',
    sheetSize: byId('character-sheet-size')?.textContent || '',
    imageStyleWidth: image?.style?.width || '',
    qualityHidden: Boolean(quality?.hidden),
    qualityFindings: findings?.textContent || '',
    previewStateHidden: Boolean(byId('character-local-preview-state')?.hidden),
    previewState: byId('character-local-preview-state')?.textContent || '',
    clipsText: clips?.textContent || '',
    clipCount: clips?.querySelectorAll?.('.character-local-clip')?.length
      ?? [...(clips?.children ?? [])].filter((node) => node.className === 'character-local-clip').length,
    exportPackHref: exportPack?.getAttribute?.('href') || exportPack?.href || '',
    playable: Boolean(preview.animations && preview.image),
    exportUnlocked: Boolean(lastPresentation.exportUnlocked),
    generation: bindGeneration,
    hydrateError: lastPresentation.hydrateError,
    missingQualityUrl: Boolean(lastPresentation.missingQualityUrl),
  }
}

export function getSharedCharacterResultOwner() {
  return boundOwner
}

export function refreshSharedCharacterResultPresentation() {
  if (!lastPresentation || lastPresentation.status === 'empty') return lastPresentation
  writeSharedResultPresentation(lastPresentation)
  return lastPresentation
}

function lockAiAcceptedPresentation(presentation, error) {
  return Object.freeze({
    ...presentation,
    status: presentation.sheetUrl ? 'accepted_static' : 'empty',
    playable: false,
    acceptedStatic: Boolean(presentation.sheetUrl),
    animations: null,
    debugReport: null,
    reportUrl: '',
    exportUrls: null,
    exportUnlocked: false,
    hydrateError: Object.freeze({
      code: error?.code || 'result_image_failed',
      message: error?.message || String(error || 'image failed'),
    }),
    bindKey: `${presentation.source || 'none'}:accepted-static:${presentation.sheetUrl}:locked`,
  })
}

export async function bindSharedCharacterResult(presentation, { image = null, owner = presentation?.source } = {}) {
  const next = presentation?.status ? presentation : createEmptyCharacterResultPresentation()
  const generation = beginResultGeneration()
  boundOwner = owner
  boundKey = next.bindKey
  if (next.status === 'empty') {
    lastPresentation = next
    if (!isLiveResultBinding(generation, owner, next.bindKey)) return next
    resetPreviewRuntime()
    writeEmptySharedResult()
    return next
  }
  let loadedImage = image
  if (next.playable && !loadedImage) {
    try {
      loadedImage = await imageLoader(next.sheetUrl)
    } catch (error) {
      if (!isLiveResultBinding(generation, owner, next.bindKey)) return next
      preview = createPreviewState()
      if (owner === 'ai') {
        const locked = lockAiAcceptedPresentation(next, error)
        writeSharedResultPresentation(locked, { imageError: error })
        return locked
      }
      writeSharedResultPresentation(next, { imageError: error })
      return next
    }
  }
  if (!isLiveResultBinding(generation, owner, next.bindKey)) return next
  if (next.playable) {
    try {
      assertSharedCharacterSheetMatchesImage(next.animations, loadedImage)
    } catch (error) {
      preview = createPreviewState()
      if (owner === 'ai') {
        const locked = lockAiAcceptedPresentation(next, error)
        writeSharedResultPresentation(locked, { imageError: error })
        return locked
      }
      const lockedLocal = Object.freeze({
        ...next,
        playable: false,
        animations: null,
        debugReport: next.debugReport,
        exportUrls: null,
        exportUnlocked: false,
        hydrateError: Object.freeze({ code: error.code, message: error.message }),
      })
      writeSharedResultPresentation(lockedLocal, { imageError: error })
      return lockedLocal
    }
    stopSharedCharacterPreview()
    preview = createPreviewState()
    preview.animations = next.animations
    preview.animationName = chooseAnimation(next.animations.animations, 'idle_down')
    preview.image = loadedImage
    syncLocalPreviewCanvas(byId('character-local-canvas'))
    centerPreviewActor(byId('character-local-canvas'))
  } else {
    resetPreviewRuntime()
  }
  if (!isLiveResultBinding(generation, owner, next.bindKey)) return next
  writeSharedResultPresentation(next)
  return next
}

function handleMovementKey(event, pressed) {
  if (!sharedResultRouteActive || !preview.animations || !MOVEMENT_KEYS.has(event.key)) return
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(event.target?.tagName)) return
  event.preventDefault?.()
  if (pressed) preview.keys.add(event.key)
  else preview.keys.delete(event.key)
}

export function initSharedCharacterResult() {
  if (initialized) return
  initialized = true
  for (const [id, mode] of SHEET_ZOOM_CONTROLS) {
    byId(id)?.addEventListener?.('click', () => setSharedCharacterSheetZoom(mode))
  }
  byId('character-accepted-image')?.addEventListener?.('load', () => applySharedCharacterSheetZoom())
  byId('character-export-link')?.addEventListener?.('click', (event) => {
    event.preventDefault?.()
    openSharedCharacterExportDialog()
  })
  byId('character-accepted-retry')?.addEventListener?.('click', () => {
    byId('character-accepted-retry')?.dispatchEvent?.(new Event('character-retry-accepted'))
  })
  byId('character-local-export-close')?.addEventListener?.('click', closeSharedCharacterExportDialog)
  byId('character-local-export-dialog')?.addEventListener?.('click', (event) => {
    if (event.target === event.currentTarget) closeSharedCharacterExportDialog()
  })
  globalThis.addEventListener?.('keydown', (event) => handleMovementKey(event, true))
  globalThis.addEventListener?.('keyup', (event) => handleMovementKey(event, false))
}
