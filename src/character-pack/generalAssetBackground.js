export const GENERAL_ASSET_BACKGROUNDS = Object.freeze({
  auto: Object.freeze({ id: 'auto', name: 'auto', hex: null, r: null, g: null, b: null }),
  white: Object.freeze({ id: 'white', name: 'white', hex: '#ffffff', r: 255, g: 255, b: 255 }),
  green: Object.freeze({ id: 'green', name: 'green', hex: '#00ff00', r: 0, g: 255, b: 0 }),
  magenta: Object.freeze({ id: 'magenta', name: 'magenta', hex: '#ff00ff', r: 255, g: 0, b: 255 }),
  purple: Object.freeze({ id: 'purple', name: 'purple', hex: '#8000ff', r: 128, g: 0, b: 255 }),
})

export function generalAssetBackground(id = 'auto') {
  const key = id == null || id === '' ? 'auto' : String(id)
  const color = GENERAL_ASSET_BACKGROUNDS[key]
  if (!color) {
    const error = new Error('General asset background must be auto, white, green, magenta, or purple.')
    error.code = 'invalid_request'
    throw error
  }
  return color
}

export function generalAssetBackgroundClause(id = 'green') {
  const resolved = id == null || id === '' || id === 'auto' ? 'green' : id
  const color = generalAssetBackground(resolved)
  const target = color.hex ? color : GENERAL_ASSET_BACKGROUNDS.green
  return `Background: pure ${target.name} ${target.hex} only, no checkerboard, gradient, shadow, scenery, ground, or texture. Do not paint the subject with ${target.hex}.`
}
