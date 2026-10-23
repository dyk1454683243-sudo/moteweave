import { renderPixelDrawing } from '../../editor-project/pixelDrawing.js'
import { isBlankSpriteDocument } from '../../editor-project/pixelDocumentOrigin.js'

export function isEmptyNativeDrawingTarget(manifest, source, size) {
  return isBlankSpriteDocument(manifest) && [32, 64].includes(size)
    && manifest.frame_order?.length === 1 && manifest.layer_order?.length === 1
    && !manifest.layers?.[manifest.layer_order[0]]?.locked && manifest.layers?.[manifest.layer_order[0]]?.visible !== false
    && !manifest.text_objects?.items?.length
    && source?.width === size && source?.height === size && !source.allowedRect && !source.multiCel
    && source.rgba instanceof Uint8Array && source.rgba.length === size * size * 4
    && source.rgba.every((value, index) => index % 4 !== 3 || value === 0)
}

export async function pixelDrawingPng(drawing, size, base = null) {
  const rgba = renderPixelDrawing(drawing, size, base)
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const context = canvas.getContext('2d')
  const image = context.createImageData(size, size)
  image.data.set(rgba); context.putImageData(image, 0, 0)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw Object.assign(new Error('The pixel drawing could not be encoded. No image was saved.'), { code: 'pixel_encoding_failed' })
  return new Uint8Array(await blob.arrayBuffer())
}
