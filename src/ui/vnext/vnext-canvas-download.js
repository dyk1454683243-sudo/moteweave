export async function selectedCanvasPng(canvas, { createCanvas = () => document.createElement('canvas'),
  loadPixels,
  loadImage = src => new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The selected image could not be read.'))
    image.src = src
  }) } = {}) {
  if (!canvas || canvas.transient || !Number.isInteger(canvas.width) || !Number.isInteger(canvas.height)
    || canvas.width < 1 || canvas.height < 1 || canvas.width > 4096 || canvas.height > 4096
    || (!canvas.preview && !canvas.previewUrl)) throw new Error('Select a saved canvas to download.')
  let blob
  if (loadPixels) {
    const bytes = await loadPixels()
    blob = await savedPixelsPng(canvas.width, canvas.height, bytes)
  } else {
  const output = createCanvas()
  output.width = canvas.width; output.height = canvas.height
  const context = output.getContext('2d')
  context.imageSmoothingEnabled = false
  context.drawImage(canvas.previewUrl ? await loadImage(canvas.previewUrl) : canvas.preview, 0, 0, canvas.width, canvas.height)
  blob = await new Promise((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed.')), 'image/png'))
  }
  const name = String(canvas.name || 'Canvas').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100).replace(/\.(png|jpe?g)$/i, '') || 'Canvas'
  return { blob, filename: `${name}.png` }
}

// Encode saved RGBA directly: Canvas readback changes low-alpha RGB values.
export async function savedPixelsPng(width, height, bytes) {
  return encodeSavedRgba(width, height, bytes, 4096)
}

export async function savedSheetPng(width, height, bytes) {
  return encodeSavedRgba(width, height, bytes, 4096)
}

async function encodeSavedRgba(width, height, bytes, maxEdge) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > maxEdge || height > maxEdge || !(bytes instanceof Uint8Array)
    || bytes.length !== width * height * 4) throw new Error('Saved pixels could not be verified for PNG export.')
  const chunk = (type, data) => {
    const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4); out.set(data, 8)
    let crc = 0xffffffff
    for (let i = 4; i < out.length - 4; i++) {
      crc ^= out[i]
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0)
    return out
  }
  const header = new Uint8Array(13), dimensions = new DataView(header.buffer)
  dimensions.setUint32(0, width); dimensions.setUint32(4, height); header[8] = 8; header[9] = 6
  const stride = width * 4, rows = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) rows.set(bytes.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const compressed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  return new Blob([new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())], { type: 'image/png' })
}
