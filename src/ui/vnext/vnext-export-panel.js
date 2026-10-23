import { prepareDocumentSheet, SHEET_STALE } from './vnext-document-sheet.js'

export function bindExportPanel({ root, trigger, api, context, currentFrame, stopPlayback, familyFor }) {
  const panel = root.querySelector('#vnext-export-dialog')
  if (!panel || !trigger) return null
  const document = root.ownerDocument || root
  const find = id => panel.querySelector(`#vnext-export-${id}`)
  const title = find('name'), status = find('status'), preview = find('preview'), placeholder = find('placeholder')
  const frame = find('frame'), sheet = find('sheet'), reload = find('reload'), closeButton = find('close'), exportButton = find('submit'), json = find('json')
  const tagOption = find('tag-option'), tagSelect = find('tag')
  let token = 0, owner = null, preparing = false, result = null, urls = [], mode = 'sheet', tagId = 'all'
  const release = () => {
    preview.hidden = true; preview.removeAttribute('src'); placeholder.hidden = false
    for (const url of urls) URL.revokeObjectURL(url)
    urls = []; result = null; find('dimensions').textContent = ''; find('filename').textContent = 'PNG · Ready after preview loads'
  }
  const message = (text, error = false) => { status.textContent = text; status.classList.toggle('is-error', error) }
  const matches = target => { const now = context(); return now && !now.busy && now.key === target?.key }
  function refresh() {
    if (panel.hidden) return
    const now = context()
    if (owner && (!now || now.busy || now.key !== owner.key)) {
      token++; preparing = false; owner = null; release(); placeholder.textContent = 'Preview out of date'; message(SHEET_STALE, true)
    }
    const doc = now?.document
    const tags = Array.isArray(doc?.tags) ? doc.tags : []
    if (tagId !== 'all' && !tags.some(t => t.id === tagId)) tagId = 'all'
    const selectedTag = mode === 'sheet' && tagId !== 'all' ? tags.find(t => t.id === tagId) || null : null
    const tagFrames = selectedTag && Array.isArray(doc?.frame_order)
      ? (() => {
        const from = doc.frame_order.indexOf(selectedTag.from_frame_id)
        const to = doc.frame_order.indexOf(selectedTag.to_frame_id)
        return from >= 0 && to >= from ? { count: to - from + 1, from: from + 1, to: to + 1 } : null
      })()
      : null
    title.textContent = now?.name || 'No saved canvas selected'
    find('title').textContent = mode === 'sheet' ? 'Export sprite sheet' : 'Export current frame'
    find('scope').textContent = mode === 'sheet'
      ? (selectedTag && tagFrames
        ? `Tag “${selectedTag.name}” (${tagFrames.count} ${tagFrames.count === 1 ? 'frame' : 'frames'}, #${tagFrames.from}–#${tagFrames.to}) · Visible layers`
        : `All ${doc?.frame_order.length || 0} frames · Visible layers`)
      : 'Current frame · Visible layers'
    find('layout').textContent = mode === 'sheet' ? 'Automatic grid · Original pixels' : 'Single frame · Original pixels'
    const size = doc?.canvas || { w: now?.canvas?.width, h: now?.canvas?.height }
    find('frame-size').textContent = size.w && size.h ? `${size.w} × ${size.h} px per frame` : 'Select a saved canvas'
    frame.disabled = !now || now.busy
    sheet.disabled = !doc || now.busy
    frame.setAttribute('aria-pressed', String(mode === 'frame')); sheet.setAttribute('aria-pressed', String(mode === 'sheet'))
    if (tagOption) tagOption.hidden = mode !== 'sheet' || tags.length === 0
    if (tagSelect) {
      tagSelect.disabled = mode !== 'sheet' || !now || now.busy || tags.length === 0
      const items = [
        { value: 'all', label: `All frames (${doc?.frame_order.length || 0})` },
        ...tags.map(t => {
          const from = (doc?.frame_order.indexOf(t.from_frame_id) ?? -1) + 1
          const to = (doc?.frame_order.indexOf(t.to_frame_id) ?? -1) + 1
          return { value: t.id, label: `${t.name} (#${from}–#${to})` }
        }),
      ]
      tagSelect.replaceChildren(...items.map(item => {
        const opt = document.createElement('option')
        opt.value = item.value
        opt.textContent = item.label
        opt.selected = item.value === tagId
        return opt
      }))
      tagSelect.value = tagId
    }
    find('json-option').hidden = mode !== 'sheet'
    json.disabled = mode !== 'sheet' || !now || now.busy
    reload.hidden = preparing || !!result
    reload.disabled = !now || now.busy || (mode === 'sheet' && !doc)
    exportButton.disabled = !result || preparing || !matches(owner)
  }
  function close() { token++; preparing = false; owner = null; release(); panel.hidden = true; if (!trigger.disabled) trigger.focus() }
  trigger.addEventListener('click', () => {
    if (trigger.disabled) return
    stopPlayback?.(); panel.hidden = false; mode = context()?.document ? 'sheet' : 'frame'; json.checked = false; tagId = 'all'
    refresh(); closeButton.focus(); return run()
  })
  closeButton.addEventListener('click', close)
  panel.querySelector('[data-export-dismiss]')?.addEventListener('click', close)
  // Capture before canvas/history shortcuts; Tab remains inside the modal.
  document.addEventListener('keydown', event => {
    if (panel.hidden) return
    event.stopImmediatePropagation()
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if (event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(n => !n.closest('[hidden]'))
      const i = controls.indexOf(document.activeElement)
      if (event.shiftKey && i <= 0) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && (i < 0 || i === controls.length - 1)) { event.preventDefault(); controls[0]?.focus() }
    }
  }, true)
  async function run() {
    refresh()
    const asSheet = mode === 'sheet'
    if ((asSheet ? sheet : frame).disabled) { message('Wait for the current change to finish, then reload the preview.'); return }
    owner = context(); const target = owner, attempt = ++token
    preparing = true; release(); placeholder.textContent = 'Loading preview…'
    message(asSheet ? 'Reading saved frames…' : 'Reading the saved frame…'); refresh()
    const live = () => !panel.hidden && token === attempt && matches(target)
    try {
      if (asSheet) {
        const prepared = await prepareDocumentSheet({ api, projectId: target.projectId, canvasId: target.canvasId,
          documentId: target.document.document_id, expectedRevision: target.document.revision, name: target.name,
          tagId: tagId === 'all' ? null : tagId, isCurrent: live,
          familyFor: item => familyFor?.(item) || (item.font.kind === 'generic' ? item.font.name : null) })
        if (!live()) return
        result = prepared
        find('dimensions').textContent = `${prepared.metadata.image.width} × ${prepared.metadata.image.height} px · ${prepared.metadata.layout.columns} × ${prepared.metadata.layout.rows} grid`
        message(`Ready · ${prepared.metadata.image.width} × ${prepared.metadata.image.height} px · revision ${prepared.metadata.source.revision}`)
      } else {
        const prepared = await currentFrame(target)
        if (!live()) return
        result = { pngBlob: prepared.blob, pngFilename: prepared.filename }
        find('dimensions').textContent = `${target.canvas.width} × ${target.canvas.height} px`
        message(`Ready · ${target.canvas.width} × ${target.canvas.height} px`)
      }
      const url = URL.createObjectURL(result.pngBlob); urls.push(url)
      preview.src = url; preview.hidden = false; placeholder.hidden = true
      find('filename').textContent = `PNG · ${result.pngFilename}`
    } catch (error) {
      if (token === attempt && !panel.hidden) {
        release(); placeholder.textContent = 'Preview unavailable'
        message(error.kind || !error.message
          ? 'The saved image could not be read. Reload the preview to try again.' : error.message, true)
      }
    }
    finally { if (token === attempt) { preparing = false; refresh() } }
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob); urls.push(url)
    const link = document.createElement('a'); link.href = url; link.download = filename; link.rel = 'noopener'; link.click()
  }
  for (const [button, value] of [[sheet, 'sheet'], [frame, 'frame']]) button.addEventListener('click', () => {
    if (mode === value || button.disabled) return
    mode = value; run()
  })
  tagSelect?.addEventListener('change', () => {
    if (tagSelect.disabled) return
    const next = tagSelect.value || 'all'
    if (next === tagId) return
    tagId = next
    return run()
  })
  reload.addEventListener('click', run)
  exportButton.addEventListener('click', () => {
    refresh(); if (exportButton.disabled) return
    download(result.pngBlob, result.pngFilename)
    if (mode === 'sheet' && json.checked) download(result.jsonBlob, result.jsonFilename)
    message(mode === 'sheet' && json.checked ? 'PNG and JSON downloads requested. Your browser may ask to allow multiple files.' : 'PNG download requested.')
  })
  return { refresh, close }
}
