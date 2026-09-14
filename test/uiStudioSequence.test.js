import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  applySequenceFrameEdit,
  createInitialSequenceState,
  deriveSequencePresentation,
  sequenceOutputsAreCurrent,
} from '../src/ui/studio/sequenceView.js'
import {
  createSequenceBinding,
  normalizeSequenceOptions,
  sequenceOptionsKey,
} from '../src/ui/sprite/core.js'
import { STUDIO_TRANSLATIONS } from '../src/ui/studio/settingsView.js'

const FIGMA_SEQUENCE_NODE_IDS = Object.freeze([
  '603:3340',
  '870:4748',
  '894:4567',
  '870:4995',
  '870:5433',
  '870:5870',
  '870:6309',
  '870:6745',
  '889:4560',
])

const SEQUENCE_PHASES = Object.freeze([
  'empty', 'ready', 'processing', 'building', 'complete', 'partial', 'stale', 'error', 'local_error',
])

const PRESENTATION_CONTRACT = Object.freeze({
  empty: {
    titleKey: 'sequence.phase.emptyTitle',
    summaryKey: 'sequence.phase.emptySummary',
    statusKey: 'sequence.status.empty',
    crumbKey: 'sequence.crumb.empty',
    primaryKey: 'sequence.primary.choose',
    primaryAction: 'select',
  },
  ready: {
    titleKey: 'sequence.phase.readyTitle',
    summaryKey: 'sequence.phase.readySummary',
    statusKey: 'sequence.status.ready',
    crumbKey: 'sequence.crumb.ready',
    primaryKey: 'sequence.primary.generate',
    primaryAction: 'generate',
  },
  processing: {
    titleKey: 'sequence.phase.processingTitle',
    summaryKey: 'sequence.phase.processingSummary',
    statusKey: 'sequence.status.processing',
    crumbKey: 'sequence.crumb.processing',
    primaryKey: 'sequence.primary.processing',
    primaryAction: 'busy',
  },
  building: {
    titleKey: 'sequence.phase.buildingTitle',
    summaryKey: 'sequence.phase.buildingSummary',
    statusKey: 'sequence.status.building',
    crumbKey: 'sequence.crumb.building',
    primaryKey: 'sequence.primary.building',
    primaryAction: 'busy',
  },
  complete: {
    titleKey: 'sequence.phase.completeTitle',
    summaryKey: 'sequence.phase.completeSummary',
    statusKey: 'sequence.status.complete',
    crumbKey: 'sequence.crumb.complete',
    primaryKey: 'sequence.primary.regenerate',
    primaryAction: 'generate',
  },
  partial: {
    titleKey: 'sequence.phase.partialTitle',
    summaryKey: 'sequence.phase.partialSummary',
    statusKey: 'sequence.status.partial',
    crumbKey: 'sequence.crumb.partial',
    primaryKey: 'sequence.primary.retryGif',
    primaryAction: 'retryGif',
  },
  stale: {
    titleKey: 'sequence.phase.staleTitle',
    summaryKey: 'sequence.phase.staleSummary',
    statusKey: 'sequence.status.stale',
    crumbKey: 'sequence.crumb.stale',
    primaryKey: 'sequence.primary.regenerateCurrent',
    primaryAction: 'generate',
  },
  error: {
    titleKey: 'sequence.phase.errorTitle',
    summaryKey: 'sequence.phase.errorSummary',
    statusKey: 'sequence.status.error',
    crumbKey: 'sequence.crumb.error',
    primaryKey: 'sequence.primary.reselect',
    primaryAction: 'select',
  },
  local_error: {
    titleKey: 'sequence.phase.localErrorTitle',
    summaryKey: 'sequence.phase.localErrorSummary',
    statusKey: 'sequence.status.localError',
    crumbKey: 'sequence.crumb.localError',
    primaryKey: 'sequence.primary.retryLocal',
    primaryAction: 'retryLocal',
  },
})

const FIGMA_PHASE_COPY = Object.freeze({
  empty: {
    crumb: '· 本地打包 · 等待导入',
    status: '等待帧',
    label: '导入',
    primary: '选择帧文件',
  },
  ready: {
    crumb: '· 本地打包 · 帧已就绪',
    status: 'ready · 0 请求',
    label: '就绪',
    primary: '生成序列资源',
  },
  processing: {
    crumb: '· 本地打包 · 本地处理中',
    status: 'local_processing · 0 请求',
    label: '处理中',
    primary: '本地处理中…',
  },
  building: {
    crumb: '· 本地打包 · GIF 生成中',
    status: 'building · 1 请求',
    label: '生成',
    primary: '正在生成 GIF…',
  },
  complete: {
    crumb: '· 本地打包 · 全部完成',
    status: 'complete',
    label: '完成',
    primary: '重新生成',
  },
  partial: {
    crumb: '· 本地打包 · GIF 失败 · 部分完成',
    status: 'partial · GIF failed',
    label: '部分',
    primary: '重新生成 GIF',
  },
  stale: {
    crumb: '· 本地打包 · 输入或参数已变更',
    status: 'stale · locked',
    label: '失效',
    primary: '按当前参数重新生成',
  },
  error: {
    crumb: '· 本地打包 · 输入解码失败',
    status: 'input_error · 0 请求',
    label: '错误',
    primary: '重新选择帧文件',
  },
  local_error: {
    crumb: '· 本地打包 · 本地步骤失败',
    status: 'local_error · 0 请求',
    label: '错误',
    primary: '重试本地合成',
  },
})

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

function sequenceHtml(html) {
  const start = html.indexOf('id="studio-sequence-view"')
  const end = html.indexOf('id="studio-tiles-view"', start)
  assert.ok(start >= 0 && end > start, 'Studio Sequence view is missing')
  return html.slice(start, end)
}

function segmentFromId(html, id, endNeedle) {
  const start = html.indexOf(`id="${id}"`)
  const end = html.indexOf(endNeedle, start)
  assert.ok(start >= 0 && end > start, `could not isolate ${id}`)
  return html.slice(start, end)
}

function segmentBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle)
  const end = source.indexOf(endNeedle, start + startNeedle.length)
  assert.ok(start >= 0 && end > start, `could not isolate ${startNeedle}`)
  return source.slice(start, end)
}

function namedFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `missing function ${name}`)
  const signatureEnd = source.indexOf(') {', start)
  assert.notEqual(signatureEnd, -1, `missing signature terminator for ${name}`)
  const openingBrace = signatureEnd + 2
  assert.notEqual(openingBrace, -1, `missing body for ${name}`)
  let depth = 0
  let quote = null
  let escaped = false
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  assert.fail(`unterminated function ${name}`)
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('Studio Sequence is the nine-frame Figma route without an old-workspace header escape hatch', async () => {
  const [html, app] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
  ])
  const sequence = sequenceHtml(html)
  const designSource = openingTagForId(html, 'studio-sequence-view')

  assert.match(designSource, /data-studio-view="sequence"[^>]*data-sequence-phase="empty"[^>]*hidden/)
  assert.match(html, /href="#sequence" data-studio-route="sequence"/)
  assert.match(app, /import \{ initStudioSequence, renderStudioSequenceLanguage \} from '\.\/sequenceView\.js'/)
  assert.match(app, /const STUDIO_ROUTES = Object\.freeze\(\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\)/)
  assert.match(app, /sequence: 'MoteWeave · 序列工作室'/)
  assert.match(app, /sequence: 'MoteWeave · Sequence Studio'/)
  assert.match(app, /else if \(activeRoute === 'sequence'\) renderStudioSequenceLanguage\(\)/)
  assert.match(app, /sequenceInitializationPromise = Promise\.resolve\(initStudioSequence\(\{ serviceAvailable \}\)\)/)
  assert.match(html, /\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\.includes\(requestedRoute\)/)

  for (const nodeId of FIGMA_SEQUENCE_NODE_IDS) {
    assert.match(designSource, new RegExp(nodeId.replace(':', '\\:')))
  }
  assert.doesNotMatch(designSource, /54:107/, 'Archive is a Figma reference, not a live route state')

  assert.match(sequence, /<strong[^>]*data-studio-i18n="sequence\.headerTitle"[^>]*>序列工作室<\/strong>/)
  assert.match(sequence, /<span class="sequence-mode sequence-mode-local" aria-current="page"[^>]*>本地导入<\/span>/)
  assert.doesNotMatch(sequence, /sequence-mode-ai|AI 生成 · 后续提供/)
  assert.doesNotMatch(sequence, /\/?\?tab=sprite|sequence\.oldWorkspace|studio-sequence-old-workspace|旧工作区/)
  assert.doesNotMatch(sequence, /data-studio-server-required/, 'Sequence header has no legacy workspace link')
})

test('Studio Sequence HTML carries the exact nine phase copies, Binding summary, and Figma state shells', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const sequence = sequenceHtml(html)
  const phaseCopyGroups = [
    segmentFromId(sequence, 'studio-sequence-header-crumb', '<span class="sequence-mode'),
    segmentFromId(sequence, 'studio-sequence-status', '<div class="sequence-language-group'),
    segmentFromId(sequence, 'studio-sequence-phase-label', '<h1 id="studio-sequence-phase-title"'),
    segmentFromId(sequence, 'studio-sequence-phase-summary', '<section class="sequence-source-card"'),
    segmentFromId(sequence, 'studio-sequence-binding-summary', '<p id="studio-sequence-error"'),
    segmentFromId(sequence, 'studio-sequence-primary', '</button>'),
    segmentFromId(sequence, 'studio-sequence-live-status', '</p>'),
    segmentFromId(sequence, 'studio-sequence-output-truth', '</p>'),
  ]

  for (const phase of SEQUENCE_PHASES) {
    assert.equal(
      occurrences(sequence, new RegExp(`data-sequence-panel="${phase}"`, 'g')),
      1,
      `expected one dedicated ${phase} state panel`,
    )
    for (const group of phaseCopyGroups) {
      assert.match(group, new RegExp(`data-sequence-copy-phase="${phase}"`))
    }
    for (const [copyName, groupIndex] of [
      ['crumb', 0],
      ['status', 1],
      ['label', 2],
      ['primary', 5],
    ]) {
      assert.match(
        phaseCopyGroups[groupIndex],
        new RegExp(`data-sequence-copy-phase="${phase}"[^>]*>${escapeRegex(FIGMA_PHASE_COPY[phase][copyName])}<`),
      )
    }
  }

  assert.match(sequence, /data-sequence-result-shell="building complete partial stale"/)
  assert.match(sequence, /data-sequence-result-shell="building complete partial stale" aria-labelledby="studio-sequence-result-heading"/)
  assert.match(sequence, /<header id="studio-sequence-result-heading" class="sequence-result-heading sequence-phase-copy">/)
  assert.doesNotMatch(sequence, /id="studio-sequence-result-title"/)
  assert.match(sequence, /id="studio-sequence-binding-summary"[^>]*aria-labelledby="studio-sequence-binding-title"/)
  assert.match(sequence, /id="studio-sequence-binding-title"[^>]*>Binding Summary<\/h2>/)
  assert.match(sequence, /class="sequence-pixel-person"[^>]*aria-hidden="true"><i><\/i><b><\/b><span><\/span>/)
  assert.match(sequence, /class="sequence-truth-pill"[^>]*>无 AI · 无任务队列 · 不保存到项目<\/small>/)
  assert.match(css, /\.sequence-main \.sequence-phase-copy \[data-sequence-copy-phase\][^{]*\{\s*display:\s*none !important;/s)
  for (const phase of SEQUENCE_PHASES) {
    assert.match(css, new RegExp(`data-sequence-phase="${phase}"[^}]+data-sequence-copy-phase~="${phase}"`))
  }

  assert.match(css, /\.sequence-output-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, 178px\)/s)
  assert.match(css, /\.sequence-output-button\s*\{[^}]*width:\s*178px;[^}]*height:\s*72px/s)
  for (const [id, type, filename] of [
    ['studio-sequence-download-png', 'PNG', 'sprite.png'],
    ['studio-sequence-download-json', 'JSON', 'index.json'],
    ['studio-sequence-download-gif', 'GIF', 'preview.gif'],
    ['studio-sequence-download-zip', 'ZIP', 'sprite_sheet.zip'],
  ]) {
    const button = segmentFromId(sequence, id, '</button>')
    assert.match(openingTagForId(sequence, id), /\bdisabled\b/)
    assert.match(button, new RegExp(`class="sequence-output-type">${type}<`))
    assert.match(button, new RegExp(`<strong>${filename.replace('.', '\\.')}<\\/strong>`))
  }

  const hiddenEvidence = openingTagForId(sequence, 'studio-sequence-preview-image')
  assert.match(hiddenEvidence, /\bhidden\b/)
  assert.doesNotMatch(hiddenEvidence, /\bsrc\s*=/)
  assert.match(sequence, /class="sequence-controller-evidence" aria-hidden="true"/)
})

test('Figma Processing and Local Error have dedicated truthful DOM and fixed desktop shells', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const sequence = sequenceHtml(html)
  const processing = segmentBetween(
    sequence,
    '<section class="sequence-state-panel sequence-processing-panel"',
    '<section class="sequence-state-panel sequence-error-panel"',
  )
  const localError = segmentBetween(
    sequence,
    '<section class="sequence-state-panel sequence-error-panel sequence-local-error-panel"',
    '<div class="sequence-controller-evidence"',
  )
  const processingCss = segmentBetween(
    css,
    '.sequence-main[data-sequence-phase="processing"] .sequence-processing-panel',
    '.sequence-processing-pill {',
  )
  const localErrorCss = segmentBetween(
    css,
    '.sequence-main[data-sequence-phase="error"] .sequence-error-panel[data-sequence-panel~="error"],',
    '.sequence-error-panel > *',
  )

  assert.match(processing, /data-sequence-panel="processing"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-labelledby="studio-sequence-processing-title"/)
  assert.match(processing, /data-sequence-processing-badge[^>]*>本地处理 · 0 请求<\/span>/)
  assert.match(processing, /id="studio-sequence-processing-title"[^>]*data-sequence-processing-title[^>]*>正在浏览器内处理<\/h2>/)
  assert.match(processing, /data-sequence-processing-current[^>]*>当前步骤：读取并校验帧。<\/p>/)
  assert.match(processing, /data-sequence-processing-help[^>]*>完成后可确认参数并开始本地生成；本步骤不会请求 GIF。<\/p>/)
  assert.match(processing, /class="sequence-processing-recovery"[^>]*data-sequence-processing-recovery[^>]*>完成后会进入可生成状态；当前无需再次点击。<\/p>/)
  assert.match(sequence, /class="sequence-processing-notice"[^>]*>处理期间源文件与参数暂时锁定；不会重复提交。<\/p>/)
  assert.match(processingCss, /display:\s*block !important;/)
  assert.match(processingCss, /width:\s*716px;/)
  assert.match(processingCss, /(?:min-height|height):\s*300px;/)
  assert.match(processingCss, /border:\s*1px solid var\(--sequence-cyan\);/)

  assert.match(localError, /data-sequence-panel="local_error"[^>]*role="alert"[^>]*aria-live="assertive"/)
  const preGif = segmentBetween(
    localError,
    'data-sequence-local-error-variant="pre_gif"',
    '<div class="sequence-local-error-variant" data-sequence-local-error-variant="package_after_gif"',
  )
  const afterGif = localError.slice(localError.indexOf('data-sequence-local-error-variant="package_after_gif"'))
  assert.match(preGif, /本地步骤失败/)
  assert.match(preGif, /本地步骤未完成/)
  assert.match(preGif, /原始错误：当前布局过大，浏览器无法安全生成。请减小帧尺寸、列数或帧数量。/)
  assert.match(preGif, /GIF 尚未请求 · 0 个输出。/)
  assert.match(preGif, /当前选择和参数仍保留；只重试本次失败的本地步骤。/)
  assert.match(afterGif, /本地步骤未完成/)
  assert.match(afterGif, /已发起 1 次 GIF 请求 · PNG \/ JSON \/ GIF 已保留。/)
  assert.match(afterGif, /仅重试最终 ZIP 打包；不会再次请求 GIF。/)
  assert.match(localErrorCss, /width:\s*716px;/)
  assert.match(localErrorCss, /(?:min-height|height):\s*300px;/)
  assert.match(localErrorCss, /border:\s*1px solid var\(--sequence-red\);/)
  assert.match(css, /\.sequence-main\[data-sequence-phase="local_error"\] \[data-sequence-panel~="local_error"\]\s*\{\s*display:\s*grid !important;/)
  assert.match(css, /\.sequence-local-error-variant\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s)
})

test('Studio Sequence exposes only maintained local inputs and the six normalized parameters', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/sequenceView.js', 'utf8'),
  ])
  const sequence = sequenceHtml(html)

  for (const id of [
    'studio-sequence-file',
    'studio-sequence-target-w',
    'studio-sequence-target-h',
    'studio-sequence-padding',
    'studio-sequence-spacing',
    'studio-sequence-columns',
    'studio-sequence-fps',
    'studio-sequence-primary',
    'studio-sequence-canvas',
    'studio-sequence-frame-list',
  ]) {
    assert.notEqual(openingTagForId(sequence, id), '', `missing Sequence control ${id}`)
  }

  assert.match(openingTagForId(sequence, 'studio-sequence-file'), /accept="image\/png,image\/jpeg,image\/webp"[^>]*multiple/)
  assert.match(sequence, /<label id="studio-sequence-drop-zone"[^>]*for="studio-sequence-file"/)
  assert.match(openingTagForId(sequence, 'studio-sequence-target-w'), /min="1"[^>]*max="4096"[^>]*value="256"/)
  assert.match(openingTagForId(sequence, 'studio-sequence-target-h'), /min="1"[^>]*max="4096"[^>]*value="256"/)
  assert.match(openingTagForId(sequence, 'studio-sequence-padding'), /min="0"[^>]*max="128"[^>]*value="0"/)
  assert.match(openingTagForId(sequence, 'studio-sequence-spacing'), /min="0"[^>]*max="128"[^>]*value="0"/)
  assert.match(openingTagForId(sequence, 'studio-sequence-columns'), /min="1"[^>]*max="64"[^>]*value="4"/)
  assert.match(openingTagForId(sequence, 'studio-sequence-fps'), /min="1"[^>]*max="120"[^>]*value="12"/)
  const phaseSetSource = view.match(/const SEQUENCE_PHASES = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
  assert.deepEqual(
    [...phaseSetSource.matchAll(/'([^']+)'/g)]
      .map((match) => match[1]),
    SEQUENCE_PHASES,
  )
  assert.doesNotMatch(sequence, /(?:Job ID|取消任务|继续任务|质量通过|修复|WASD|云同步|项目保存)/i)
  assert.doesNotMatch(view, /\/api\/(?:jobs|generate-character|process-sheet)|\b(?:provider|openrouter|jobId|pollJob|cancelJob|resumeJob)\b/i)
})

test('Sequence presentation matches all nine Figma states and their honest primary actions', () => {
  for (const phase of SEQUENCE_PHASES) {
    const presentation = deriveSequencePresentation({
      ...createInitialSequenceState(),
      phase,
    })
    assert.deepEqual(
      Object.fromEntries(Object.keys(PRESENTATION_CONTRACT[phase]).map((key) => [key, presentation[key]])),
      PRESENTATION_CONTRACT[phase],
    )
    assert.equal(presentation.phase, phase)
  }
  assert.equal(deriveSequencePresentation({ phase: 'invented' }).phase, 'empty')
  assert.equal(deriveSequencePresentation({ phase: 'empty' }).primaryAction, 'select')
  assert.equal(deriveSequencePresentation({ phase: 'error' }).primaryAction, 'select')
  assert.equal(deriveSequencePresentation({ phase: 'processing' }).primaryAction, 'busy')
  assert.equal(deriveSequencePresentation({ phase: 'partial' }).primaryAction, 'retryGif')
  assert.equal(deriveSequencePresentation({ phase: 'local_error' }).primaryAction, 'retryLocal')
})

test('Partial retries only the GIF service and preserves the current local outputs', async () => {
  const view = await readFile('src/ui/studio/sequenceView.js', 'utf8')
  const retry = namedFunctionSource(view, 'retrySequenceGif')
  const bind = namedFunctionSource(view, 'bindSequenceInputs')
  const controls = namedFunctionSource(view, 'renderControls')

  assert.match(retry, /sequenceOutputsAreCurrent\(state\)/)
  assert.match(retry, /state\.outputs\.sheetBlob/)
  assert.match(retry, /state\.outputs\.index/)
  assert.match(retry, /const orderedFrames = Object\.freeze\(\[\.\.\.state\.frames\]\)[\s\S]*requestFrameGif\(\{[\s\S]*orderedFrames,[\s\S]*options:\s*state\.options,/)
  assert.match(retry, /state\.busy = 'gif'\s*state\.processingStep = 'read'\s*state\.phase = 'processing'/)
  assert.doesNotMatch(retry, /state\.processingStep = 'local_build'/)
  assert.match(retry, /makeSpriteZip\(\{[\s\S]*sheetBlob:\s*state\.outputs\.sheetBlob,[\s\S]*index:\s*state\.outputs\.index,[\s\S]*gifBlob,/)
  assert.match(retry, /state\.outputs = \{ \.\.\.state\.outputs, gifBlob, zipBlob \}/)
  assert.match(retry, /state\.phase = 'complete'/)
  assert.match(retry, /state\.phase = 'partial'/)
  assert.doesNotMatch(retry, /clearSequenceOutputs|buildLocalSequenceOutput|outputs\s*=\s*outputSet\(\)/)

  assert.match(bind, /if \(action === 'select'\) \{\s*byId\('studio-sequence-file'\)\?\.click\(\)/)
  assert.match(bind, /else if \(action === 'retryGif'\) \{\s*void retrySequenceGif\(\)/)
  assert.match(bind, /else if \(action === 'retryLocal'\) \{\s*void retryLocalStep\(\)/)
  assert.match(bind, /else if \(action === 'generate'\) \{\s*void generateSequence\(\)/)
  assert.match(controls, /const needsFrames = \['generate', 'retryGif', 'retryLocal'\]\.includes\(presentation\.primaryAction\)/)
  assert.match(controls, /primary\.dataset\.sequenceAction = presentation\.primaryAction/)
  assert.match(controls, /\(needsFrames && !state\.frames\.length\)/)
})

test('pre-GIF local failure retries generation, while post-GIF ZIP failure retries only local packaging', async () => {
  const view = await readFile('src/ui/studio/sequenceView.js', 'utf8')
  const generate = namedFunctionSource(view, 'generateSequence')
  const retryGif = namedFunctionSource(view, 'retrySequenceGif')
  const retryLocal = namedFunctionSource(view, 'retryLocalStep')

  const localBuildIndex = generate.indexOf('buildLocalSequenceOutput(state, plan, orderedFrames)')
  const gifPostIndex = generate.indexOf('requestFrameGif({')
  const requestStartIndex = generate.indexOf('onRequestStart: () => {', gifPostIndex)
  const requestCountIndex = generate.indexOf('state.gifRequestCount += 1', requestStartIndex)
  const gifStoredIndex = generate.indexOf('state.outputs = { ...outputs, gifBlob }')
  const finalPackageIndex = generate.indexOf('makeSpriteZip({', gifStoredIndex)
  assert.ok(localBuildIndex >= 0 && localBuildIndex < gifPostIndex)
  assert.ok(gifPostIndex < requestStartIndex && requestStartIndex < requestCountIndex)
  assert.ok(requestCountIndex < gifStoredIndex && gifStoredIndex < finalPackageIndex)
  assert.match(generate, /if \(gifReady\) \{\s*state\.localFailureStage = 'package_after_gif'[\s\S]*state\.phase = 'local_error'/)
  assert.match(generate, /else if \(localReady && gifRequestStarted\) \{\s*state\.lastGifError = state\.error\s*state\.phase = 'partial'/)
  assert.match(generate, /else \{\s*state\.outputs = outputSet\(\)\s*state\.binding = null\s*state\.outputOptions = null[\s\S]*state\.localFailureStage = 'pre_gif'[\s\S]*state\.phase = 'local_error'/)

  assert.match(retryGif, /if \(gifReady\) \{\s*state\.localFailureStage = 'package_after_gif'[\s\S]*state\.phase = 'local_error'/)
  assert.match(retryLocal, /if \(state\.localFailureStage !== 'package_after_gif'\) \{\s*await generateSequence\(\)\s*return\s*\}/)
  assert.match(retryLocal, /state\.processingStep = 'package'\s*state\.phase = 'processing'/)
  assert.match(retryLocal, /makeSpriteZip\(\{\s*sheetBlob:\s*state\.outputs\.sheetBlob,\s*index:\s*state\.outputs\.index,\s*gifBlob:\s*state\.outputs\.gifBlob,/)
  assert.match(retryLocal, /state\.outputs = \{ \.\.\.state\.outputs, zipBlob \}/)
  assert.doesNotMatch(retryLocal, /requestFrameGif|gifRequestCount\s*\+=/)
})

test('GIF request count is incremented once per real POST and rendered as phase truth', async () => {
  const view = await readFile('src/ui/studio/sequenceView.js', 'utf8')
  const generate = namedFunctionSource(view, 'generateSequence')
  const retryGif = namedFunctionSource(view, 'retrySequenceGif')
  const retryLocal = namedFunctionSource(view, 'retryLocalStep')
  const clearOutputs = namedFunctionSource(view, 'clearSequenceOutputs')
  const renderMetrics = namedFunctionSource(view, 'renderMetrics')
  const renderRuntime = namedFunctionSource(view, 'renderRuntimePhaseCopy')

  assert.equal(createInitialSequenceState().gifRequestCount, 0)
  assert.match(clearOutputs, /state\.gifRequestCount = 0/)
  assert.equal(occurrences(generate, /state\.gifRequestCount \+= 1/g), 1)
  assert.equal(occurrences(generate, /requestFrameGif\(\{/g), 1)
  assert.equal(occurrences(retryGif, /state\.gifRequestCount \+= 1/g), 1)
  assert.equal(occurrences(retryGif, /requestFrameGif\(\{/g), 1)
  assert.equal(occurrences(retryLocal, /state\.gifRequestCount \+= 1/g), 0)
  assert.equal(occurrences(retryLocal, /requestFrameGif\(\{/g), 0)
  assert.match(generate, /requestFrameGif\(\{[\s\S]*onRequestStart: \(\) => \{[\s\S]*state\.gifRequestCount \+= 1[\s\S]*state\.phase = 'building'[\s\S]*renderStudioSequence\(state\)/)
  assert.match(retryGif, /requestFrameGif\(\{[\s\S]*onRequestStart: \(\) => \{[\s\S]*state\.gifRequestCount \+= 1[\s\S]*state\.phase = 'building'[\s\S]*renderStudioSequence\(state\)/)

  assert.match(renderMetrics, /requests:\s*state\.gifRequestCount/)
  assert.match(renderRuntime, /studioT\(statusKey, \{ requests:\s*state\.gifRequestCount \}\)/)
  assert.match(renderRuntime, /studioT\(liveKey, \{ requests:\s*state\.gifRequestCount \}\)/)
  assert.match(renderRuntime, /const guidanceStep = state\.busy === 'gif' && step === 'read' \? 'local_build' : step/)
  assert.match(renderRuntime, /state\.localFailureStage === 'package_after_gif'[\s\S]*'sequence\.status\.packageError'/)
  assert.match(renderRuntime, /data-sequence-local-error-count[\s\S]*requests:\s*state\.gifRequestCount/)
  assert.match(STUDIO_TRANSLATIONS.en['sequence.live.processing.read'], /\{requests\}/)
  assert.match(STUDIO_TRANSLATIONS.zh['sequence.live.processing.read'], /\{requests\}/)
})

test('successful source replacement becomes stale without clearing outputs, and normalized options are written back', async () => {
  const view = await readFile('src/ui/studio/sequenceView.js', 'utf8')
  const decode = namedFunctionSource(view, 'decodeSequenceFiles')
  const updateOptions = namedFunctionSource(view, 'updateSequenceOptions')
  const writeOptions = namedFunctionSource(view, 'writeSequenceOptions')
  const successfulDecode = decode.slice(0, decode.lastIndexOf('} catch (error) {'))

  assert.match(successfulDecode, /const hadOutputAuthority = Boolean\(state\.binding \|\| state\.outputs\.sheetBlob\)/)
  assert.match(successfulDecode, /state\.sourceEpoch \+= 1/)
  assert.match(successfulDecode, /state\.frames = decoded/)
  assert.match(successfulDecode, /if \(hadOutputAuthority\) state\.outputsInvalidated = true/)
  assert.match(successfulDecode, /state\.phase = hadOutputAuthority \? 'stale' : 'ready'/)
  assert.doesNotMatch(successfulDecode, /clearSequenceOutputs|state\.outputs\s*=/)
  assert.match(decode, /catch \(error\) \{[\s\S]*clearSequenceOutputs\(state\)[\s\S]*state\.phase = 'error'/)

  assert.match(updateOptions, /const options = readSequenceOptions\(\)\s*writeSequenceOptions\(options\)\s*const nextKey = sequenceOptionsKey\(options\)/)
  assert.match(updateOptions, /const previousPhase = state\.phase\s*const previousError = state\.error/)
  assert.match(updateOptions, /const hadOutputAuthority = Boolean\(state\.binding \|\| state\.outputs\.sheetBlob\)/)
  assert.match(updateOptions, /state\.options = options\s*state\.optionsKey = nextKey/)
  assert.match(updateOptions, /if \(hadOutputAuthority\) \{\s*state\.outputsInvalidated = true[\s\S]*state\.phase = 'stale'/)
  assert.doesNotMatch(updateOptions, /restoredCurrentOutput/)
  assert.match(updateOptions, /else if \(previousPhase === 'local_error' && state\.localFailureStage === 'pre_gif' && state\.frames\.length\) \{\s*state\.phase = 'local_error'\s*state\.error = state\.lastLocalError \?\? previousError/)
  assert.match(updateOptions, /else if \(previousPhase === 'error'\) \{\s*state\.phase = 'error'\s*state\.error = previousError/)
  assert.match(writeOptions, /input\.value = String\(options\[key\]\)/)

  assert.deepEqual(normalizeSequenceOptions({
    targetW: 0,
    targetH: 5000,
    padding: -2,
    spacing: 999,
    columns: 0,
    fps: 999,
  }), {
    targetW: 1,
    targetH: 4096,
    padding: 0,
    spacing: 128,
    columns: 1,
    fps: 120,
  })
  assert.equal(
    normalizeSequenceOptions({ targetW: 10, targetH: 8, padding: 128 }).padding,
    3,
    'padding must leave at least one drawable pixel inside the smaller cell edge',
  )
  assert.equal(normalizeSequenceOptions({ targetW: 1, targetH: 4096, padding: 128 }).padding, 0)
})

test('frame edits advance the source epoch, abort old work, and lock retained outputs as stale', () => {
  const state = createInitialSequenceState()
  const first = { file: { name: 'frame1.png' }, url: 'blob:first' }
  const second = { file: { name: 'frame2.png' }, url: 'blob:second' }
  const third = { file: { name: 'frame3.png' }, url: 'blob:third' }
  const sheetBlob = {}
  const index = { frames: [] }
  const gifBlob = {}
  const zipBlob = {}
  let aborts = 0
  state.phase = 'complete'
  state.frames = [first, second, third]
  state.sourceEpoch = 4
  state.operationToken = 7
  state.binding = createSequenceBinding({
    sourceEpoch: state.sourceEpoch,
    optionsKey: state.optionsKey,
  })
  state.outputs = { sheetBlob, index, gifBlob, zipBlob }
  state.controller = { abort: () => { aborts += 1 } }
  assert.equal(sequenceOutputsAreCurrent(state), true)

  const removedUrls = []
  const result = applySequenceFrameEdit(
    state,
    { action: 'remove', index: 1 },
    { revokeObjectURL: (url) => removedUrls.push(url) },
  )

  assert.equal(result.changed, true)
  assert.equal(result.removedFrame, second)
  assert.equal(result.focusAction, 'remove')
  assert.equal(result.focusIndex, 1)
  assert.deepEqual(state.frames, [first, third])
  assert.deepEqual(removedUrls, ['blob:second'])
  assert.equal(aborts, 1)
  assert.equal(state.controller, null)
  assert.equal(state.operationToken, 8)
  assert.equal(state.sourceEpoch, 5)
  assert.equal(state.phase, 'stale')
  assert.equal(state.outputsInvalidated, true)
  assert.deepEqual(state.outputs, { sheetBlob, index, gifBlob, zipBlob })
  assert.equal(state.binding.sourceEpoch, 4)
  assert.equal(sequenceOutputsAreCurrent(state), false)
})

test('frame moves without outputs remain ready and editing the final frame clears authority', () => {
  const first = { file: { name: 'frame1.png' }, url: 'blob:first' }
  const second = { file: { name: 'frame2.png' }, url: 'blob:second' }
  const ready = createInitialSequenceState()
  ready.phase = 'ready'
  ready.frames = [first, second]

  const moveRevocations = []
  const moved = applySequenceFrameEdit(
    ready,
    { action: 'move_down', index: 0 },
    { revokeObjectURL: (url) => moveRevocations.push(url) },
  )
  assert.equal(moved.changed, true)
  assert.deepEqual(ready.frames, [second, first])
  assert.equal(ready.phase, 'ready')
  assert.equal(ready.sourceEpoch, 1)
  assert.equal(ready.operationToken, 1)
  assert.equal(ready.binding, null)
  assert.equal(ready.outputsInvalidated, false)
  assert.deepEqual(moveRevocations, [])

  const last = createInitialSequenceState()
  last.phase = 'complete'
  last.frames = [first]
  last.sourceEpoch = 2
  last.binding = createSequenceBinding({ sourceEpoch: 2, optionsKey: last.optionsKey })
  last.outputs = { sheetBlob: {}, index: {}, gifBlob: {}, zipBlob: {} }
  const revoked = []
  const removed = applySequenceFrameEdit(
    last,
    { action: 'remove', index: 0 },
    { revokeObjectURL: (url) => revoked.push(url) },
  )
  assert.equal(removed.changed, true)
  assert.deepEqual(last.frames, [])
  assert.equal(last.phase, 'empty')
  assert.equal(last.sourceEpoch, 3)
  assert.equal(last.binding, null)
  assert.deepEqual(last.outputs, { sheetBlob: null, index: null, gifBlob: null, zipBlob: null })
  assert.equal(last.outputsInvalidated, false)
  assert.deepEqual(revoked, ['blob:first'])
})

test('editing partial and post-GIF local failures always invalidates retry authority', () => {
  for (const [phase, localFailureStage] of [
    ['partial', null],
    ['local_error', 'package_after_gif'],
  ]) {
    const first = { file: { name: 'frame1.png' }, url: 'blob:first' }
    const second = { file: { name: 'frame2.png' }, url: 'blob:second' }
    const state = createInitialSequenceState()
    state.phase = phase
    state.localFailureStage = localFailureStage
    state.frames = [first, second]
    state.sourceEpoch = 9
    state.binding = createSequenceBinding({ sourceEpoch: 9, optionsKey: state.optionsKey })
    state.outputs = { sheetBlob: {}, index: {}, gifBlob: localFailureStage ? {} : null, zipBlob: {} }

    const result = applySequenceFrameEdit(state, { action: 'move_down', index: 0 })
    assert.equal(result.changed, true)
    assert.equal(state.phase, 'stale')
    assert.equal(state.localFailureStage, null)
    assert.equal(state.outputsInvalidated, true)
    assert.equal(sequenceOutputsAreCurrent(state), false)
  }
})

test('an interrupted binding without retained outputs returns to ready after an edit', () => {
  const state = createInitialSequenceState()
  state.phase = 'local_error'
  state.frames = [
    { file: { name: 'frame1.png' }, url: 'blob:first' },
    { file: { name: 'frame2.png' }, url: 'blob:second' },
  ]
  state.sourceEpoch = 3
  state.binding = createSequenceBinding({ sourceEpoch: 3, optionsKey: state.optionsKey })
  state.localFailureStage = 'pre_gif'

  const result = applySequenceFrameEdit(state, { action: 'move_down', index: 0 })
  assert.equal(result.changed, true)
  assert.equal(state.phase, 'ready')
  assert.equal(state.binding, null)
  assert.equal(state.outputsInvalidated, false)
  assert.equal(sequenceOutputsAreCurrent(state), false)
})

test('frame edit boundaries, unavailable service, and busy work fail closed', () => {
  const frame = { file: { name: 'frame.png' }, url: 'blob:frame' }
  for (const [configure, action] of [
    [(state) => { state.serviceAvailable = false }, 'remove'],
    [(state) => { state.busy = 'build' }, 'remove'],
    [() => {}, 'move_up'],
  ]) {
    const state = createInitialSequenceState()
    state.phase = 'ready'
    state.frames = [frame]
    configure(state)
    const before = {
      frames: state.frames,
      sourceEpoch: state.sourceEpoch,
      operationToken: state.operationToken,
      phase: state.phase,
    }
    const result = applySequenceFrameEdit(state, { action, index: 0 })
    assert.equal(result.changed, false)
    assert.equal(state.frames, before.frames)
    assert.equal(state.sourceEpoch, before.sourceEpoch)
    assert.equal(state.operationToken, before.operationToken)
    assert.equal(state.phase, before.phase)
  }
})

test('file picker and drag/drop share atomic decode, and GIF uses exactly one POST endpoint contract', async () => {
  const [view, api] = await Promise.all([
    readFile('src/ui/studio/sequenceView.js', 'utf8'),
    readFile('src/ui/sprite/api.js', 'utf8'),
  ])
  const bind = namedFunctionSource(view, 'bindSequenceInputs')
  const request = namedFunctionSource(api, 'requestFrameGif')

  assert.match(bind, /addEventListener\('change',[\s\S]*Array\.from\(event\.currentTarget\.files \?\? \[\]\)[\s\S]*event\.currentTarget\.value = ''[\s\S]*decodeSequenceFiles\(files\)/)
  assert.match(bind, /byId\('studio-sequence-drop-zone'\) \?\? byId\('studio-sequence-view'\)/)
  assert.match(bind, /addEventListener\('dragover',[\s\S]*event\.preventDefault\(\)[\s\S]*classList\.add\('is-dragging'\)/)
  assert.match(bind, /addEventListener\('dragleave',[\s\S]*classList\.remove\('is-dragging'\)/)
  assert.match(bind, /addEventListener\('drop',[\s\S]*event\.preventDefault\(\)[\s\S]*event\.dataTransfer\?\.files[\s\S]*decodeSequenceFiles\(files\)/)
  assert.match(bind, /studio-sequence-frame-list'[\s\S]*addEventListener\('click',[\s\S]*data-sequence-frame-action[\s\S]*data-sequence-frame-index[\s\S]*editSequenceFrame/)

  assert.equal(occurrences(api, /fetchImpl\(/g), 1)
  assert.equal(occurrences(api, /['"]\/api\/build-frame-gif['"]/g), 1)
  assert.equal(occurrences(api, /method:\s*'POST'/g), 1)
  assert.match(request, /body:\s*JSON\.stringify\(\{\s*frames_base64:\s*encodedFrames,\s*options:\s*\{\s*targetW:\s*normalized\.targetW,\s*targetH:\s*normalized\.targetH,\s*padding:\s*normalized\.padding,\s*fps:\s*normalized\.fps,?\s*\},\s*\}\)/)
  assert.equal(occurrences(view, /requestFrameGif\(\{/g), 2, 'initial build and Partial retry share the same GIF API')
  assert.doesNotMatch(view, /\bfetch\s*\(/, 'Studio controller delegates its only remote call to sprite/api.js')
  assert.doesNotMatch(
    `${view}\n${api}`,
    /\/api\/(?:jobs|generate-character|process-sheet)|\b(?:provider|openrouter|jobId|pollJob|cancelJob|resumeJob)\b/i,
  )
})

test('frame controls expose localized native buttons and restore focus after delegated edits', async () => {
  const view = await readFile('src/ui/studio/sequenceView.js', 'utf8')
  const renderFrames = namedFunctionSource(view, 'renderFrameList')
  const restoreFocus = namedFunctionSource(view, 'restoreSequenceFrameFocus')
  const editFrame = namedFunctionSource(view, 'editSequenceFrame')

  for (const action of ['move_up', 'move_down', 'remove']) {
    assert.match(renderFrames, new RegExp(`\\['${action}'`))
  }
  assert.match(renderFrames, /button\.type = 'button'/)
  assert.match(renderFrames, /button\.dataset\.sequenceFrameAction = action/)
  assert.match(renderFrames, /button\.setAttribute\('aria-label', label\)/)
  assert.match(renderFrames, /button\.setAttribute\('aria-disabled', String\(button\.disabled\)\)/)
  assert.match(renderFrames, /button\.title = label/)
  assert.match(renderFrames, /!state\.serviceAvailable[\s\S]*state\.busy[\s\S]*action === 'move_up'[\s\S]*action === 'move_down'/)
  assert.match(restoreFocus, /data-sequence-frame-index="\$\{focusIndex\}"/)
  assert.match(restoreFocus, /data-sequence-frame-action="\$\{focusAction\}"/)
  assert.match(restoreFocus, /querySelector\('\[data-sequence-frame-action\]:not\(:disabled\)'\)/)
  assert.match(restoreFocus, /getClientRects\?\.\(\)\.length/)
  assert.match(restoreFocus, /studio-sequence-primary/)
  assert.match(editFrame, /applySequenceFrameEdit\(sequenceState, \{ action, index \}\)/)
  assert.match(editFrame, /renderStudioSequence\(sequenceState\)[\s\S]*studio-sequence-live-status[\s\S]*setNodeText\(liveCopy, sequenceState\.notice\)[\s\S]*restoreSequenceFrameFocus\(result\)/)
})

test('local Sheet and both GIF paths use one captured edited frame order', async () => {
  const view = await readFile('src/ui/studio/sequenceView.js', 'utf8')
  const build = namedFunctionSource(view, 'buildLocalSequenceOutput')
  const generate = namedFunctionSource(view, 'generateSequence')
  const retryGif = namedFunctionSource(view, 'retrySequenceGif')

  assert.match(build, /orderedFrames\[index\]\.image/)
  assert.match(generate, /const orderedFrames = Object\.freeze\(\[\.\.\.state\.frames\]\)/)
  assert.match(generate, /buildSequencePlan\(\{ frameCount: orderedFrames\.length, options: state\.options \}\)/)
  assert.match(generate, /buildLocalSequenceOutput\(state, plan, orderedFrames\)/)
  assert.match(generate, /requestFrameGif\(\{\s*orderedFrames,/)
  assert.doesNotMatch(generate, /requestFrameGif\(\{\s*files:/)
  assert.match(retryGif, /const orderedFrames = Object\.freeze\(\[\.\.\.state\.frames\]\)/)
  assert.match(retryGif, /requestFrameGif\(\{\s*orderedFrames,/)
  assert.doesNotMatch(retryGif, /requestFrameGif\(\{\s*files:/)
})

test('Studio Sequence starts with no fake media and binds only current outputs to exact filenames', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/sequenceView.js', 'utf8'),
  ])
  const sequence = sequenceHtml(html)
  const renderDownloads = namedFunctionSource(view, 'renderDownloadState')

  const hiddenEvidence = openingTagForId(sequence, 'studio-sequence-preview-image')
  assert.match(hiddenEvidence, /\bhidden\b/)
  assert.doesNotMatch(hiddenEvidence, /\bsrc\s*=/)
  for (const id of [
    'studio-sequence-download-png',
    'studio-sequence-download-json',
    'studio-sequence-download-gif',
    'studio-sequence-download-zip',
  ]) {
    assert.match(openingTagForId(sequence, id), /\bdisabled\b/)
  }

  assert.match(view, /sequenceBindingIsCurrent\(state\.binding, currentBindingSnapshot\(state\)\)/)
  assert.match(renderDownloads, /const packageFailureAvailable = current &&\s*state\.phase === 'local_error' &&\s*state\.localFailureStage === 'package_after_gif'/)
  assert.match(renderDownloads, /gif:\s*\(localAvailable \|\| packageFailureAvailable\) && Boolean\(state\.outputs\.gifBlob\)/)
  assert.match(renderDownloads, /processing:\s*\{\s*png:\s*'sequence\.output\.locked',\s*json:\s*'sequence\.output\.locked',\s*gif:\s*'sequence\.output\.locked',\s*zip:\s*'sequence\.output\.locked'\s*\}/)
  assert.match(renderDownloads, /building:\s*\{\s*png:\s*'sequence\.output\.available',\s*json:\s*'sequence\.output\.available',\s*gif:\s*'sequence\.output\.generating',\s*zip:\s*'sequence\.output\.availableGifPending'\s*\}/)
  assert.match(renderDownloads, /complete:\s*\{\s*png:\s*'sequence\.output\.available',\s*json:\s*'sequence\.output\.available',\s*gif:\s*'sequence\.output\.available',\s*zip:\s*'sequence\.output\.availableWithGif'\s*\}/)
  assert.match(renderDownloads, /partial:\s*\{\s*png:\s*'sequence\.output\.available',\s*json:\s*'sequence\.output\.available',\s*gif:\s*'sequence\.output\.notGenerated',\s*zip:\s*'sequence\.output\.availableWithoutGif'\s*\}/)
  assert.match(renderDownloads, /stale:\s*\{\s*png:\s*'sequence\.output\.locked',\s*json:\s*'sequence\.output\.locked',\s*gif:\s*'sequence\.output\.locked',\s*zip:\s*'sequence\.output\.locked'\s*\}/)
  assert.match(renderDownloads, /local_error:\s*packageFailureAvailable\s*\?\s*\{\s*png:\s*'sequence\.output\.available',\s*json:\s*'sequence\.output\.available',\s*gif:\s*'sequence\.output\.available',\s*zip:\s*'sequence\.output\.availableWithoutGif'\s*\}/)
  assert.match(view, /state\.localFailureStage = 'pre_gif'[\s\S]*state\.phase = 'local_error'/)
  assert.match(view, /state\.phase = 'stale'/)
  assert.match(view, /downloadBlob\(state\.outputs\.sheetBlob, 'sprite\.png'\)/)
  assert.match(view, /'index\.json'/)
  assert.match(view, /downloadBlob\(state\.outputs\.gifBlob, 'preview\.gif'\)/)
  assert.match(view, /downloadBlob\(state\.outputs\.zipBlob, 'sprite_sheet\.zip'\)/)

  const state = createInitialSequenceState()
  assert.equal(state.phase, 'empty')
  assert.equal(sequenceOutputsAreCurrent(state), false)
  const optionsKey = sequenceOptionsKey(state.options)
  state.sourceEpoch = 2
  state.optionsKey = optionsKey
  state.binding = createSequenceBinding({ sourceEpoch: 2, optionsKey })
  state.outputs.sheetBlob = {}
  state.outputs.index = {}
  assert.equal(sequenceOutputsAreCurrent(state), true)
  state.outputsInvalidated = true
  assert.equal(sequenceOutputsAreCurrent(state), false)
  state.outputsInvalidated = false
  state.optionsKey = sequenceOptionsKey({ ...state.options, fps: state.options.fps + 1 })
  assert.equal(sequenceOutputsAreCurrent(state), false)
})

test('Sequence has the 1771, 1083, and 860 responsive contracts required by the Figma shells', async () => {
  const css = await readFile('src/ui/studio/studio.css', 'utf8')
  const desktopStack = segmentBetween(
    css,
    '@media (max-width: 1771px) {',
    '@media (max-width: 1083px) {',
  )
  const compactHeader = segmentBetween(
    css,
    '@media (max-width: 1083px) {',
    '@media (max-width: 860px) {',
  )
  const mobileStart = css.indexOf('@media (max-width: 860px) {', css.indexOf('@media (max-width: 1083px) {'))
  assert.notEqual(mobileStart, -1)
  const mobile = css.slice(mobileStart)

  assert.match(desktopStack, /\.sequence-stage-body\s*\{[^}]*display:\s*block;[^}]*overflow:\s*auto;/s)
  assert.match(desktopStack, /data-sequence-result-shell[^}]*width:\s*min\(940px, calc\(100% - 40px\)\);/s)
  assert.match(desktopStack, /data-sequence-phase="processing"[^}]*sequence-processing-panel[\s\S]*data-sequence-phase="local_error"[^}]*sequence-local-error-panel[^}]*\{\s*width:\s*min\(716px, calc\(100% - 40px\)\);/)
  assert.match(desktopStack, /\.sequence-output-dock\s*\{\s*overflow-x:\s*auto;\s*\}/)

  assert.match(compactHeader, /\.sequence-topbar #studio-sequence-status\s*\{\s*display:\s*none;\s*\}/)

  assert.match(mobile, /\.sequence-topbar \.crumb,\s*\.sequence-topbar #studio-sequence-status\s*\{\s*display:\s*none;\s*\}/)
  assert.match(mobile, /\.sequence-workspace\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*overflow:\s*visible;/s)
  assert.match(mobile, /\.sequence-control-panel\s*\{[^}]*width:\s*100%;[^}]*height:\s*1036px;[^}]*min-height:\s*1036px;/s)
  assert.match(mobile, /\.sequence-stage\s*\{[^}]*min-height:\s*1036px;[^}]*grid-template-rows:\s*36px minmax\(896px, auto\) 104px;/s)
  assert.match(mobile, /\.sequence-stage-toolbar\s*\{\s*overflow:\s*hidden;\s*\}/)
  assert.match(mobile, /\.sequence-stage-phase\s*\{\s*display:\s*none;\s*\}/)
  assert.match(mobile, /#studio-sequence-live-status\s*\{[^}]*left:\s*122px;[^}]*right:\s*8px;[^}]*width:\s*auto;/s)
  assert.match(mobile, /data-sequence-phase="processing"[^}]*sequence-processing-panel[\s\S]*data-sequence-phase="local_error"[^}]*sequence-local-error-panel[^}]*\{[^}]*left:\s*20px;[^}]*width:\s*calc\(100% - 40px\);[^}]*transform:\s*none;/)
  assert.match(mobile, /\.sequence-processing-panel h2,[\s\S]*\.sequence-processing-recovery\s*\{\s*width:\s*100%;\s*\}/)
  assert.match(mobile, /\.sequence-error-panel h2,[\s\S]*\.sequence-error-recovery\s*\{\s*width:\s*100%;\s*\}/)
})

test('every visible or dynamic Sequence translation key exists in English and Chinese', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/sequenceView.js', 'utf8'),
  ])
  const sequence = sequenceHtml(html)
  const keys = new Set([
    ...[...sequence.matchAll(/data-studio-i18n(?:-[a-z-]+)?="(sequence\.[^"]+)"/g)]
      .map((match) => match[1]),
    ...[...view.matchAll(/['"](sequence\.[^'"]+)['"]/g)].map((match) => match[1]),
    ...SEQUENCE_PHASES
      .filter((phase) => phase !== 'processing')
      .map((phase) => `sequence.stagePhase.${phase}`),
    'sequence.stagePhase.processing.read',
    'sequence.stagePhase.processing.local_build',
    'sequence.stagePhase.processing.package',
    'sequence.stagePhase.package_error',
    'sequence.live.processing.read',
    'sequence.live.processing.local_build',
    'sequence.live.processing.package',
    'sequence.live.packageError',
  ])
  assert.ok(keys.size > 130, 'expected the complete nine-state Sequence translation surface')
  for (const key of keys) {
    assert.equal(typeof STUDIO_TRANSLATIONS.en[key], 'string', `missing EN key ${key}`)
    assert.equal(typeof STUDIO_TRANSLATIONS.zh[key], 'string', `missing ZH key ${key}`)
  }
})
