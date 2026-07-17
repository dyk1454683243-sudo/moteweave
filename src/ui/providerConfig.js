import { $, showToast } from './dom.js'

export const DEFAULT_RUNTIME_MODELS = {
  openrouter: 'google/gemini-2.5-flash-image',
  openrouter_compatible: 'provider/model-name',
  gemini: 'gemini-3.1-flash-image-preview',
}

export const CUSTOM_COMPATIBLE_PROVIDER = 'openrouter_compatible'

const EYE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>`

const EYE_OFF_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m2 2 20 20"></path>
    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path>
    <path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c6.5 0 10 8 10 8a16.6 16.6 0 0 1-2.2 3.2"></path>
    <path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 8 10 8a10.7 10.7 0 0 0 4.5-1"></path>
  </svg>`

export function setProviderText(selector, message) {
  const element = $(selector)
  if (element) element.textContent = message
}

function setApiKeyVisible(config, visible) {
  const input = $(config.apiKeySelector)
  const button = $(config.toggleSelector)
  if (!input || !button) return
  input.type = visible ? 'text' : 'password'
  button.innerHTML = visible ? EYE_OFF_ICON : EYE_ICON
  button.setAttribute('aria-pressed', String(visible))
  button.setAttribute('aria-label', visible ? 'Hide API key' : 'Show API key')
  button.title = visible ? 'Hide API key' : 'Show API key'
}

function initApiKeyVisibilityToggle(config) {
  const button = $(config.toggleSelector)
  if (!button) return
  setApiKeyVisible(config, false)
  button.addEventListener('click', () => {
    setApiKeyVisible(config, $(config.apiKeySelector)?.type !== 'text')
  })
}

function runtimeProviderPayload(config) {
  const provider = $(config.providerSelector)?.value || 'openrouter'
  return {
    provider,
    model: ($(config.modelSelector)?.value || '').trim(),
    apiKey: ($(config.apiKeySelector)?.value || '').trim(),
    baseUrl: provider === CUSTOM_COMPATIBLE_PROVIDER ? ($(config.baseUrlSelector)?.value || '').trim() : '',
  }
}

function updateRuntimeProviderFields(config) {
  const provider = $(config.providerSelector)?.value || 'openrouter'
  const modelInput = $(config.modelSelector)
  const baseUrlField = $(config.baseUrlFieldSelector)
  if (modelInput) modelInput.placeholder = DEFAULT_RUNTIME_MODELS[provider] || DEFAULT_RUNTIME_MODELS.openrouter
  if (baseUrlField) baseUrlField.hidden = provider !== CUSTOM_COMPATIBLE_PROVIDER
}

export async function postProviderConfig(payload) {
  const response = await fetch('/api/provider-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.reason || body.error || `provider config failed: ${response.status}`)
  return body.provider_state
}

export async function fetchProviderState() {
  const response = await fetch('/api/gemini-state')
  return response.json()
}

async function saveRuntimeProviderConfig(config) {
  const button = $(config.saveSelector)
  const keyInput = $(config.apiKeySelector)
  const payload = runtimeProviderPayload(config)
  if (!payload.model || !payload.apiKey) {
    setProviderText(config.statusSelector, 'Model and API key are required')
    return
  }
  if (payload.provider === CUSTOM_COMPATIBLE_PROVIDER && !payload.baseUrl) {
    setProviderText(config.statusSelector, 'Base URL is required for compatible API')
    return
  }
  if (button) button.disabled = true
  setProviderText(config.statusSelector, 'Saving provider...')
  try {
    const provider = await postProviderConfig(payload)
    if (keyInput) keyInput.value = ''
    config.onProviderState?.(provider)
    showToast(config.saveToastMessage || 'Provider ready')
  } catch (error) {
    setProviderText(config.statusSelector, error.message)
    showToast(error.message)
  } finally {
    if (button) button.disabled = false
  }
}

async function clearRuntimeProviderConfig(config) {
  const button = $(config.clearSelector)
  if (button) button.disabled = true
  setProviderText(config.statusSelector, 'Clearing provider...')
  try {
    const provider = await postProviderConfig({ clear: true })
    config.onProviderState?.(provider)
    showToast(config.clearToastMessage || 'Provider cleared')
  } catch (error) {
    setProviderText(config.statusSelector, error.message)
    showToast(error.message)
  } finally {
    if (button) button.disabled = false
  }
}

export function initProviderConfigSurface(config) {
  updateRuntimeProviderFields(config)
  initApiKeyVisibilityToggle(config)
  $(config.providerSelector)?.addEventListener('change', () => updateRuntimeProviderFields(config))
  $(config.saveSelector)?.addEventListener('click', () => saveRuntimeProviderConfig(config))
  $(config.clearSelector)?.addEventListener('click', () => clearRuntimeProviderConfig(config))
}
