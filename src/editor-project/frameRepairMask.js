const MASK_ERROR_CODE = 'invalid_frame_repair_mask'
const MASK_EDIT_KEYS = Object.freeze(['op', 'x', 'y', 'width', 'height'])
const MAX_MASK_EDITS = 64

function invalidMask(message, ErrorType = TypeError) {
  const error = new ErrorType(message)
  error.code = MASK_ERROR_CODE
  return error
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertDimensions(width, height) {
  if (!Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0 ||
      !Number.isSafeInteger(width * height)) {
    throw invalidMask('frame mask dimensions are invalid')
  }
  return width * height
}

function assertBinaryBits(bits, expectedLength = null) {
  if (!(bits instanceof Uint8Array) ||
      (expectedLength != null && bits.length !== expectedLength)) {
    throw invalidMask('frame mask bits are invalid')
  }
  for (const value of bits) {
    if (value !== 0 && value !== 1) {
      throw invalidMask('frame mask bits must be binary')
    }
  }
}

function indexFor(width, x, y) {
  return y * width + x
}

function hasTransparentNeighbor(image, x, y) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) return true
    if (image.data[indexFor(image.width, nx, ny) * 4 + 3] === 0) return true
  }
  return false
}

function visibleComponents(image) {
  const visited = new Uint8Array(image.width * image.height)
  const components = []
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const start = indexFor(image.width, x, y)
      if (visited[start] || image.data[start * 4 + 3] === 0) continue
      visited[start] = 1
      const queue = [start]
      const pixels = []
      let minX = x
      let minY = y
      let maxX = x
      let maxY = y
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor]
        const currentX = current % image.width
        const currentY = Math.floor(current / image.width)
        pixels.push(current)
        minX = Math.min(minX, currentX)
        minY = Math.min(minY, currentY)
        maxX = Math.max(maxX, currentX)
        maxY = Math.max(maxY, currentY)
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue
            const nx = currentX + dx
            const ny = currentY + dy
            if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue
            const neighbor = indexFor(image.width, nx, ny)
            if (visited[neighbor] || image.data[neighbor * 4 + 3] === 0) continue
            visited[neighbor] = 1
            queue.push(neighbor)
          }
        }
      }
      components.push({ pixels, minX, minY, maxX, maxY })
    }
  }
  return components
}

function dilateEightNeighbors(bits, width, height) {
  const expanded = new Uint8Array(bits)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!bits[indexFor(width, x, y)]) continue
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
            expanded[indexFor(width, nx, ny)] = 1
          }
        }
      }
    }
  }
  return expanded
}

function assertMaskEdit(edit, width, height) {
  if (!isPlainRecord(edit) ||
      Object.keys(edit).length !== MASK_EDIT_KEYS.length ||
      !MASK_EDIT_KEYS.every((key) => Object.hasOwn(edit, key)) ||
      (edit.op !== 'add_rectangle' && edit.op !== 'remove_rectangle') ||
      !Number.isSafeInteger(edit.x) || edit.x < 0 ||
      !Number.isSafeInteger(edit.y) || edit.y < 0 ||
      !Number.isSafeInteger(edit.width) || edit.width <= 0 ||
      !Number.isSafeInteger(edit.height) || edit.height <= 0) {
    throw invalidMask('frame mask edit is invalid')
  }
  if (edit.width > width || edit.height > height ||
      edit.x > width - edit.width || edit.y > height - edit.height) {
    throw invalidMask('frame mask rectangle is outside the frame', RangeError)
  }
}

export function deriveFrameRepairBaseMask(image) {
  const pixelCount = assertDimensions(image?.width, image?.height)
  if (!(image.data instanceof Uint8ClampedArray) || image.data.length !== pixelCount * 4) {
    throw invalidMask('frame RGBA input is invalid')
  }

  const diagnosticBits = new Uint8Array(pixelCount)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = indexFor(image.width, x, y)
      const offset = index * 4
      const alpha = image.data[offset + 3]
      const nearWhite = image.data[offset] >= 240 &&
        image.data[offset + 1] >= 240 &&
        image.data[offset + 2] >= 240
      if (alpha > 0 && (alpha < 255 || nearWhite) && hasTransparentNeighbor(image, x, y)) {
        diagnosticBits[index] = 1
      }
    }
  }

  const components = visibleComponents(image)
  const largestSize = components.reduce((largest, component) => Math.max(largest, component.pixels.length), 0)
  for (const component of components) {
    if (component.pixels.length < 2 || component.pixels.length >= largestSize) continue
    for (const index of component.pixels) diagnosticBits[index] = 1
  }

  const bits = dilateEightNeighbors(diagnosticBits, image.width, image.height)
  const activePixelCount = bits.reduce((sum, value) => sum + value, 0)
  let suggestedRectangle = null
  if (activePixelCount === 0 && components.length > 0) {
    const subject = components.find((component) => component.pixels.length === largestSize)
    suggestedRectangle = {
      x: subject.minX,
      y: subject.minY,
      width: subject.maxX - subject.minX + 1,
      height: subject.maxY - subject.minY + 1,
    }
  }
  return {
    mode: activePixelCount > 0 ? 'localized_diagnostic' : 'needs_scope',
    bits,
    activePixelCount,
    suggestedRectangle,
  }
}

export function applyFrameRepairMaskEdits(baseBits, width, height, edits) {
  const pixelCount = assertDimensions(width, height)
  assertBinaryBits(baseBits, pixelCount)
  if (!Array.isArray(edits) || edits.length > MAX_MASK_EDITS) {
    throw invalidMask('frame mask edits are invalid')
  }
  for (const edit of edits) assertMaskEdit(edit, width, height)

  const output = new Uint8Array(baseBits)
  for (const edit of edits) {
    const value = edit.op === 'add_rectangle' ? 1 : 0
    for (let y = edit.y; y < edit.y + edit.height; y += 1) {
      for (let x = edit.x; x < edit.x + edit.width; x += 1) {
        output[indexFor(width, x, y)] = value
      }
    }
  }
  return output
}

export function maskBitsToRuns(bits) {
  assertBinaryBits(bits)
  const runs = []
  for (let index = 0; index < bits.length;) {
    if (bits[index] === 0) {
      index += 1
      continue
    }
    const start = index
    while (index < bits.length && bits[index] === 1) index += 1
    runs.push({ start, length: index - start })
  }
  return runs
}
