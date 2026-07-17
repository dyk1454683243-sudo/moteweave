function sortPlain(value) {
  if (Array.isArray(value)) return value.map(sortPlain)
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return value
  }
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortPlain(value[key])]),
  )
}

export function serializeCanonicalRecipe(recipe) {
  return new TextEncoder().encode(JSON.stringify(sortPlain(recipe)))
}

export function createDraftSettingsHashInput(recipe) {
  return { ...structuredClone(recipe), implementation_revision: null }
}
