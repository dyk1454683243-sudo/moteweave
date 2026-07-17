import { $ } from '../dom.js'
import {
  fetchProviderState,
  initProviderConfigSurface,
  setProviderText,
} from '../providerConfig.js'
import { renderProviderPresetOptions } from './controls.js'

export function applyProviderState(provider) {
  const button = $('#generate-character-pack')
  renderProviderPresetOptions(provider)
  if (button) button.disabled = !provider.available || !provider.implemented
  if (!provider.implemented) {
    setProviderText('#gemini-state', 'AI 生成未实现：当前处理上传图片')
  } else if (provider.status === 'validating') {
    setProviderText('#gemini-state', '检查 AI 状态...')
  } else if (provider.status === 'configuration_error') {
    setProviderText('#gemini-state', `AI 配置错误：${provider.error || '检查 provider 设置'}`)
  } else if (provider.available) {
    setProviderText('#gemini-state', provider.runtime_configured ? 'AI 已配置：Browser session' : 'AI 已配置：Local environment')
  } else {
    setProviderText('#gemini-state', 'AI 未配置：当前处理上传图片')
  }
  setProviderText(
    '#character-pack-provider-config-status',
    provider.runtime_configured
      ? 'Browser session provider active'
      : (provider.available ? 'Local environment provider active' : 'Local session provider not set')
  )
}

export function initProviderConfigControls() {
  initProviderConfigSurface({
    providerSelector: '#character-pack-runtime-provider',
    modelSelector: '#character-pack-runtime-model',
    baseUrlFieldSelector: '#character-pack-runtime-base-url-field',
    baseUrlSelector: '#character-pack-runtime-base-url',
    apiKeySelector: '#character-pack-runtime-api-key',
    toggleSelector: '#character-pack-toggle-api-key',
    saveSelector: '#character-pack-save-provider-config',
    clearSelector: '#character-pack-clear-provider-config',
    statusSelector: '#character-pack-provider-config-status',
    onProviderState: applyProviderState,
  })
}

export async function refreshGeminiState() {
  try {
    const provider = await fetchProviderState()
    applyProviderState(provider)
  } catch {
    setProviderText('#gemini-state', 'AI 状态不可用')
  }
}
