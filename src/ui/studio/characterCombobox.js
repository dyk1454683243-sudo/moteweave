import { studioT } from './settingsView.js'

const registry = {}
const menus = {}
const pointerDocs = typeof WeakSet === 'function' ? new WeakSet() : null
const boundTriggers = typeof WeakSet === 'function' ? new WeakSet() : null
const geometryDocs = typeof WeakSet === 'function' ? new WeakSet() : null
let pointerBound = false
let geometryBound = false

function byId(id) {
  return globalThis.document?.getElementById?.(id) ?? null
}

export function registerCharacterCombobox(kind, spec) {
  registry[kind] = spec
  if (!menus[kind]) menus[kind] = { open: false, active: 0 }
  return spec
}

export function characterComboboxKinds() {
  return Object.keys(registry)
}

export function characterComboboxOptionId(prefix, value) {
  return `${prefix}-${value === '' || value == null ? 'none' : String(value)}`
}

export function characterComboboxOptionFromEvent(event) {
  const target = event?.target
  return target?.closest?.('[role="option"]') || (
    target?.getAttribute?.('role') === 'option' ? target : null
  )
}

export function readSelectOptions(select) {
  if (!select) return []
  const list = select.options
  if (!list || typeof list.length !== 'number') return []
  return Array.from(list, (option) => {
    const key = option?.getAttribute?.('data-studio-i18n') || option?.dataset?.studioI18n
    return {
      value: option.value,
      text: key ? studioT(key) : (option.textContent || option.text || ''),
    }
  })
}

function describedBy(kind) {
  const spec = registry[kind]
  if (typeof spec?.describedBy === 'function') return spec.describedBy() || ''
  return spec?.describedBy || ''
}

export function characterComboboxDisabled(kind) {
  const spec = registry[kind]
  if (!spec) return true
  const trigger = byId(spec.trigger)
  const select = byId(spec.select)
  return !trigger || trigger.getAttribute('aria-disabled') === 'true' || Boolean(select?.disabled)
}

export function focusCharacterCombobox(kind) {
  const spec = registry[kind]
  if (!spec) return
  const trigger = byId(spec.trigger)
  if (trigger && trigger.hidden !== true) trigger.focus()
  else byId(spec.select)?.focus()
}

function focusWithoutScroll(node) {
  if (!node || typeof node.focus !== 'function') return
  try { node.focus({ preventScroll: true }) } catch { node.focus() }
}

function clearListPlacement(list) {
  if (!list) return
  list.classList?.remove?.('is-above')
  if (list.style) {
    list.style.left = ''
    list.style.top = ''
    list.style.width = ''
    list.style.maxHeight = ''
  }
}

function scrollOptionIntoList(list, option) {
  if (!list || !option) return
  const listHeight = Number(list.clientHeight) || 0
  if (!listHeight) return
  const optionTop = Number(option.offsetTop) || 0
  const optionHeight = Number(option.offsetHeight) || 0
  const optionBottom = optionTop + optionHeight
  const visibleTop = Number(list.scrollTop) || 0
  const visibleBottom = visibleTop + listHeight
  if (optionTop < visibleTop) list.scrollTop = optionTop
  else if (optionBottom > visibleBottom) list.scrollTop = optionBottom - listHeight
}

export function closeCharacterCombobox(kind, { restoreFocus = false } = {}) {
  const spec = registry[kind]
  const menu = menus[kind]
  if (!spec || !menu) return
  menu.open = false
  const trigger = byId(spec.trigger)
  const list = byId(spec.list)
  if (trigger) {
    trigger.setAttribute('aria-expanded', 'false')
    trigger.removeAttribute('aria-activedescendant')
  }
  if (list) {
    list.hidden = true
    clearListPlacement(list)
  }
  if (restoreFocus) focusWithoutScroll(trigger)
}

export function closeAllCharacterComboboxes({ except = null, restoreFocus = false } = {}) {
  for (const kind of Object.keys(registry)) {
    if (kind === except) continue
    closeCharacterCombobox(kind, { restoreFocus: restoreFocus && kind !== except })
  }
}

function placeComboboxList(kind) {
  const spec = registry[kind]
  const trigger = byId(spec.trigger)
  const list = byId(spec.list)
  const win = globalThis.window
  if (!trigger || !list || list.hidden) return
  const tr = trigger.getBoundingClientRect?.()
  if (!tr || !win) return
  const gap = 4
  const width = tr.width
  const viewportWidth = win.innerWidth || width
  const viewportHeight = win.innerHeight || 0
  let left = tr.left
  if (left + width > viewportWidth) left = Math.max(0, viewportWidth - width)
  if (left < 0) left = 0
  if (list.style) list.style.width = `${width}px`
  const natural = Number(list.scrollHeight) || 0
  const maxInternal = spec.scrollable ? 232 : natural
  const needed = Math.min(natural || maxInternal, maxInternal)
  const spaceBelow = Math.max(0, viewportHeight - tr.bottom - gap)
  const spaceAbove = Math.max(0, tr.top - gap)
  const above = needed > spaceBelow && spaceAbove > spaceBelow
  list.classList?.toggle?.('is-above', above)
  const available = above ? spaceAbove : spaceBelow
  const height = Math.max(0, Math.min(needed, available || needed))
  const top = above ? Math.max(0, tr.top - gap - height) : tr.bottom + gap
  if (list.style) {
    list.style.left = `${left}px`
    list.style.top = `${top}px`
    if (spec.scrollable) list.style.maxHeight = `${Math.min(232, available || 232)}px`
  }
}

export function syncCharacterCombobox(kind, { editable = true, invalid = false } = {}) {
  const spec = registry[kind]
  const menu = menus[kind]
  if (!spec || !menu) return
  const select = byId(spec.select)
  const trigger = byId(spec.trigger)
  const valueNode = byId(spec.value)
  const list = byId(spec.list)
  if (select) {
    select.hidden = true
    select.tabIndex = -1
    select.setAttribute('aria-hidden', 'true')
  }
  const choices = readSelectOptions(select)
  const selectedValue = select?.value ?? ''
  const selected = choices.find((choice) => choice.value === selectedValue) || choices[0]
  if (valueNode) valueNode.textContent = selected?.text || ''
  const disabled = !editable || Boolean(select?.disabled)
  if (disabled && menu.open) {
    menu.open = false
    menu.active = 0
  }
  if (trigger) {
    trigger.setAttribute('role', 'combobox')
    trigger.setAttribute('aria-autocomplete', 'none')
    trigger.setAttribute('aria-haspopup', 'listbox')
    trigger.setAttribute('aria-controls', spec.list)
    trigger.setAttribute('aria-expanded', String(menu.open))
    const described = describedBy(kind)
    if (described) trigger.setAttribute('aria-describedby', described)
    else trigger.removeAttribute('aria-describedby')
    trigger.setAttribute('aria-disabled', String(disabled))
    trigger.tabIndex = disabled ? -1 : 0
    if (invalid) trigger.setAttribute('aria-invalid', 'true')
    else trigger.removeAttribute('aria-invalid')
    if (!menu.open) trigger.removeAttribute('aria-activedescendant')
  }
  if (list) {
    const doc = globalThis.document
    const nodes = choices.map((choice, index) => {
      const id = characterComboboxOptionId(spec.optionPrefix, choice.value)
      let option = byId(id)
      if (!option && typeof doc?.createElement === 'function') {
        option = doc.createElement('li')
        option.id = id
        option.setAttribute?.('id', id)
      }
      if (!option) return null
      option.setAttribute('role', 'option')
      option.dataset.value = choice.value
      option.setAttribute('data-value', choice.value)
      option.textContent = choice.text
      option.setAttribute('aria-selected', String(choice.value === selectedValue))
      option.classList.toggle('is-active', menu.open && index === menu.active)
      return option
    }).filter(Boolean)
    if (typeof list.replaceChildren === 'function') list.replaceChildren(...nodes)
    list.hidden = !menu.open
    list.classList?.toggle?.('is-scrollable', Boolean(spec.scrollable))
    const active = choices[menu.active]
    if (trigger && menu.open && active) {
      trigger.setAttribute('aria-activedescendant', characterComboboxOptionId(spec.optionPrefix, active.value))
      const activeNode = byId(characterComboboxOptionId(spec.optionPrefix, active.value))
      scrollOptionIntoList(list, activeNode)
    }
    if (menu.open) placeComboboxList(kind)
    else clearListPlacement(list)
  }
}

export function openCharacterCombobox(kind, { editable = true, invalid = false } = {}) {
  if (characterComboboxDisabled(kind)) return
  const spec = registry[kind]
  const select = byId(spec.select)
  const trigger = byId(spec.trigger)
  const choices = readSelectOptions(select)
  closeAllCharacterComboboxes({ except: kind })
  const menu = menus[kind]
  menu.open = true
  menu.active = Math.max(0, choices.findIndex((choice) => choice.value === (select?.value ?? '')))
  syncCharacterCombobox(kind, { editable, invalid })
  focusWithoutScroll(trigger)
}

export function commitCharacterCombobox(kind, value, { normalize, invalid = false } = {}) {
  const spec = registry[kind]
  const select = byId(spec.select)
  closeCharacterCombobox(kind, { restoreFocus: true })
  if (!select || characterComboboxDisabled(kind)) return
  const next = typeof normalize === 'function' ? normalize(value) : value
  if (select.value !== String(next ?? '')) {
    select.value = next
    select.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    syncCharacterCombobox(kind, { editable: true, invalid })
  }
}

export function bindCharacterComboboxKinds(kinds, { editableOf, invalidOf, normalizeOf } = {}) {
  const doc = globalThis.document
  for (const kind of kinds) {
    const spec = registry[kind]
    if (!spec) continue
    const trigger = byId(spec.trigger)
    const list = byId(spec.list)
    const menu = menus[kind]
    if (trigger && boundTriggers) {
      if (boundTriggers.has(trigger)) continue
      boundTriggers.add(trigger)
    }
    trigger?.addEventListener('click', (event) => {
      if (characterComboboxDisabled(kind)) return
      event.preventDefault()
      if (menu.open) closeCharacterCombobox(kind)
      else openCharacterCombobox(kind, { editable: true, invalid: invalidOf?.(kind) })
    })
    trigger?.addEventListener('keydown', (event) => {
      if (characterComboboxDisabled(kind)) return
      const key = event.key
      const select = byId(spec.select)
      if (key === 'Tab') {
        closeCharacterCombobox(kind)
        return
      }
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Spacebar'].includes(key)) {
        event.preventDefault()
        if (!menu.open) {
          openCharacterCombobox(kind, { editable: true, invalid: invalidOf?.(kind) })
          if (key === 'ArrowUp') {
            menu.active = Math.max(0, readSelectOptions(select).length - 1)
            syncCharacterCombobox(kind, { editable: true, invalid: invalidOf?.(kind) })
          }
          return
        }
      }
      if (!menu.open) return
      const choices = readSelectOptions(select)
      if (key === 'ArrowDown') {
        event.preventDefault()
        menu.active = Math.min(choices.length - 1, menu.active + 1)
        syncCharacterCombobox(kind, { editable: true, invalid: invalidOf?.(kind) })
      } else if (key === 'ArrowUp') {
        event.preventDefault()
        menu.active = Math.max(0, menu.active - 1)
        syncCharacterCombobox(kind, { editable: true, invalid: invalidOf?.(kind) })
      } else if (key === 'Home') {
        event.preventDefault()
        menu.active = 0
        syncCharacterCombobox(kind, { editable: true, invalid: invalidOf?.(kind) })
      } else if (key === 'End') {
        event.preventDefault()
        menu.active = Math.max(0, choices.length - 1)
        syncCharacterCombobox(kind, { editable: true, invalid: invalidOf?.(kind) })
      } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        event.preventDefault()
        commitCharacterCombobox(kind, choices[menu.active]?.value, {
          normalize: normalizeOf?.(kind),
          invalid: invalidOf?.(kind),
        })
      } else if (key === 'Escape') {
        event.preventDefault()
        closeCharacterCombobox(kind, { restoreFocus: true })
      }
    })
    list?.addEventListener('click', (event) => {
      if (characterComboboxDisabled(kind)) return
      const option = characterComboboxOptionFromEvent(event)
      if (!option) return
      const value = option.dataset?.value || option.getAttribute?.('data-value')
      event.preventDefault()
      commitCharacterCombobox(kind, value, {
        normalize: normalizeOf?.(kind),
        invalid: invalidOf?.(kind),
      })
    })
    list?.addEventListener('mousemove', (event) => {
      if (!menu.open || characterComboboxDisabled(kind)) return
      const option = characterComboboxOptionFromEvent(event)
      const value = option?.dataset?.value || option?.getAttribute?.('data-value')
      if (value == null) return
      const index = readSelectOptions(byId(spec.select)).findIndex((choice) => choice.value === value)
      if (index < 0 || index === menu.active) return
      menu.active = index
      syncCharacterCombobox(kind, { editable: true, invalid: invalidOf?.(kind) })
    })
  }
  const alreadyBound = pointerDocs ? pointerDocs.has(doc) : pointerBound
  if (!alreadyBound && typeof doc?.addEventListener === 'function') {
    if (pointerDocs && doc) pointerDocs.add(doc)
    else pointerBound = true
    doc.addEventListener('pointerdown', (event) => {
      const openKind = Object.keys(registry).find((kind) => menus[kind]?.open)
      if (!openKind) return
      const spec = registry[openKind]
      const trigger = byId(spec.trigger)
      const list = byId(spec.list)
      const path = event.target
      if (trigger && (path === trigger || trigger.contains?.(path))) return
      if (list && (path === list || list.contains?.(path))) return
      closeAllCharacterComboboxes()
    })
  }
  const geometryAlready = geometryDocs ? geometryDocs.has(doc) : geometryBound
  if (!geometryAlready && typeof doc?.addEventListener === 'function') {
    if (geometryDocs && doc) geometryDocs.add(doc)
    else geometryBound = true
    const reposition = (event) => {
      const target = event?.target
      if (target && target.classList?.contains?.('character-ai-combobox-list')) return
      const openKind = Object.keys(registry).find((kind) => menus[kind]?.open)
      if (!openKind) return
      placeComboboxList(openKind)
    }
    doc.addEventListener('scroll', reposition, true)
    globalThis.window?.addEventListener?.('resize', reposition)
  }
}

export const CHARACTER_COMBOBOX_CARET_PATH = 'M5 8l5 5 5-5'
