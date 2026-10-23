import gifenc from 'gifenc'

const { GIFEncoder, applyPalette, quantize } = gifenc

export function writeGifFrameFromRgba(gif, frame, { delay = 100 } = {}) {
  const palette = quantize(frame.data, 255, {
    format: 'rgba4444',
    oneBitAlpha: 128,
    clearAlpha: true,
    clearAlphaThreshold: 128,
  })
  const index = applyPalette(frame.data, palette, 'rgba4444')
  const transparentIndex = palette.findIndex((color) => color[3] === 0)
  const hasTransparency = transparentIndex >= 0
  gif.writeFrame(index, frame.width, frame.height, {
    palette,
    delay,
    ...(hasTransparency ? { transparent: true, transparentIndex } : { transparent: false }),
  })
  return { hasTransparency, transparentIndex }
}

export function encodeGifFromRgbaFrames(frames, { delay = 100 } = {}) {
  if (frames.length === 0) throw new Error('Cannot encode empty GIF')
  const gif = GIFEncoder()
  for (const frame of frames) {
    writeGifFrameFromRgba(gif, frame, { delay })
  }
  gif.finish()
  return Buffer.from(gif.bytes())
}
