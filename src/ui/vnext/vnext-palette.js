import { paintHex } from './vnext-paint-controls.js'

const DEFAULT_COLORS = 'FFFFFF E1E4E1 ABB2AD 747F78 4D5852 303C35 1E2923 111815 E8DABD CFB88F AF9168 D7BFA6 B58870 946452 724838 4D332B C1D8C6 90B49D 6F927F 4D7366 32584D B5BDD6 898CAF 626887'.split(' ')
const parseHexColors = list => list.map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(255))

export const PALETTE_LIBRARY = Object.freeze([
  { id: 'preset-default-24', name: 'Default 24', colors: parseHexColors(DEFAULT_COLORS) },
  { id: 'preset-retro-4', name: 'Retro Handheld 4', colors: parseHexColors('E0F8CF 86C06C 306850 071821'.split(' ')) },
  { id: 'preset-arcade-16', name: 'Arcade 16', colors: parseHexColors('1A1C2C 5D275D B13E53 EF7D57 FFD75F A7F070 38B764 257179 29366F 3B5DC9 41A6F6 73EFF7 F4F4F4 94B0C2 566C86 333C57'.split(' ')) },
  { id: 'preset-sunset-12', name: 'Warm Sunset 12', colors: parseHexColors('FFF3D6 FFD29D FFA477 F06C64 C44569 8B2F5F 541E50 2B1138 69B578 3A7D6C 254D59 172A3A'.split(' ')) },
  { id: 'preset-forest-12', name: 'Forest & Earth 12', colors: parseHexColors('F2EFE9 D9D0C1 A69683 736353 4A3E35 261F1B D4E6B5 9BC472 5C9447 326333 1D3B26 112118'.split(' ')) },
])

export const projectPalette = project => (project?.settings?.palette?.colors
  ?? parseHexColors(DEFAULT_COLORS)).map(c => c.slice())

export function projectPalettes(project) {
  const raw = project?.settings?.palette
  if (Array.isArray(raw?.items) && raw.items.length > 0) {
    const items = raw.items.map(item => ({
      id: String(item.id || 'custom'),
      name: String(item.name || 'Custom'),
      colors: Array.isArray(item.colors) ? item.colors.map(c => c.slice()) : [],
    }))
    const activeItem = items.find(item => item.id === raw.active_id) || items[0]
    return { activeId: activeItem.id, activeItem, items }
  }
  const fallbackColors = projectPalette(project)
  const single = { id: 'custom', name: 'Custom', colors: fallbackColors }
  return { activeId: single.id, activeItem: single, items: [single] }
}

export const sameColor = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

function nextPaletteId(items, base = 'pal') {
  const used = new Set(items.map(item => item.id))
  const slug = String(base).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'pal'
  if (!used.has(slug)) return slug
  for (let i = 2; i <= 99; i += 1) {
    const candidate = `${slug}-${i}`
    if (!used.has(candidate)) return candidate
  }
  return `pal-${Date.now().toString(36).slice(-6)}`
}

function nextPaletteName(items, base = 'Palette') {
  const used = new Set(items.map(item => item.name.toLowerCase()))
  const clean = String(base).trim().slice(0, 64) || 'Palette'
  if (!used.has(clean.toLowerCase())) return clean
  for (let i = 2; i <= 99; i += 1) {
    const candidate = `${clean.slice(0, 58)} ${i}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return clean
}

// Project metadata only: working colors and existing pixels are separate state.
// isBusy gates choosing a color; isWriteBusy (default isBusy) gates palette writes. A live text draft
// may take a palette color, but must not race a palette save that changes the project revision.
export function bindPaletteControls({ root, session, getColor, setColor, isBusy, isWriteBusy = isBusy, status, writeBusyMessage = null }) {
  const grid = root.querySelector('#vnext-palette'), add = root.querySelector('#vnext-palette-add'), menu = root.querySelector('#vnext-palette-menu')
  const selectBtn = root.querySelector('[data-capability="COLOR-03"]'), selectMenu = root.querySelector('#vnext-palette-select-menu')
  if (!grid || !add || !menu) return { refresh() {} }
  let key = '', colors = [], owner = null, target = null, trigger = null
  const close = (focus = false) => { menu.hidden = true; target = null; if (focus && trigger?.isConnected) trigger.focus(); trigger = null }
  const closeSelectMenu = (focus = false) => {
    if (!selectMenu || selectMenu.hidden) return
    selectMenu.hidden = true
    selectBtn?.setAttribute('aria-expanded', 'false')
    if (focus) selectBtn?.focus?.()
  }
  const writable = () => Boolean(session.project && ['editor_project_v1', 'editor_project_v2'].includes(session.project.version) && !isWriteBusy())
  function renderSelectMenu() {
    if (!selectMenu || selectMenu.hidden) return
    const { activeId, activeItem, items } = projectPalettes(session.project)
    const canWrite = writable()
    selectMenu.replaceChildren()
    const head = document.createElement('div')
    head.className = 'vnext-palette-pop-head'
    head.textContent = `Project palettes (${items.length}/16)`
    selectMenu.append(head)

    const list = document.createElement('div')
    list.className = 'vnext-palette-pop-list'
    for (const item of items) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = `vnext-palette-pop-item${item.id === activeId ? ' is-selected' : ''}`
      row.dataset.paletteSelect = item.id
      row.setAttribute('role', 'menuitemradio')
      row.setAttribute('aria-checked', String(item.id === activeId))
      row.disabled = !canWrite
      const nameSpan = document.createElement('span')
      nameSpan.className = 'vnext-palette-pop-name'
      nameSpan.textContent = item.name
      const metaSpan = document.createElement('span')
      metaSpan.className = 'vnext-palette-pop-meta'
      metaSpan.textContent = `${item.colors.length}`
      const preview = document.createElement('span')
      preview.className = 'vnext-palette-pop-swatches'
      for (const c of item.colors.slice(0, 5)) {
        const dot = document.createElement('span')
        dot.className = 'vnext-palette-pop-dot'
        dot.style.background = `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`
        preview.append(dot)
      }
      row.append(nameSpan, preview, metaSpan)
      list.append(row)
    }
    selectMenu.append(list)

    const manage = document.createElement('div')
    manage.className = 'vnext-palette-pop-manage'
    const renameRow = document.createElement('div')
    renameRow.className = 'vnext-palette-rename-row'
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.id = 'vnext-palette-name-input'
    nameInput.className = 'vnext-palette-name-input'
    nameInput.maxLength = 64
    nameInput.value = activeItem.name
    nameInput.disabled = !canWrite
    nameInput.setAttribute('aria-label', 'Active palette name')
    const renameBtn = document.createElement('button')
    renameBtn.type = 'button'
    renameBtn.className = 'vnext-dialog-btn is-secondary'
    renameBtn.dataset.paletteManage = 'rename'
    renameBtn.textContent = 'Rename'
    renameBtn.disabled = !canWrite
    renameRow.append(nameInput, renameBtn)
    manage.append(renameRow)

    const actionRow = document.createElement('div')
    actionRow.className = 'vnext-palette-action-row'
    const dupBtn = document.createElement('button')
    dupBtn.type = 'button'
    dupBtn.className = 'vnext-dialog-btn is-secondary'
    dupBtn.dataset.paletteManage = 'duplicate'
    dupBtn.textContent = 'Duplicate'
    dupBtn.title = items.length >= 16 ? 'Maximum 16 palettes per project' : 'Create a new palette with the current colors'
    dupBtn.disabled = !canWrite || items.length >= 16
    const emptyBtn = document.createElement('button')
    emptyBtn.type = 'button'
    emptyBtn.className = 'vnext-dialog-btn is-secondary'
    emptyBtn.dataset.paletteManage = 'new-empty'
    emptyBtn.textContent = 'New empty'
    emptyBtn.title = items.length >= 16 ? 'Maximum 16 palettes per project' : 'Create an empty palette'
    emptyBtn.disabled = !canWrite || items.length >= 16
    const delBtn = document.createElement('button')
    delBtn.type = 'button'
    delBtn.className = 'vnext-dialog-btn is-secondary'
    delBtn.dataset.paletteManage = 'delete'
    delBtn.textContent = 'Delete'
    delBtn.title = items.length <= 1 ? 'Keep at least one palette in the project' : `Delete palette “${activeItem.name}”`
    delBtn.disabled = !canWrite || items.length <= 1
    actionRow.append(dupBtn, emptyBtn, delBtn)
    manage.append(actionRow)
    selectMenu.append(manage)

    const libHead = document.createElement('div')
    libHead.className = 'vnext-palette-pop-head'
    libHead.textContent = 'Palette library (add preset)'
    selectMenu.append(libHead)

    const libList = document.createElement('div')
    libList.className = 'vnext-palette-pop-list'
    for (const preset of PALETTE_LIBRARY) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'vnext-palette-pop-item is-preset'
      row.dataset.palettePreset = preset.id
      row.setAttribute('role', 'menuitem')
      row.disabled = !canWrite || items.length >= 16
      row.title = items.length >= 16 ? 'Maximum 16 palettes per project' : `Add preset “${preset.name}” (${preset.colors.length} colors)`
      const nameSpan = document.createElement('span')
      nameSpan.className = 'vnext-palette-pop-name'
      nameSpan.textContent = preset.name
      const metaSpan = document.createElement('span')
      metaSpan.className = 'vnext-palette-pop-meta'
      metaSpan.textContent = `+${preset.colors.length}`
      const preview = document.createElement('span')
      preview.className = 'vnext-palette-pop-swatches'
      for (const c of preset.colors.slice(0, 5)) {
        const dot = document.createElement('span')
        dot.className = 'vnext-palette-pop-dot'
        dot.style.background = `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`
        preview.append(dot)
      }
      row.append(nameSpan, preview, metaSpan)
      libList.append(row)
    }
    selectMenu.append(libList)
  }
  function refresh() {
    const { activeId, activeItem, items } = projectPalettes(session.project)
    const next = activeItem.colors
    const signature = JSON.stringify([session.project?.id, activeId, items])
    if (signature !== key) {
      close(); key = signature; colors = next; owner = session.project?.id; grid.replaceChildren()
      colors.forEach((color, index) => {
        if (index % 8 === 0) { const row = document.createElement('div'); row.className = 'vnext-palette-row'; grid.append(row) }
        const button = document.createElement('button'); button.type = 'button'; button.className = 'vnext-swatch'
        button.dataset.paletteIndex = index; button.dataset.paintColor = `#${paintHex(color).slice(0, 6)}`; button.dataset.paintAlpha = color[3]
        button.style.setProperty('--swatch', `rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255})`)
        button.innerHTML = '<svg class="vnext-swatch-ring" width="37" height="37" viewBox="0 0 37 37" aria-hidden="true"><use href="#vnext-color-selected-ring"/></svg>'
        button.setAttribute('aria-haspopup', 'menu'); button.title = `#${paintHex(color)} · right-click or Shift+F10 to edit`
        grid.lastElementChild.append(button)
      })
      if (!colors.length) { const empty = document.createElement('p'); empty.className = 'vnext-palette-empty'; empty.textContent = 'No colors yet. Add the current color.'; grid.append(empty) }
    }
    const locked = isBusy(), current = getColor(), duplicate = colors.some(c => sameColor(c, current))
    grid.querySelectorAll('[data-palette-index]').forEach(button => {
      const selected = sameColor(colors[Number(button.dataset.paletteIndex)], current)
      button.disabled = locked; button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', String(selected))
      button.setAttribute('aria-label', `Palette color ${paintHex(colors[Number(button.dataset.paletteIndex)])}${selected ? ' · selected' : ''}`)
      button.querySelector('.vnext-swatch-ring').style.display = selected ? '' : 'none'
    })
    if (selectBtn) {
      selectBtn.dataset.capabilityStatus = 'implemented'
      selectBtn.disabled = !session.project || locked
      const label = selectBtn.querySelector('span')
      if (label) label.textContent = activeItem.name
      selectBtn.title = !session.project
        ? 'Create or open a project to manage palettes'
        : `Palette: ${activeItem.name} (${items.length} in project) · click to switch, rename, or add presets`
      selectBtn.setAttribute('aria-label', `Select palette · ${activeItem.name}`)
      selectBtn.setAttribute('aria-haspopup', 'menu')
      selectBtn.setAttribute('aria-expanded', String(Boolean(selectMenu && !selectMenu.hidden)))
    }
    add.disabled = !writable() || (colors.length >= 256 && !duplicate)
    add.title = !session.project ? 'Create or open a project to save colors' : isWriteBusy() ? 'Finish the current edit or project change first'
      : colors.length >= 256 && !duplicate ? 'Palette is full (256 colors)' : 'Add current color to this project'
    if (!writable()) { close(); closeSelectMenu() }
    else if (selectMenu && !selectMenu.hidden) renderSelectMenu()
  }
  async function save(next) { if (!writable()) return; close(); closeSelectMenu(); await session.savePalette?.(next); refresh() }
  add.addEventListener('click', () => {
    if (!writable()) return
    const current = getColor(), duplicate = colors.findIndex(c => sameColor(c, current))
    if (duplicate >= 0) { refresh(); grid.querySelector(`[data-palette-index="${duplicate}"]`)?.focus(); status('This color is already in the palette.'); return }
    if (colors.length < 256) void save([...colors, current.slice()])
  })
  grid.addEventListener('click', event => {
    const button = event.target.closest?.('[data-palette-index]')
    if (button && !isBusy()) setColor(colors[Number(button.dataset.paletteIndex)].slice())
  })
  if (selectBtn && selectMenu) {
    selectBtn.addEventListener('click', event => {
      event.stopPropagation()
      if (!session.project || isBusy()) return
      if (!writable()) {
        if (session.project && isWriteBusy()) status?.(writeBusyMessage?.() || 'Finish the current edit, then manage palettes.')
        return
      }
      close()
      if (!selectMenu.hidden) { closeSelectMenu(true); return }
      selectMenu.hidden = false
      selectBtn.setAttribute('aria-expanded', 'true')
      renderSelectMenu()
      selectMenu.querySelector('#vnext-palette-name-input')?.focus?.()
    })
    const commitRename = () => {
      if (!writable()) return
      const input = selectMenu.querySelector('#vnext-palette-name-input')
      const nextName = input?.value?.trim()
      if (!nextName) { status?.('Enter a palette name.'); input?.focus?.(); return }
      const { activeId, activeItem, items } = projectPalettes(session.project)
      if (nextName === activeItem.name) { closeSelectMenu(true); return }
      const nextItems = items.map(item => item.id === activeId ? { ...item, name: nextName } : item)
      void save({ colors: activeItem.colors, active_id: activeId, items: nextItems })
    }
    selectMenu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSelectMenu(true); return }
      if (event.key === 'Enter' && event.target?.id === 'vnext-palette-name-input') {
        event.preventDefault(); event.stopPropagation(); commitRename()
      }
    })
    selectMenu.addEventListener('click', event => {
      if (!writable()) return
      const selectTarget = event.target.closest?.('[data-palette-select]')
      if (selectTarget) {
        const targetId = selectTarget.dataset.paletteSelect
        const { activeId, items } = projectPalettes(session.project)
        const chosen = items.find(item => item.id === targetId)
        if (!chosen || targetId === activeId) { closeSelectMenu(true); return }
        void save({ colors: chosen.colors, active_id: chosen.id, items })
        return
      }
      const manageTarget = event.target.closest?.('[data-palette-manage]')
      if (manageTarget) {
        const action = manageTarget.dataset.paletteManage
        const { activeId, activeItem, items } = projectPalettes(session.project)
        if (action === 'rename') { commitRename(); return }
        if (action === 'duplicate' || action === 'new-empty') {
          if (items.length >= 16) return
          const id = nextPaletteId(items, action === 'duplicate' ? activeItem.name : 'palette')
          const name = nextPaletteName(items, action === 'duplicate' ? `${activeItem.name} copy` : 'New palette')
          const newColors = action === 'duplicate' ? activeItem.colors.map(c => c.slice()) : []
          const nextItems = [...items, { id, name, colors: newColors }]
          void save({ colors: newColors, active_id: id, items: nextItems })
          return
        }
        if (action === 'delete') {
          if (items.length <= 1) return
          const nextItems = items.filter(item => item.id !== activeId)
          const fallback = nextItems[0]
          const performDelete = () => void save({ colors: fallback.colors, active_id: fallback.id, items: nextItems })
          if (activeItem.colors.length > 0 && typeof session.openConfirm === 'function') {
            closeSelectMenu()
            session.openConfirm({
              title: `Delete palette “${activeItem.name}”?`,
              body: `Removes “${activeItem.name}” (${activeItem.colors.length} colors) from this project and switches to “${fallback.name}”. Existing canvas pixels are not changed.`,
              primary: 'Delete palette',
              secondary: 'Cancel',
              onPrimary: () => { session.closeConfirm?.(); performDelete() },
              onSecondary: () => session.closeConfirm?.(),
            })
          } else {
            performDelete()
          }
        }
        return
      }
      const presetTarget = event.target.closest?.('[data-palette-preset]')
      if (presetTarget) {
        const preset = PALETTE_LIBRARY.find(entry => entry.id === presetTarget.dataset.palettePreset)
        const { items } = projectPalettes(session.project)
        if (!preset || items.length >= 16) return
        const id = nextPaletteId(items, preset.name)
        const name = nextPaletteName(items, preset.name)
        const newColors = preset.colors.map(c => c.slice())
        const nextItems = [...items, { id, name, colors: newColors }]
        void save({ colors: newColors, active_id: id, items: nextItems })
      }
    })
  }
  function open(event) {
    const button = event.target.closest?.('[data-palette-index]')
    if (!button) return
    event.preventDefault()
    if (!writable()) { if (session.project && isWriteBusy()) status?.(writeBusyMessage?.() || 'Finish the current edit, then edit palette colors.'); return }
    closeSelectMenu()
    target = Number(button.dataset.paletteIndex); trigger = button; menu.hidden = false
    const rect = button.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8))}px`
    menu.querySelector('button').focus()
  }
  grid.addEventListener('contextmenu', open)
  grid.addEventListener('keydown', e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) open(e) })
  menu.addEventListener('click', event => {
    const action = event.target.closest?.('[data-palette-action]')?.dataset.paletteAction
    if (!action || target == null || owner !== session.project?.id || !writable()) return
    const next = colors.map(c => c.slice()), index = target
    if (action === 'remove') next.splice(index, 1); else next[index] = getColor().slice()
    if (JSON.stringify(next) === JSON.stringify(colors)) { close(true); return }
    void save(next)
  })
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement)
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (i + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length].focus()
    }
    if (event.key === 'Tab') close()
  })
  root.addEventListener('pointerdown', e => {
    if (!menu.hidden && !menu.contains(e.target)) close()
    if (selectMenu && !selectMenu.hidden && !selectMenu.contains(e.target) && !selectBtn?.contains?.(e.target)) closeSelectMenu()
  }, true)
  root.addEventListener('scroll', () => { close(); closeSelectMenu() }, true)
  window.addEventListener('resize', () => { close(); closeSelectMenu() })
  refresh(); return { refresh }
}
