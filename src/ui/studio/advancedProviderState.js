const ADVANCED_PROVIDER_ROUTES = new Set(['openrouter', 'openrouter_compatible'])

export function isAdvancedProviderRoute(value) {
  return ADVANCED_PROVIDER_ROUTES.has(String(value ?? ''))
}

export function advancedProviderRouteForState(provider = {}, selectedRoute = null) {
  if (String(provider?.provider ?? '') !== 'openrouter') return ''
  if (isAdvancedProviderRoute(selectedRoute)) return String(selectedRoute)
  return ''
}

export function advancedProviderRouteIsUndisclosed(provider = {}, selectedRoute = null) {
  return provider?.available === true &&
    String(provider?.provider ?? '') === 'openrouter' &&
    !isAdvancedProviderRoute(selectedRoute)
}

export function clearAdvancedProviderSecret(control) {
  if (control) control.value = ''
}
