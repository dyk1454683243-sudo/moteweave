import { assertPixelStructure } from '../../editor-project/pixelStructure.js'
import { linkedCopyEnabled, pixelLinkScope } from '../../editor-project/pixelLinks.js'

const TAG_DIR_SYMBOL = Object.freeze({ forward: '→', reverse: '←', pingpong: '↔' })

// This controller owns only transient selection/playback. All edits are sent
// through the existing project writer and versioned history in the session.
export function bindDocumentTimeline({ root, session, command, compose, renderCanvas, renderPlaybackState = renderCanvas, confirm, closeConfirm, status, historyPending, promoteReference = null, onScopeChange = null }) {
  const mutate = command
  command = (...args) => { if (!session.documentCandidate) return mutate(...args) }
  const readOnly = () => Boolean(session.documentCandidate)
  const state = new Map(), activeTags = new Map(), frameScopes = new Map(), view = session.view
  const frames = root.querySelector('#vnext-frame-cols'), layers = root.querySelector('#vnext-layer-col')
  const tagsBar = root.querySelector('#vnext-timeline-tags')
  const templateNode = layers?.querySelector('.vnext-layer-row')
  // Partial hosts retain the legacy read-only timeline until the full control
  // surface is mounted (also used by the existing lightweight session tests).
  if (!frames || !templateNode?.cloneNode) return null
  const template = templateNode.cloneNode(true)
  const nav = [...root.querySelectorAll('.vnext-play-nav button')]
  const addLayer = layers.querySelector('[aria-label="Add layer"]')
  const loopButton = root.querySelector('[aria-label="Loop on"]')
  const menu = root.querySelector('#vnext-timeline-menu')
  let menuOwner = null, drag = null
  let timer = null, playing = false, loop = true, pingPongForward = true, serial = 0, activeDocument = null, renderKey = '', playEpoch = 0, playFrame = null, editPreview = null
  const frameNodes = new Map()
  let headFrame = null
  const current = () => session.documentCandidate?.canvas.id === view.selectedId ? session.documentCandidate.manifest : session.documents.get(session.project?.canvases?.[view.selectedId]?.document_id)
  const blocked = () => Boolean(session.frameLoading || session.manualGesture || (session.manualWrite && session.manualWrite !== session.documentCandidate?.guard) || (session.documentCandidate && session.documentCandidate.phase !== 'review') || session.pendingImport || session.pendingSave || session.historyBusy || session.nameEdit || session.pixelCopyPending || historyPending()
    || session.openInFlight?.()) // another project is opening or being created: layers and frames are read-only
  const context = () => ({ manifest: current(), project: session.project, revision: session.project?.revision, epoch: session.api.openEpoch.current, canvasId: view.selectedId })
  const isCurrent = owner => owner && owner.manifest === current() && owner.project === session.project && owner.revision === session.project?.revision && owner.epoch === session.api.openEpoch.current && owner.canvasId === view.selectedId && !blocked()
  function activeTag(manifest) {
    if (!manifest || !Array.isArray(manifest.tags) || !manifest.tags.length) return null
    const id = activeTags.get(manifest.document_id)
    if (!id) return null
    const tag = manifest.tags.find(entry => entry.id === id) || null
    if (!tag) activeTags.delete(manifest.document_id)
    return tag
  }
  function setActiveTag(manifest, tagId) {
    if (!manifest) return
    stop()
    if (!tagId) activeTags.delete(manifest.document_id)
    else activeTags.set(manifest.document_id, tagId)
    renderKey = ''
    render()
  }
  function editableFrames(manifest = current()) {
    if (!manifest || !Array.isArray(manifest.frame_order) || manifest.frame_order.length <= 1) return null
    const raw = frameScopes.get(manifest.document_id)
    if (!raw || !raw.size) return null
    const kept = manifest.frame_order.filter(frameId => raw.has(frameId))
    if (!kept.length || kept.length >= manifest.frame_order.length) {
      frameScopes.delete(manifest.document_id)
      return null
    }
    return kept
  }
  function lockedFrames(manifest = current()) {
    const editable = editableFrames(manifest)
    if (!editable || !manifest?.frame_order) return []
    return manifest.frame_order.filter(frameId => !editable.includes(frameId))
  }
  function setEditableFrames(manifest, frameIds) {
    if (!manifest || !Array.isArray(manifest.frame_order)) return null
    if (!frameIds || !Array.isArray(frameIds) || !frameIds.length || manifest.frame_order.length <= 1) {
      frameScopes.delete(manifest.document_id)
    } else {
      const valid = manifest.frame_order.filter(frameId => frameIds.includes(frameId))
      if (!valid.length || valid.length >= manifest.frame_order.length) {
        frameScopes.delete(manifest.document_id)
      } else {
        frameScopes.set(manifest.document_id, new Set(valid))
      }
    }
    renderKey = ''
    render()
    onScopeChange?.()
    return editableFrames(manifest)
  }
  function toggleFrameInScope(manifest, frameId) {
    if (!manifest || !manifest.frame_order?.includes(frameId) || manifest.frame_order.length <= 1) return null
    const currentScope = editableFrames(manifest)
    if (!currentScope) {
      return setEditableFrames(manifest, [frameId])
    }
    if (currentScope.includes(frameId)) {
      if (currentScope.length <= 1) {
        status?.('Keep at least one editable frame in scope, or choose Unlock all frames.')
        return currentScope
      }
      const remaining = currentScope.filter(id => id !== frameId)
      return setEditableFrames(manifest, remaining)
    }
    return setEditableFrames(manifest, [...currentScope, frameId])
  }
  function closeMenu(focus = false) {
    const old = menuOwner; menuOwner = null
    if (menu) { menu.hidden = true; menu.replaceChildren() }
    old?.anchor?.setAttribute('aria-expanded', 'false')
    if (focus) old?.anchor?.focus()
  }
  function clearDrag() {
    drag = null
    root.querySelectorAll('.is-drop-before, .is-drop-after').forEach(n => n.classList.remove('is-drop-before', 'is-drop-after'))
  }
  function reason(kind, id, removing = false) {
    const m = current(), order = m?.[`${kind}_order`]
    if (!order?.includes(id) || blocked() || readOnly()) return 'Finish the current edit or project change first.'
    if (m.anchors?.length) return 'Documents with anchors are not supported for this action yet.'
    if (kind === 'layer' && m.layers[id].locked) return 'Unlock this layer first.'
    if (removing && order.length === 1) return `Keep at least one ${kind}.`
    if (removing && kind === 'frame' && Object.values(m.layers).some(l => l.locked)) return 'Unlock all layers before deleting a frame.'
    return ''
  }
  function copyReason(m) {
    if (m.frame_order.length >= 256) return 'The document already has 256 frames.'
    if (m.layer_order.some(id => m.layers[id].locked && linkedCopyEnabled(m, id))) return 'Unlock linked-copy layers before copying a frame.'
    return ''
  }
  function remove(kind, id) {
    const why = reason(kind, id, true); if (why) { status(why); return }
    stop(); closeMenu()
    const owner = context(), m = owner.manifest
    const label = kind === 'frame' ? `frame ${m.frame_order.indexOf(id) + 1}` : `layer “${m.layers[id].name}”`
    confirm({ title: `Delete ${label}?`, body: kind === 'frame'
      ? 'Remove this frame and its contents on every layer. You can undo this change.'
      : 'Remove this layer and its contents in every frame. You can undo this change.',
    primary: `Delete ${kind}`, secondary: 'Cancel', onSecondary: closeConfirm,
    onDismiss: () => {
      dialog.removeEventListener('keydown', onKey); dialog.removeEventListener('keyup', onKeyUp)
      root.querySelector(`[data-structure-kind="${kind}"][data-structure-id="${id}"]`)?.focus()
    },
    onPrimary: () => { closeConfirm(); if (!isCurrent(owner)) { status('The selected document changed. Try again.', { error: true }); return }
      const error = reason(kind, id, true); if (error) { status(error); return }
      command({ type: `delete-${kind}`, [`${kind}_id`]: id })
    } })
    const dialog = root.querySelector('#vnext-confirm-dialog')
    const cancel = root.querySelector('#vnext-confirm-secondary'), primary = root.querySelector('#vnext-confirm-primary')
    const onKeyUp = e => { if (e.code === 'Space') e.stopPropagation() }
    const onKey = e => {
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); closeConfirm() }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === cancel ? primary : cancel).focus() }
    }
    dialog.addEventListener('keydown', onKey); dialog.addEventListener('keyup', onKeyUp)
    cancel.focus()
  }
  function move(kind, id, index, owner = context()) {
    if (!isCurrent(owner) || reason(kind, id)) return
    const order = owner.manifest[`${kind}_order`]
    if (index < 0 || index >= order.length || index === order.indexOf(id)) return
    stop(); closeMenu(); command({ type: `move-${kind}`, [`${kind}_id`]: id, index })
  }
  function openTagDialog(existingTag = null, defaultFrameId = null) {
    if (blocked() || readOnly()) return
    stop(); closeMenu()
    const owner = context(), m = owner.manifest
    if (!m) return
    if (!existingTag && (m.tags?.length || 0) >= 32) { status('This document already has 32 animation tags.'); return }
    const selected = target(m)
    const initialFrom = existingTag?.from_frame_id || defaultFrameId || selected?.frame_id || m.frame_order[0]
    const initialTo = existingTag?.to_frame_id || defaultFrameId || selected?.frame_id || m.frame_order[0]
    const initialDir = existingTag?.direction || 'forward'
    const initialName = existingTag?.name || `Tag ${(m.tags?.length || 0) + 1}`

    confirm({
      title: existingTag ? `Edit tag “${existingTag.name}”` : 'New animation tag',
      body: 'Animation tags name a frame range and playback direction, and export in sprite sheet JSON metadata.',
      primary: existingTag ? 'Save tag' : 'Add tag',
      secondary: 'Cancel',
      onSecondary: closeConfirm,
      onPrimary: async () => {
        if (!isCurrent(owner)) { closeConfirm(); status('The selected document changed. Try again.', { error: true }); return }
        const name = nameInput.value.trim()
        if (!name) { nameInput.reportValidity?.(); status('Enter a tag name.', { error: true }); return }
        let fromIdx = m.frame_order.indexOf(fromSelect.value)
        let toIdx = m.frame_order.indexOf(toSelect.value)
        if (fromIdx < 0 || toIdx < 0) { status('Choose valid start and end frames.', { error: true }); return }
        if (fromIdx > toIdx) [fromIdx, toIdx] = [toIdx, fromIdx]
        const from_frame_id = m.frame_order[fromIdx]
        const to_frame_id = m.frame_order[toIdx]
        const direction = ['forward', 'reverse', 'pingpong'].includes(dirSelect.value) ? dirSelect.value : 'forward'
        closeConfirm()
        const cmd = existingTag
          ? { type: 'update-tag', tag_id: existingTag.id, name, from_frame_id, to_frame_id, direction }
          : { type: 'add-tag', name, from_frame_id, to_frame_id, direction }
        const res = await command(cmd)
        if (res?.ok && !existingTag && res.document?.tags?.length) {
          const added = res.document.tags.at(-1)
          if (added?.id) activeTags.set(res.document.document_id, added.id)
          renderKey = ''
          render()
        }
      },
    })
    const host = root.querySelector('#vnext-confirm-details')
    if (!host) return
    const form = document.createElement('div')
    form.className = 'vnext-tag-dialog-fields'

    const makeField = (labelText, control) => {
      const label = document.createElement('label')
      label.className = 'vnext-blank-field'
      const span = document.createElement('span')
      span.textContent = labelText
      label.append(span, control)
      return label
    }

    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.maxLength = 64
    nameInput.required = true
    nameInput.value = initialName
    nameInput.dataset.tagField = 'name'
    nameInput.setAttribute('aria-label', 'Tag name')

    const makeFrameSelect = (selectedId, fieldName, ariaLabel) => {
      const selectEl = document.createElement('select')
      selectEl.dataset.tagField = fieldName
      selectEl.setAttribute('aria-label', ariaLabel)
      m.frame_order.forEach((fid, idx) => {
        const opt = document.createElement('option')
        opt.value = fid
        opt.textContent = `Frame ${idx + 1}`
        if (fid === selectedId) opt.selected = true
        selectEl.append(opt)
      })
      return selectEl
    }

    const fromSelect = makeFrameSelect(initialFrom, 'from', 'Start frame')
    const toSelect = makeFrameSelect(initialTo, 'to', 'End frame')

    const dirSelect = document.createElement('select')
    dirSelect.dataset.tagField = 'direction'
    dirSelect.setAttribute('aria-label', 'Playback direction')
    for (const [val, text] of [['forward', 'Forward →'], ['reverse', 'Reverse ←'], ['pingpong', 'Ping-pong ↔']]) {
      const opt = document.createElement('option')
      opt.value = val
      opt.textContent = text
      if (val === initialDir) opt.selected = true
      dirSelect.append(opt)
    }

    const rangeRow = document.createElement('div')
    rangeRow.className = 'vnext-blank-dimensions'
    rangeRow.append(makeField('From', fromSelect), makeField('To', toSelect), makeField('Direction', dirSelect))
    form.append(makeField('Tag name', nameInput), rangeRow)

    if (existingTag) {
      const delRow = document.createElement('div')
      delRow.className = 'vnext-prop-actions'
      const delBtn = document.createElement('button')
      delBtn.type = 'button'
      delBtn.className = 'vnext-dialog-btn is-secondary'
      delBtn.dataset.tagAction = 'delete'
      delBtn.textContent = 'Delete tag'
      delBtn.onclick = async () => {
        if (!isCurrent(owner)) { closeConfirm(); return }
        closeConfirm()
        if (activeTags.get(m.document_id) === existingTag.id) activeTags.delete(m.document_id)
        await command({ type: 'delete-tag', tag_id: existingTag.id })
      }
      delRow.append(delBtn)
      form.append(delRow)
    }

    host.replaceChildren(form)
    host.hidden = false
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); root.querySelector('#vnext-confirm-primary')?.click() }
    })
    nameInput.focus?.(); nameInput.select?.()
  }
  function requestLinkCels(owner, layerId, sourceFrameId, targetFrameId) {
    if (!isCurrent(owner)) return
    const m = owner.manifest, layer = m.layers[layerId]
    if (!layer || layer.locked) { status('Unlock this layer before linking cels.'); return }
    let srcFrame = sourceFrameId, dstFrame = targetFrameId
    let srcCel = Object.values(m.cels).find(c => c.layer_id === layerId && c.frame_id === srcFrame)
    let dstCel = Object.values(m.cels).find(c => c.layer_id === layerId && c.frame_id === dstFrame)
    if (!srcCel || !dstCel) return
    // If source is empty and destination has pixels, keep the non-empty pixels without losing artwork.
    if (!srcCel.block && dstCel.block) {
      ;[srcFrame, dstFrame] = [dstFrame, srcFrame]
      ;[srcCel, dstCel] = [dstCel, srcCel]
    }
    const sameBlock = (srcCel.block?.sha256 || null) === (dstCel.block?.sha256 || null)
    if (dstCel.block && !sameBlock) {
      const srcNum = m.frame_order.indexOf(srcFrame) + 1
      const dstNum = m.frame_order.indexOf(dstFrame) + 1
      confirm({
        title: `Link cels on “${layer.name}”?`,
        body: `Frame ${dstNum} has different pixels from Frame ${srcNum}. Linking replaces Frame ${dstNum}’s cel with Frame ${srcNum}’s pixels so both frames share one linked cel. Undo restores the previous pixels.`,
        primary: 'Link & replace cel',
        secondary: 'Cancel',
        onSecondary: closeConfirm,
        onPrimary: () => {
          closeConfirm()
          if (isCurrent(owner)) command({ type: 'link-cels', layer_id: layerId, source_frame_id: srcFrame, target_frame_id: dstFrame })
        },
      })
      return
    }
    command({ type: 'link-cels', layer_id: layerId, source_frame_id: srcFrame, target_frame_id: dstFrame })
  }
  function openCelMenu(cel, frameId, layerId, anchor, x, y) {
    if (!menu || blocked() || readOnly()) return
    stop(); closeMenu()
    const owner = context(), m = owner.manifest
    const frameIndex = m?.frame_order?.indexOf(frameId) ?? -1
    const layer = m?.layers?.[layerId]
    if (frameIndex < 0 || !layer) return
    menuOwner = { ...owner, anchor }; anchor.setAttribute('aria-expanded', 'true')
    menu.setAttribute('aria-label', `${layer.name}, frame ${frameIndex + 1} cel actions`)
    const lockedReason = layer.locked ? 'Unlock this layer first.' : ''
    const linkScope = pixelLinkScope(m, cel.id)
    const isLinked = Boolean(linkScope && linkScope.cel_ids.length > 1)
    const items = []
    if (frameIndex > 0) {
      const prevFrameId = m.frame_order[frameIndex - 1]
      items.push([
        `Link with frame ${frameIndex} (Keep frame ${frameIndex})`,
        () => requestLinkCels(owner, layerId, prevFrameId, frameId),
        lockedReason,
      ])
    }
    if (frameIndex < m.frame_order.length - 1) {
      const nextFrameId = m.frame_order[frameIndex + 1]
      items.push([
        `Link with frame ${frameIndex + 2} (Keep frame ${frameIndex + 1})`,
        () => requestLinkCels(owner, layerId, frameId, nextFrameId),
        lockedReason,
      ])
    }
    if (m.frame_order.length <= 1) {
      items.push(['Link cel…', () => {}, 'Add at least two frames to link cels.'])
    }
    items.push([
      'Unlink cel',
      () => command({ type: 'unlink-cel', layer_id: layerId, frame_id: frameId }),
      lockedReason || (!isLinked ? 'This cel is not linked to another frame.' : ''),
    ])
    if (promoteReference) {
      const refRecords = Array.isArray(session?.project?.references) ? session.project.references.length : 0
      items.push([
        'Save cel to project references',
        () => promoteReference({ frameId, layerId, sourceKind: 'cel' }),
        !cel.block
          ? 'Add pixels to this cel before saving it as a reference.'
          : session?.referencePending?.()
            ? 'Resolve the pending reference update before saving another reference.'
            : refRecords >= 64
              ? 'Project reference limit reached (64/64 records). Revoked references remain in project history and do not free slots.'
              : '',
      ])
    }
    for (const [label, action, why] of items) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'vnext-menu-row'; button.textContent = label
      button.setAttribute('role', 'menuitem'); button.disabled = Boolean(why); button.title = why || label
      button.onclick = e => { e.stopPropagation(); const live = isCurrent(owner); closeMenu(); if (live) action() }
      menu.append(button)
    }
    const rect = anchor.getBoundingClientRect(); menu.hidden = false
    menu.style.left = `${Math.max(8, Math.min(x ?? rect.left, window.innerWidth - 228))}px`
    menu.style.top = `${Math.max(8, Math.min(y ?? rect.bottom, window.innerHeight - menu.offsetHeight - 8))}px`
    menu.querySelector('button:not(:disabled)')?.focus()
  }
  function openMenu(kind, id, anchor, x, y) {
    if (!menu || blocked() || readOnly()) return
    stop(); closeMenu()
    const owner = context(), m = owner.manifest, order = m[`${kind}_order`], index = order.indexOf(id)
    if (index < 0) return
    menuOwner = { ...owner, anchor }; anchor.setAttribute('aria-expanded', 'true')
    menu.setAttribute('aria-label', kind === 'frame' ? `Frame ${index + 1} actions` : `Layer ${m.layers[id].name} actions`)
    const scopeIds = kind === 'frame' ? editableFrames(m) : null
    const inScope = kind === 'frame' && scopeIds ? scopeIds.includes(id) : false
    const items = kind === 'frame'
      ? [
        ...(m.frame_order.length > 1
          ? [
            [`Revise only frame ${index + 1} (lock others)`, () => setEditableFrames(m, [id]), scopeIds && scopeIds.length === 1 && scopeIds[0] === id ? 'Already revising only this frame.' : ''],
            [
              scopeIds ? (inScope ? `Exclude frame ${index + 1} from revision scope` : `Include frame ${index + 1} in revision scope`) : `Add frame ${index + 1} to revision scope`,
              () => toggleFrameInScope(m, id),
              scopeIds && inScope && scopeIds.length <= 1
                ? 'Keep at least one editable frame in scope, or choose Unlock all frames.'
                : '',
            ],
            ...(scopeIds ? [['Unlock all frames (revise all)', () => setEditableFrames(m, null), '']] : []),
          ]
          : []),
        ...(promoteReference ? [[
          'Save frame to project references',
          () => promoteReference({ frameId: id, sourceKind: 'frame_composite' }),
          session?.referencePending?.()
            ? 'Resolve the pending reference update before saving another reference.'
            : (session?.project?.references?.length || 0) >= 64
              ? 'Project reference limit reached (64/64 records). Revoked references remain in project history and do not free slots.'
              : '',
        ]] : []),
        ['Copy frame', () => copyFrame(id), copyReason(m)],
        ['Add animation tag…', () => openTagDialog(null, id), (m.tags?.length || 0) >= 32 ? 'Maximum 32 tags.' : ''],
        ['Move earlier', () => move(kind, id, index - 1, owner), reason(kind, id) || (index === 0 ? 'Already the first frame.' : '')],
        ['Move later', () => move(kind, id, index + 1, owner), reason(kind, id) || (index === order.length - 1 ? 'Already the last frame.' : '')]]
      : [['Rename layer', () => editDialog('Rename layer', m.layers[id].name, name => ({ type: 'rename-layer', layer_id: id, name })), ''],
        ['Move up', () => move(kind, id, index - 1, owner), reason(kind, id) || (index === 0 ? 'Already the top layer.' : '')],
        ['Move down', () => move(kind, id, index + 1, owner), reason(kind, id) || (index === order.length - 1 ? 'Already the bottom layer.' : '')]]
    items.push([`Delete ${kind}`, () => remove(kind, id), reason(kind, id, true)])
    for (const [label, action, why] of items) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'vnext-menu-row'; button.textContent = label
      button.setAttribute('role', 'menuitem'); button.disabled = Boolean(why); button.title = why || label
      button.onclick = e => { e.stopPropagation(); const live = isCurrent(owner); closeMenu(); if (live) action() }
      menu.append(button)
    }
    const rect = anchor.getBoundingClientRect(); menu.hidden = false
    menu.style.left = `${Math.max(8, Math.min(x ?? rect.left, window.innerWidth - 228))}px`
    menu.style.top = `${Math.max(8, Math.min(y ?? rect.bottom, window.innerHeight - menu.offsetHeight - 8))}px`
    menu.querySelector('button:not(:disabled)')?.focus()
  }
  function bindStructureTarget(node, kind, id) {
    node.dataset.structureKind = kind; node.dataset.structureId = id
    node.draggable = !reason(kind, id)
    node.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); openMenu(kind, id, node, e.clientX, e.clientY) }
    node.onkeydown = e => {
      if (e.isComposing || e.target !== node || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(kind, id) }
      else if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); openMenu(kind, id, node) }
    }
    node.ondragstart = e => {
      if (reason(kind, id)) { e.preventDefault(); return }
      stop(); closeMenu(); drag = { ...context(), kind, id }
      e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id)
    }
    node.ondragover = e => {
      if (!isCurrent(drag) || drag.kind !== kind) return
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'
      root.querySelectorAll('.is-drop-before, .is-drop-after').forEach(n => n.classList.remove('is-drop-before', 'is-drop-after'))
      const r = node.getBoundingClientRect(), after = kind === 'frame' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
      node.classList.add(after ? 'is-drop-after' : 'is-drop-before')
    }
    node.ondrop = e => {
      const owner = drag
      if (!isCurrent(owner) || owner.kind !== kind) { clearDrag(); return }
      e.preventDefault(); e.stopPropagation()
      const order = owner.manifest[`${kind}_order`], from = order.indexOf(owner.id), to = order.indexOf(id)
      const r = node.getBoundingClientRect(), after = kind === 'frame' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
      const slot = to + Number(after), index = slot - Number(from < slot)
      clearDrag(); move(kind, owner.id, index, owner)
    }
    node.ondragend = clearDrag
  }
  menu?.addEventListener('keydown', e => {
    e.stopPropagation() // Space/Undo belong to this menu, not the canvas.
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')], at = buttons.indexOf(document.activeElement)
    if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); e.stopPropagation(); closeMenu(true) }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus() }
  })
  menu?.addEventListener('keyup', e => { if (e.code === 'Space') e.stopPropagation() })
  document.addEventListener('pointerdown', e => { if (menuOwner && !menu.contains(e.target) && !menuOwner.anchor.contains(e.target)) closeMenu() })
  root.querySelector('.vnext-grid')?.addEventListener('scroll', () => closeMenu(), { passive: true })
  window.addEventListener('resize', () => { closeMenu(); clearDrag() })
  async function selectFrom(node, frameId, layerId) {
    const { structureKind: kind, structureId: id } = node.dataset
    await select(frameId, layerId)
    // Rendering replaces the timeline nodes. Keep keyboard ownership on the
    // requested header/name, but never steal focus from a dialog or text input.
    const active = document.activeElement
    if (active === document.body || active === node || frames.contains(active) || layers.contains(active)) {
      root.querySelector(`[data-structure-kind="${kind}"][data-structure-id="${id}"]`)?.focus()
    }
  }
  function target(manifest) {
    if (!manifest) return null
    const old = state.get(`${manifest.document_id}:${session.documentCandidate?.manifest === manifest ? session.documentCandidate.id : 'saved'}`)
    const frame_id = manifest.frames[old?.frame_id] ? old.frame_id : manifest.frame_order[0]
    const layer_id = manifest.layers[old?.layer_id] ? old.layer_id : manifest.layer_order[0]
    const cel = Object.values(manifest.cels).find(c => c.frame_id === frame_id && c.layer_id === layer_id)
    return cel ? { frame_id, layer_id, cel_id: cel.id } : null
  }
  function setTarget(manifest, next) { if (manifest && next) state.set(`${manifest.document_id}:${session.documentCandidate?.manifest === manifest ? session.documentCandidate.id : 'saved'}`, { ...next }) }
  function renderPlayButton() {
    nav[2]?.setAttribute('aria-pressed', String(playing))
    nav[2]?.querySelector('use')?.setAttribute('href', playing ? '#vnext-icon-pause' : '#vnext-icon-play')
  }
  function stop() {
    const wasPlaying = playing
    playing = false; playFrame = null; playEpoch++; clearTimeout(timer); timer = null; serial++; session.frameLoading = false
    renderPlayButton()
    if (editPreview && session.project?.id === editPreview.projectId && current() === editPreview.manifest) {
      const canvas = session.documentCandidate?.canvas.id === editPreview.canvasId ? session.documentCandidate.canvas : view.canvases.find(c => c.id === editPreview.canvasId)
      if (canvas) canvas.preview = editPreview.preview
    }
    editPreview = null
    if (wasPlaying) queueMicrotask(renderCanvas)
  }
  async function select(frameId, layerId, playback = false) {
    if (blocked()) { stop(); return }
    if (!playback) stop()
    const manifest = current(), project = session.project?.id, canvasId = view.selectedId
    if (!manifest) return
    const before = target(manifest)
    if (playback) playFrame = frameId
    else session.frameLoading = true
    const token = ++serial
    const live = () => token === serial && project === session.project?.id && canvasId === view.selectedId && current() === manifest
    if (playback) renderPlaybackState()
    else renderCanvas()
    try {
      const preview = await compose(manifest, frameId)
      if (!live()) return
      if (!playback) {
        session.frameLoading = false
        setTarget(manifest, { frame_id: frameId, layer_id: layerId })
        if (before?.frame_id !== frameId || before?.layer_id !== layerId) session.pixelSelection = null
      }
      const canvas = session.documentCandidate?.canvas.id === canvasId ? session.documentCandidate.canvas : view.canvases.find(c => c.id === canvasId)
      if (canvas) canvas.preview = preview
      renderCanvas()
    } catch (error) { if (live()) { stop(); renderCanvas(); status(error.message, { error: true }) } }
    finally {
      // Reopening the same project can replace the manifest without changing
      // document identity. Release only this request's gate, not a newer load.
      if (!playback && token === serial && session.frameLoading) { session.frameLoading = false; renderCanvas() }
    }
  }
  async function advance(epoch) {
    const manifest = current()
    if (epoch !== playEpoch) return
    if (!playing || blocked() || !manifest) return stop()
    const selected = target(manifest), index = manifest.frame_order.indexOf(playFrame || selected.frame_id)
    const tag = activeTag(manifest)
    let nextIndex
    if (tag) {
      const fromIdx = manifest.frame_order.indexOf(tag.from_frame_id)
      const toIdx = manifest.frame_order.indexOf(tag.to_frame_id)
      if (fromIdx === toIdx) {
        if (!loop) return stop()
        nextIndex = fromIdx
      } else if (tag.direction === 'reverse') {
        if (index < fromIdx || index > toIdx) nextIndex = toIdx
        else if (index <= fromIdx) {
          if (!loop) return stop()
          nextIndex = toIdx
        } else nextIndex = index - 1
      } else if (tag.direction === 'pingpong') {
        if (index < fromIdx || index > toIdx) {
          pingPongForward = true
          nextIndex = fromIdx
        } else if (pingPongForward) {
          if (index >= toIdx) {
            pingPongForward = false
            nextIndex = Math.max(fromIdx, index - 1)
          } else nextIndex = index + 1
        } else if (index <= fromIdx) {
          if (!loop) return stop()
          pingPongForward = true
          nextIndex = Math.min(toIdx, index + 1)
        } else {
          nextIndex = index - 1
        }
      } else {
        if (index < fromIdx || index > toIdx) nextIndex = fromIdx
        else if (index >= toIdx) {
          if (!loop) return stop()
          nextIndex = fromIdx
        } else nextIndex = index + 1
      }
    } else {
      if (index === manifest.frame_order.length - 1 && !loop) return stop()
      nextIndex = (index + 1) % manifest.frame_order.length
    }
    await select(manifest.frame_order[nextIndex], selected.layer_id, true)
    if (epoch === playEpoch && playing && current() === manifest) schedule(epoch)
  }
  function schedule(epoch = playEpoch) {
    if (!playing || epoch !== playEpoch) return
    const manifest = current(), selected = target(manifest)
    // Legacy zero durations remain unchanged on disk; a 1ms floor keeps the
    // read-only player finite without rewriting old metadata.
    clearTimeout(timer)
    timer = setTimeout(() => advance(epoch), Math.max(1, manifest.frames[playFrame || selected.frame_id].duration_ms))
  }
  function editDialog(title, value, makeCommand, numeric = false) {
    if (blocked() || readOnly()) return
    stop()
    const manifest = current(), projectId = session.project?.id, canvasId = view.selectedId, revision = session.project?.revision
    confirm({ title, body: '', primary: 'Save', secondary: 'Cancel', onSecondary: closeConfirm,
      onPrimary: async () => {
        if (current() !== manifest || session.project?.id !== projectId || view.selectedId !== canvasId || session.project?.revision !== revision) { closeConfirm(); status('The selected document changed. Try again.', { error: true }); return }
        if (!input.checkValidity() || (!numeric && !input.value.trim())) { input.reportValidity(); return }
        const next = makeCommand(numeric ? Number(input.value) : input.value.trim())
        closeConfirm(); await command(next)
      } })
    const input = document.createElement('input'); input.className = 'vnext-structure-input'
    input.type = numeric ? 'number' : 'text'; input.value = String(value); input.required = true
    input.setAttribute('aria-label', title)
    if (numeric) { input.min = '1'; input.max = '60000'; input.step = '1' } else input.maxLength = 120
    const host = root.querySelector('#vnext-confirm-details'); host.replaceChildren(input); host.hidden = false
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); root.querySelector('#vnext-confirm-primary').click() } })
    input.focus(); input.select()
  }
  function copyFrame(frameId) {
    if (blocked() || readOnly()) return
    stop(); const manifest = current(), canvasId = view.selectedId, revision = session.project?.revision
    const why = copyReason(manifest); if (why) { status(why); return }
    const linked = manifest.layer_order.filter(id => linkedCopyEnabled(manifest, id)).map(id => manifest.layers[id].name)
    confirm({ title: 'Copy frame', body: linked.length
      ? 'Append a copy. Editing a linked cel changes its group. Other layers are copied independently. Frame duration stays unchanged.'
      : 'Append an independent copy of this frame. The source frame and its duration stay unchanged.', primary: 'Copy frame', secondary: 'Cancel', onSecondary: closeConfirm,
      onPrimary: () => { closeConfirm(); if (current() === manifest && view.selectedId === canvasId && session.project?.revision === revision) command({ type: 'copy-frame', frame_id: frameId }) } })
    if (linked.length) {
      const details = root.querySelector('#vnext-confirm-details'), names = document.createElement('p')
      names.className = 'vnext-linked-edit-scope'; names.textContent = `Linked layers: ${linked.join(', ')}`
      details.replaceChildren(names); details.hidden = false
    }
  }
  function renderTagsBar(manifest, disabled) {
    if (!tagsBar) return
    tagsBar.replaceChildren()
    if (!manifest) { tagsBar.hidden = true; return }
    tagsBar.hidden = false
    const currentTag = activeTag(manifest)
    const tags = manifest.tags || []
    if (tags.length > 0) {
      const allChip = document.createElement('button')
      allChip.type = 'button'
      allChip.className = `vnext-tag-chip${!currentTag ? ' is-selected' : ''}`
      allChip.dataset.timelineTag = 'all'
      allChip.disabled = disabled
      allChip.setAttribute('aria-pressed', String(!currentTag))
      allChip.textContent = 'All frames'
      allChip.title = 'Play all frames in the timeline'
      allChip.onclick = () => setActiveTag(manifest, null)
      tagsBar.append(allChip)
    }
    for (const tag of tags) {
      const fromIdx = manifest.frame_order.indexOf(tag.from_frame_id) + 1
      const toIdx = manifest.frame_order.indexOf(tag.to_frame_id) + 1
      const rangeText = fromIdx === toIdx ? `F${fromIdx}` : `F${fromIdx}–${toIdx}`
      const dirSym = TAG_DIR_SYMBOL[tag.direction] || '→'
      const isSelected = currentTag?.id === tag.id
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = `vnext-tag-chip${isSelected ? ' is-selected' : ''}`
      chip.dataset.timelineTag = tag.id
      chip.disabled = disabled
      chip.setAttribute('aria-pressed', String(isSelected))
      chip.textContent = `${tag.name} · ${rangeText} ${dirSym}`
      chip.title = `Tag “${tag.name}” (${rangeText}, ${tag.direction}) · click to filter playback · double-click or right-click to edit`
      chip.onclick = () => {
        if (isSelected) setActiveTag(manifest, null)
        else {
          setActiveTag(manifest, tag.id)
          const sel = target(manifest)
          const startFrame = tag.direction === 'reverse' ? tag.to_frame_id : tag.from_frame_id
          if (sel && sel.frame_id !== startFrame) void select(startFrame, sel.layer_id)
        }
      }
      chip.ondblclick = e => { e.preventDefault(); e.stopPropagation(); openTagDialog(tag) }
      chip.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); openTagDialog(tag) }
      tagsBar.append(chip)
    }
    const addBtn = document.createElement('button')
    addBtn.type = 'button'
    addBtn.className = 'vnext-tag-chip is-add vnext-tag-add'
    addBtn.dataset.timelineAddTag = 'true'
    addBtn.disabled = disabled || readOnly() || tags.length >= 32
    addBtn.textContent = '+ Tag'
    addBtn.title = tags.length >= 32 ? 'Maximum 32 animation tags' : 'Create an animation tag for a frame range'
    addBtn.onclick = () => openTagDialog(null)
    tagsBar.append(addBtn)
    if (manifest.frame_order.length > 1) {
      const scopeIds = editableFrames(manifest)
      if (scopeIds) {
        const editLabels = scopeIds.map(id => `F${manifest.frame_order.indexOf(id) + 1}`)
        const locked = lockedFrames(manifest).map(id => `F${manifest.frame_order.indexOf(id) + 1}`)
        const editSummary = editLabels.length <= 3 ? editLabels.join(', ') : `${editLabels.length} frames`
        const lockSummary = locked.length <= 3 ? locked.join(', ') : `${locked.length} frames`
        const scopeChip = document.createElement('button')
        scopeChip.type = 'button'
        scopeChip.disabled = disabled || readOnly()
        scopeChip.className = 'vnext-tag-chip vnext-scope-chip is-selected'
        scopeChip.dataset.timelineScope = 'subset'
        scopeChip.dataset.figma = '2860:1112'
        scopeChip.dataset.capability = 'TIME-04 TIME-08 CHAT-01'
        scopeChip.setAttribute('aria-pressed', 'true')
        scopeChip.textContent = `Revise ${editSummary} · Lock ${lockSummary} ×`
        scopeChip.title = `Editable in Canvas & timeline turns: ${editLabels.join(', ')} · Locked: ${locked.join(', ')} · Click to unlock all frames`
        scopeChip.onclick = () => setEditableFrames(manifest, null)
        tagsBar.append(scopeChip)
      }
    }
  }
  function renderPlayhead(manifest, displayedFrame) {
    if (headFrame !== displayedFrame) {
      frameNodes.get(headFrame)?.classList.remove('is-head')
      frameNodes.get(displayedFrame)?.classList.add('is-head')
      headFrame = displayedFrame
    }
    const current = root.querySelector('.vnext-play-current')
    const label = String(manifest.frame_order.indexOf(displayedFrame) + 1).padStart(2, '0')
    if (current.textContent !== label) current.textContent = label
    const summary = root.querySelector('.vnext-playback-params-start .vnext-text-btn span')
    const duration = `${manifest.frames[displayedFrame].duration_ms} ms`
    if (summary && summary.textContent !== duration) summary.textContent = duration
  }
  function render() {
    const manifest = current()
    if (menuOwner && !isCurrent(menuOwner)) closeMenu()
    if (drag && !isCurrent(drag)) clearDrag()
    if (activeDocument !== manifest?.document_id) { stop(); activeDocument = manifest?.document_id }
    let supported = false
    try { assertPixelStructure(manifest); supported = true } catch { /* Keep unsupported documents read-only. */ }
    const disabled = !supported || blocked()
    if (playing && disabled) stop()
    nav.forEach(n => { n.disabled = disabled; n.title = disabled ? 'Select a supported canvas and finish the current edit' : n.getAttribute('aria-label') })
    addLayer.disabled = disabled || readOnly() || manifest?.layer_order.length >= 32; addLayer.title = 'Add an empty layer'
    if (loopButton) { loopButton.disabled = disabled; loopButton.title = 'Loop playback'; loopButton.setAttribute('aria-pressed', String(loop)); loopButton.classList.toggle('is-selected', loop) }
    if (!supported) {
      if (tagsBar) { tagsBar.replaceChildren(); tagsBar.hidden = true }
      layers.querySelectorAll('[data-capability="TIME-07"]').forEach(link => { link.disabled = true; link.title = 'Select a supported canvas to change Link copies.' })
      renderKey = ''; return false
    }
    const selected = target(manifest)
    const displayedFrame = playing ? playFrame || selected.frame_id : selected.frame_id
    const currentTag = activeTag(manifest)
    const scopeIds = editableFrames(manifest)
    const scopeKey = scopeIds ? scopeIds.join(',') : 'all'
    const key = `${manifest.document_id}:${manifest.revision}:${selected.cel_id}:${disabled}:${session.documentCandidate?.id || "saved"}:${currentTag?.id || ""}:${scopeKey}`
    if (renderKey === key) { renderPlayhead(manifest, displayedFrame); return true }
    renderKey = key
    renderTagsBar(manifest, disabled)
    root.querySelector('.vnext-grid').classList.add('is-document')
    root.querySelector('.vnext-grid').style.setProperty('--vnext-document-rows', manifest.layer_order.length)
    frames.replaceChildren()
    frameNodes.clear(); headFrame = null
    const tagFromIdx = currentTag ? manifest.frame_order.indexOf(currentTag.from_frame_id) : -1
    const tagToIdx = currentTag ? manifest.frame_order.indexOf(currentTag.to_frame_id) : -1
    manifest.frame_order.forEach((id, index) => {
      const col = document.createElement('div'); col.className = 'vnext-frame-col'
      if (currentTag && index >= tagFromIdx && index <= tagToIdx) col.classList.add('is-in-tag')
      const isEditableInScope = !scopeIds || scopeIds.includes(id)
      if (scopeIds) {
        col.classList.add(isEditableInScope ? 'is-scope-editable' : 'is-scope-locked')
        col.dataset.frameScope = isEditableInScope ? 'editable' : 'locked'
      }
      frameNodes.set(id, col)
      const header = document.createElement('button'); header.className = 'vnext-frame-index'; header.textContent = String(index + 1).padStart(2, '0'); header.disabled = disabled
      header.setAttribute(
        'aria-label',
        scopeIds
          ? `Frame ${index + 1} (${isEditableInScope ? 'editable in scope' : 'locked in scope'})`
          : `Frame ${index + 1}`
      )
      header.title = scopeIds
        ? `Frame ${index + 1} is ${isEditableInScope ? 'editable' : 'locked'} in revision scope · Alt/Cmd-click to toggle · Shift-click for range · right-click for actions`
        : 'Select frame · Shift/Alt-click to scope revision · drag to move · right-click for actions'
      header.setAttribute('aria-haspopup', 'menu'); bindStructureTarget(header, 'frame', id)
      header.onclick = e => {
        if (manifest.frame_order.length > 1 && (e.altKey || e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          toggleFrameInScope(manifest, id)
          return
        }
        if (manifest.frame_order.length > 1 && e.shiftKey) {
          e.preventDefault()
          const anchorIdx = Math.max(0, manifest.frame_order.indexOf(selected.frame_id))
          const lo = Math.min(anchorIdx, index)
          const hi = Math.max(anchorIdx, index)
          setEditableFrames(manifest, manifest.frame_order.slice(lo, hi + 1))
          return
        }
        selectFrom(header, id, selected.layer_id)
      }
      col.append(header)
      manifest.layer_order.forEach(layerId => {
        const cel = Object.values(manifest.cels).find(c => c.frame_id === id && c.layer_id === layerId)
        const chosen = id === selected.frame_id && layerId === selected.layer_id
        const linkScope = pixelLinkScope(manifest, cel.id)
        const linkedFrames = linkScope && linkScope.cel_ids.length > 1
          ? linkScope.cel_ids.map(cid => manifest.frame_order.indexOf(manifest.cels[cid]?.frame_id) + 1).filter(n => n > 0).sort((a, b) => a - b)
          : null
        const button = document.createElement('button'); button.className = `vnext-cel${cel.block ? ' is-filled' : ' is-blank'}${chosen ? ' is-selected' : ''}${linkedFrames ? ' is-linked' : ''}`
        button.disabled = disabled; button.dataset.celId = cel.id
        if (linkScope && linkedFrames) button.dataset.linkGroup = linkScope.group_id
        button.setAttribute('aria-label', `${manifest.layers[layerId].name}, frame ${index + 1}${linkedFrames ? ` · linked frames ${linkedFrames.join(', ')}` : ''}`)
        button.setAttribute('aria-pressed', String(chosen))
        button.setAttribute('aria-haspopup', 'menu')
        button.title = linkedFrames
          ? `Linked across frames ${linkedFrames.join(', ')} · right-click to link or unlink`
          : 'Select cel · right-click to link or unlink'
        const symbol = chosen ? (cel.block ? 'cel-row-selected' : 'cel-blank-selected') : (cel.block ? 'cel-content' : 'cel-blank')
        button.innerHTML = `<svg aria-hidden="true"><use href="#vnext-${symbol}"/></svg>`
        button.onclick = () => select(id, layerId)
        button.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); openCelMenu(cel, id, layerId, button, e.clientX, e.clientY) }
        col.append(button)
      })
      const duration = document.createElement('button'); duration.className = 'vnext-frame-duration'; duration.textContent = manifest.frames[id].duration_ms
      duration.disabled = disabled || readOnly(); duration.setAttribute('aria-label', `Frame ${index + 1} duration`); duration.title = 'Double-click to edit duration in milliseconds'
      duration.ondblclick = () => editDialog('Frame duration (ms)', manifest.frames[id].duration_ms, value => ({ type: 'set-duration', frame_id: id, duration_ms: value }), true)
      col.append(duration); frames.append(col)
    })
    const add = document.createElement('button'); add.className = 'vnext-add-blank'; add.textContent = '+'; add.style.marginTop = `${28 + manifest.layer_order.indexOf(selected.layer_id) * 32}px`; add.setAttribute('aria-label', 'Add blank frame'); add.title = 'Append a blank 125ms frame'
    add.disabled = disabled || readOnly() || manifest.layers[selected.layer_id].locked || manifest.frame_order.length >= 256; add.onclick = () => command({ type: 'add-frame' }); frames.append(add)
    layers.querySelectorAll('.vnext-layer-row').forEach(n => n.remove())
    for (const id of manifest.layer_order) {
      const layer = manifest.layers[id], row = template.cloneNode(true); row.removeAttribute('data-figma'); row.dataset.layerId = id; row.classList.toggle('is-selected', id === selected.layer_id)
      const icons = [...row.querySelectorAll('.vnext-layer-icon')]
      for (const [i, type, value, label] of [[0, 'set-visible', layer.visible, layer.visible ? 'Hide layer' : 'Show layer'], [1, 'set-locked', layer.locked, layer.locked ? 'Unlock layer' : 'Lock layer']]) {
        const button = document.createElement('button'); button.className = 'vnext-layer-icon'; button.disabled = disabled || readOnly(); button.title = label; button.setAttribute('aria-label', `${label} ${layer.name}`); button.setAttribute('aria-pressed', String(value)); button.innerHTML = icons[i].innerHTML
        if (i === 1) button.querySelector('use').setAttribute('href', layer.locked ? '#vnext-icon-lock-locked' : '#vnext-icon-lock-unlocked')
        if (i === 0 && !value) button.style.opacity = '.35'
        button.onclick = e => { e.stopPropagation(); command({ type, layer_id: id, value: !value }) }; icons[i].replaceWith(button)
      }
      const link = row.querySelector('[data-capability="TIME-07"]'), linked = linkedCopyEnabled(manifest, id)
      link.disabled = disabled || readOnly() || layer.locked; link.dataset.capabilityStatus = 'implemented'
      link.setAttribute('aria-label', `Link copies ${layer.name}`); link.setAttribute('aria-pressed', String(linked))
      link.querySelector('use').setAttribute('href', linked ? '#vnext-icon-link-on' : '#vnext-icon-link-off')
      link.title = disabled ? 'Finish the current edit or project change first.' : layer.locked ? 'Unlock this layer to change Link copies.'
        : `Link copies ${linked ? 'on' : 'off'}: future copies ${linked ? 'join the linked group' : 'are independent'}. Existing links stay unchanged. Blank frames stay blank.`
      link.onclick = e => { e.stopPropagation(); if (!link.disabled) command({ type: 'set-layer-link-copies', layer_id: id, value: !linked }) }
      for (const type of ['keydown', 'keyup']) link.addEventListener(type, e => { if (e.key === ' ') e.stopPropagation() })
      const name = row.querySelector('.vnext-layer-name'); name.textContent = layer.name; name.title = 'Double-click to rename'; name.ondblclick = () => editDialog('Rename layer', layer.name, value => ({ type: 'rename-layer', layer_id: id, name: value }))
      name.tabIndex = disabled ? -1 : 0; name.setAttribute('role', 'button'); name.setAttribute('aria-label', `Select layer ${layer.name}`); name.setAttribute('aria-haspopup', 'menu')
      name.title = 'Select layer · drag to move · right-click for actions'; bindStructureTarget(name, 'layer', id)
      name.addEventListener('keydown', e => { if (!e.isComposing && !e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); selectFrom(name, selected.frame_id, id) } })
      if (id === selected.layer_id) {
        const more = document.createElement('button'); more.type = 'button'; more.className = 'vnext-icon-btn is-16 has-bg'; more.disabled = disabled || readOnly()
        more.setAttribute('aria-label', `Layer actions ${layer.name}`); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false')
        more.innerHTML = '<svg class="vnext-icon is-10" aria-hidden="true"><use href="#vnext-icon-more"/></svg>'
        more.onclick = e => { e.stopPropagation(); openMenu('layer', id, more) }; row.append(more)
      }
      row.onclick = e => { if (!e.target.closest('button') && !disabled) selectFrom(name, selected.frame_id, id) }
      layers.insertBefore(row, layers.querySelector('.vnext-duration-label'))
    }
    const band = root.querySelector('.vnext-selected-row'); if (band) band.style.top = `${24 + manifest.layer_order.indexOf(selected.layer_id) * 32}px`
    renderPlayhead(manifest, displayedFrame)
    root.querySelector('.vnext-play-total').textContent = `/ ${String(manifest.frame_order.length).padStart(2, '0')}`
    return true
  }
  addLayer.onclick = () => { const m = current(); if (m && !blocked()) command({ type: 'add-layer', name: `Layer ${m.layer_order.length + 1}` }) }
  nav.forEach((button, i) => button.onclick = () => {
    const manifest = current(); if (!manifest || blocked()) return
    const t = target(manifest), at = manifest.frame_order.indexOf(t.frame_id)
    if (i === 2) { if (playing) stop(); else {
      const tag = activeTag(manifest)
      let startFrame = t.frame_id
      if (tag) {
        const fromIdx = manifest.frame_order.indexOf(tag.from_frame_id)
        const toIdx = manifest.frame_order.indexOf(tag.to_frame_id)
        pingPongForward = tag.direction !== 'reverse'
        if (at < fromIdx || at > toIdx) startFrame = tag.direction === 'reverse' ? tag.to_frame_id : tag.from_frame_id
      }
      playing = true; playEpoch++; playFrame = startFrame
      editPreview = { manifest, projectId: session.project.id, canvasId: view.selectedId, preview: (session.documentCandidate?.canvas.id === view.selectedId ? session.documentCandidate.canvas : view.canvases.find(c => c.id === view.selectedId))?.preview }
      renderPlayButton(); session.onionSkin?.render(); schedule()
    } return }
    const index = i === 0 ? 0 : i === 4 ? manifest.frame_order.length - 1 : Math.max(0, Math.min(manifest.frame_order.length - 1, at + (i === 1 ? -1 : 1)))
    select(manifest.frame_order[index], t.layer_id)
  })
  if (loopButton) loopButton.onclick = () => { loop = !loop; render() }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop() })
  window.addEventListener('pagehide', stop)
  return {
    target,
    setTarget,
    activeTag: () => activeTag(current()),
    setActiveTag: tagId => setActiveTag(current(), tagId),
    editableFrameIds: () => editableFrames(current()),
    lockedFrameIds: () => lockedFrames(current()),
    setEditableFrameIds: ids => setEditableFrames(current(), ids),
    toggleEditableFrame: id => toggleFrameInScope(current(), id),
    openTagDialog,
    render,
    stop,
    isPlaying: () => playing,
    reset() { stop(); closeMenu(); clearDrag(); state.clear(); activeTags.clear(); frameScopes.clear() },
    select,
  }
}
