import { buildManualOverrides } from '../../character-pack/gridAdjustment.js'
import { state } from '../appState.js'
import { $, clamp } from '../dom.js'

export function makeEvenCutLines(width, height) {
  return {
    width,
    height,
    verticalLines: Array.from({ length: 7 }, (_, i) => Math.round(((i + 1) * width) / 8)),
    horizontalLines: Array.from({ length: 7 }, (_, i) => Math.round(((i + 1) * height) / 8)),
  }
}

export function setManualCutLinesEnabled(enabled) {
  state.characterPack.useManualCutLines = enabled
  $('#character-pack-auto-grid').classList.toggle('active', !enabled)
  $('#character-pack-manual-grid').classList.toggle('active', enabled)
  renderCutLines()
}

function renderCutLines() {
  const layer = $('#character-pack-cutline-layer')
  if (!layer) return
  layer.innerHTML = ''
  const cuts = state.characterPack.manualCutLines
  const enabled = state.characterPack.useManualCutLines && cuts
  layer.hidden = !enabled
  if (!enabled) return

  cuts.verticalLines.forEach((line, index) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'cutline vertical'
    element.style.left = `${(line / cuts.width) * 100}%`
    element.setAttribute('aria-label', `vertical cut line ${index + 1}`)
    element.addEventListener('pointerdown', (event) => startCutLineDrag(event, 'vertical', index))
    layer.append(element)
  })
  cuts.horizontalLines.forEach((line, index) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'cutline horizontal'
    element.style.top = `${(line / cuts.height) * 100}%`
    element.setAttribute('aria-label', `horizontal cut line ${index + 1}`)
    element.addEventListener('pointerdown', (event) => startCutLineDrag(event, 'horizontal', index))
    layer.append(element)
  })
}

function startCutLineDrag(event, axis, index) {
  event.preventDefault()
  const image = $('#character-pack-source-preview')
  const cuts = state.characterPack.manualCutLines
  if (!cuts || image.hidden) return

  const update = (moveEvent) => {
    const rect = image.getBoundingClientRect()
    if (axis === 'vertical') {
      const previous = index === 0 ? 0 : cuts.verticalLines[index - 1]
      const next = index === cuts.verticalLines.length - 1 ? cuts.width : cuts.verticalLines[index + 1]
      const sourceX = Math.round(((moveEvent.clientX - rect.left) / rect.width) * cuts.width)
      cuts.verticalLines[index] = clamp(sourceX, previous + 1, next - 1)
    } else {
      const previous = index === 0 ? 0 : cuts.horizontalLines[index - 1]
      const next = index === cuts.horizontalLines.length - 1 ? cuts.height : cuts.horizontalLines[index + 1]
      const sourceY = Math.round(((moveEvent.clientY - rect.top) / rect.height) * cuts.height)
      cuts.horizontalLines[index] = clamp(sourceY, previous + 1, next - 1)
    }
    renderCutLines()
  }

  const stop = () => {
    document.removeEventListener('pointermove', update)
    document.removeEventListener('pointerup', stop)
  }

  document.addEventListener('pointermove', update)
  document.addEventListener('pointerup', stop, { once: true })
}

export function resetManualCutLines(onStatus = () => {}) {
  const size = state.characterPack.sourceSize
  if (!size) return
  state.characterPack.manualCutLines = makeEvenCutLines(size.width, size.height)
  setManualCutLinesEnabled(false)
  onStatus('已重置为自动网格', 'ready')
}

export function getManualOverridesForRequest() {
  const cuts = state.characterPack.manualCutLines
  if (!state.characterPack.useManualCutLines || !cuts) return null
  return buildManualOverrides(cuts)
}
