function node(documentRef, tag, className = '', text = '') {
  const value = documentRef.createElement(tag)
  if (className) value.className = className
  value.textContent = text
  return value
}

function spritePosition(frameIndex) {
  const column = frameIndex % 8
  const row = Math.floor(frameIndex / 8)
  return `${(column / 7) * 100}% ${(row / 7) * 100}%`
}

function renderUnavailable(documentRef, viewModel) {
  const wrap = node(documentRef, 'section', 'editor-repair-action-only')
  wrap.dataset.status = viewModel.status
  wrap.append(
    node(documentRef, 'h2', '', 'Three-atlas action repair'),
    node(documentRef, 'p', 'editor-repair-state-banner', viewModel.message || 'Action repair is unavailable.'),
  )
  return wrap
}

export function createRepairWorkbenchPanel({ root, announce = () => {} } = {}) {
  if (!root?.ownerDocument) throw new TypeError('action repair workbench root is required')
  const documentRef = root.ownerDocument
  let context = null
  let destroyed = false

  function render(viewModel = context?.viewModel?.()) {
    if (destroyed || !viewModel) return
    if (viewModel.status !== 'ready') {
      root.replaceChildren(renderUnavailable(documentRef, viewModel))
      return
    }

    const wrap = node(documentRef, 'section', 'editor-repair-action-only')
    wrap.dataset.status = viewModel.status
    const header = node(documentRef, 'header', 'editor-repair-action-header')
    const title = node(documentRef, 'div')
    title.append(
      node(documentRef, 'h2', '', 'Three-atlas action repair'),
      node(documentRef, 'p', '', 'Identity anchor + pose guide + empty output atlas · one reviewed provider call'),
    )
    const identity = node(
      documentRef,
      'output',
      'editor-repair-action-identity',
      `${viewModel.asset?.name ?? viewModel.asset?.id ?? '-'} · ${viewModel.revision?.id ?? '-'}`,
    )
    header.append(title, identity)

    const controls = node(documentRef, 'div', 'editor-repair-action-controls')
    const clipLabel = node(documentRef, 'label', 'editor-repair-action-clip')
    clipLabel.append(node(documentRef, 'span', '', 'Action clip'))
    const clip = node(documentRef, 'select')
    for (const [clipId] of Object.entries(viewModel.clips ?? {})) {
      const option = node(documentRef, 'option', '', clipId)
      option.value = clipId
      option.selected = clipId === viewModel.clipId
      clip.append(option)
    }
    clip.disabled = viewModel.busy
    clip.addEventListener('change', () => context?.selectClip(clip.value))
    clipLabel.append(clip)
    const selected = node(
      documentRef,
      'output',
      'editor-repair-action-selection',
      viewModel.batch.canPlan
        ? `${viewModel.batch.outputFrameCount} output frame(s) → ${viewModel.batch.sourceRegionCount} exact source slot(s) → 1 call`
        : 'Select at least one incorrect frame',
    )
    const clear = node(documentRef, 'button', 'secondary', 'Clear selection')
    clear.type = 'button'
    clear.disabled = viewModel.busy || !viewModel.selectedRegionKeys.length
    clear.addEventListener('click', () => context?.clearBatchRepairSelection())
    controls.append(clipLabel, selected, clear)

    const filmstrip = node(documentRef, 'div', 'editor-repair-action-filmstrip')
    filmstrip.setAttribute('role', 'list')
    filmstrip.setAttribute('aria-label', 'Exact action frames')
    const selectedKeys = new Set(viewModel.selectedRegionKeys)
    for (const frame of viewModel.frames) {
      const target = frame.target
      const item = node(documentRef, 'label', 'editor-repair-action-frame')
      item.setAttribute('role', 'listitem')
      if (!target) item.dataset.unmapped = 'true'
      const checkbox = node(documentRef, 'input')
      checkbox.type = 'checkbox'
      checkbox.checked = Boolean(target && selectedKeys.has(target.regionKey))
      checkbox.disabled = viewModel.busy || !target
      checkbox.dataset.batchRepairRegion = target?.regionKey ?? ''
      checkbox.setAttribute('aria-label', target
        ? `Frame ${frame.frameIndex + 1}, source slot ${target.regionKey}`
        : `Frame ${frame.frameIndex + 1}, unavailable`)
      checkbox.addEventListener('change', () => {
        context?.toggleBatchRepairRegion(target?.regionKey, checkbox.checked)
      })
      const preview = node(documentRef, 'span', 'editor-repair-action-frame-preview')
      if (viewModel.sourceSheetUrl) {
        preview.style.backgroundImage = `url("${viewModel.sourceSheetUrl}")`
        preview.style.backgroundSize = '800% 800%'
        preview.style.backgroundPosition = spritePosition(frame.frameIndex)
      }
      const caption = node(
        documentRef,
        'span',
        'editor-repair-action-frame-caption',
        target ? `#${frame.frameIndex + 1} · ${target.regionKey}` : `#${frame.frameIndex + 1} · unavailable`,
      )
      item.append(checkbox, preview, caption)
      filmstrip.append(item)
    }
    if (!viewModel.frames.length) {
      filmstrip.append(node(documentRef, 'p', 'editor-empty-line', 'This action clip has no frames.'))
    }

    const workflow = node(documentRef, 'section', 'editor-repair-ai-action')
    workflow.append(node(documentRef, 'h3', '', 'Review and run the sealed three-atlas workflow'))
    const workflowBody = node(documentRef, 'div', 'editor-repair-ai-action-body')
    workflow.append(workflowBody)

    wrap.append(header, node(documentRef, 'p', 'editor-repair-action-guidance', viewModel.message), controls, filmstrip, workflow)
    root.replaceChildren(wrap)
    context?.renderAiAction(workflowBody)
    announce(viewModel.message)
  }

  function open(nextContext) {
    context = nextContext
    render()
  }

  function close() {
    context = null
  }

  function destroy() {
    destroyed = true
    context = null
  }

  return Object.freeze({ close, destroy, open, render })
}
