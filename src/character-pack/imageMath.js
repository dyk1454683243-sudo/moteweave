export function pixelOffset(width, x, y) {
  return (y * width + x) * 4
}

export function colorDistanceSq(data, offset, rgb) {
  const dr = data[offset] - rgb[0]
  const dg = data[offset + 1] - rgb[1]
  const db = data[offset + 2] - rgb[2]
  return dr * dr + dg * dg + db * db
}

export function cloneRgba(image) {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) }
}
