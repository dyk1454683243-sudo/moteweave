import { t } from './i18n.js'

export const $ = (selector, root = document) => root.querySelector(selector)

function clearI18nVariables(element) {
  for (const attribute of [...(element.attributes ?? [])]) {
    if (attribute.name.startsWith('data-i18n-var-')) element.removeAttribute(attribute.name)
  }
}

export function setPlainText(target, message) {
  const element = typeof target === 'string' ? $(target) : target
  if (!element) return
  element.removeAttribute?.('data-i18n')
  clearI18nVariables(element)
  element.textContent = String(message ?? '')
}

export function setLocalizedText(target, key, replacements = {}) {
  const element = typeof target === 'string' ? $(target) : target
  if (!element) return
  element.dataset.i18n = key
  clearI18nVariables(element)
  for (const [name, value] of Object.entries(replacements)) {
    const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!safeName) continue
    element.setAttribute(`data-i18n-var-${safeName}`, String(value ?? ''))
  }
  element.textContent = t(key, replacements)
}

export function showToast(message) {
  const toast = $('#toast')
  toast.textContent = message
  toast.classList.add('visible')
  window.setTimeout(() => toast.classList.remove('visible'), 1800)
}

export function fillSelect(select, options) {
  select.innerHTML = ''
  Object.entries(options).forEach(([value, option]) => {
    const element = document.createElement('option')
    element.value = value
    element.textContent = typeof option === 'string' ? option : option.title
    select.append(element)
  })
}

export function setPreviewImage(selector, url) {
  const image = $(selector)
  if (!url) {
    image.hidden = true
    image.removeAttribute('src')
    return
  }
  image.hidden = false
  image.src = url
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => resolve({ image, url })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t('shared.error.imageRead', { name: file.name })))
    }
    image.src = url
  })
}

export async function fileToBase64(file) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(t('shared.error.resultRead', { status: response.status }))
  return response.json()
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t('shared.error.pngExport')))),
      'image/png',
    )
  })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
