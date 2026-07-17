export const $ = (selector, root = document) => root.querySelector(selector)

export function button(label, className = '', disabled = false) {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  if (className) node.className = className
  node.disabled = disabled
  return node
}

export function keyValue(label, value) {
  const row = document.createElement('div')
  row.className = 'editor-kv'
  const key = document.createElement('span')
  key.textContent = label
  const val = document.createElement('strong')
  val.textContent = value == null || value === '' ? '-' : String(value)
  row.append(key, val)
  return row
}

export function linkList(links) {
  const list = document.createElement('div')
  list.className = 'editor-repair-links'
  for (const [label, url] of links.filter(([, value]) => Boolean(value))) {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.target = '_blank'
    anchor.rel = 'noreferrer'
    anchor.textContent = label
    list.append(anchor)
  }
  return list
}

export function controlInline(label, input) {
  const wrap = document.createElement('label')
  wrap.className = 'editor-inline-control'
  const text = document.createElement('span')
  text.textContent = label
  wrap.append(input, text)
  return wrap
}

export function numberControl(label, value, { min, max, step = 1, disabled = false, onChange }) {
  const wrap = document.createElement('label')
  wrap.className = 'editor-field'
  const text = document.createElement('span')
  text.textContent = label
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(value ?? 0)
  input.step = String(step)
  if (min != null) input.min = String(min)
  if (max != null) input.max = String(max)
  input.disabled = disabled
  input.addEventListener('change', () => onChange(Number(input.value)))
  wrap.append(text, input)
  return wrap
}

export function rangeControl(label, value, { min = 0, max = 1, step = 0.01, disabled = false, onChange }) {
  const wrap = document.createElement('label')
  wrap.className = 'editor-field'
  const text = document.createElement('span')
  text.textContent = label
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value ?? 1)
  input.disabled = disabled
  input.addEventListener('change', () => onChange(Number(input.value)))
  wrap.append(text, input)
  return wrap
}

export function checkboxControl(label, checked, { disabled = false, onChange }) {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = Boolean(checked)
  input.disabled = disabled
  input.addEventListener('change', () => onChange(input.checked))
  return controlInline(label, input)
}

export function selectControl(label, value, options, { disabled = false, onChange }) {
  const wrap = document.createElement('label')
  wrap.className = 'editor-field'
  const text = document.createElement('span')
  text.textContent = label
  const select = document.createElement('select')
  for (const option of options) {
    const node = document.createElement('option')
    if (typeof option === 'string') {
      node.value = option
      node.textContent = option
    } else {
      node.value = option.value
      node.textContent = option.label
    }
    select.append(node)
  }
  select.value = value ?? ''
  select.disabled = disabled
  select.addEventListener('change', () => onChange(select.value))
  wrap.append(text, select)
  return wrap
}

export function textControl(label, value, { disabled = false, placeholder = '', onChange }) {
  const wrap = document.createElement('label')
  wrap.className = 'editor-field'
  const text = document.createElement('span')
  text.textContent = label
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value == null ? '' : String(value)
  input.placeholder = placeholder
  input.disabled = disabled
  input.addEventListener('change', () => onChange(input.value.trim()))
  wrap.append(text, input)
  return wrap
}
