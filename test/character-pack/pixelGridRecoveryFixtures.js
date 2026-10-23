export const SEED_A = 0xA11CE
export const SEED_B = 0xB07E
export const CALIBRATION_LOGICAL = 24
export const HELD_OUT_LOGICAL = 32

const PALETTE = Object.freeze([
  [28, 32, 46, 255],
  [70, 130, 210, 255],
  [210, 72, 54, 255],
  [238, 196, 78, 255],
  [88, 172, 102, 255],
  [240, 240, 236, 255],
  [24, 24, 32, 255],
  [16, 16, 20, 255],
])

const F1_CELLS = Object.freeze([2, 3, 4, 6, 8, 12, 16, 24])
const F2_SCALES = Object.freeze([2.5, 3.5, 4.25, 5.5, 5.82, 7.33, 10.67])
const F3_CONTAMINATIONS = Object.freeze(['aa-one-sided', 'aa-symmetric', 'alpha-fringe', 'block-noise', 'hidden-rgb', 'display-outline'])
const F5_VARIANTS = Object.freeze(['identical', 'display-shift', 'whole-cell-shift', 'limb', 'outlier', 'frame-noise'])
const F6_KINDS = Object.freeze(['planar-sprite', 'radial-sprite', 'vector-shade', 'noise', 'sparse-noise', 'blurred-shapes'])

export function mixHash(x, y, seed) {
  let n = (Math.imul(x + 1, 0x9E3779B1) ^ Math.imul(y + 1, 0x85EBCA6B) ^ (seed >>> 0)) >>> 0
  n = Math.imul(n ^ (n >>> 16), 0x7FEB352D)
  return (n ^ (n >>> 15)) >>> 0
}

function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const offset = (y * image.width + x) * 4
  image.data[offset] = color[0]
  image.data[offset + 1] = color[1]
  image.data[offset + 2] = color[2]
  image.data[offset + 3] = color[3] ?? 255
}

function getPixel(image, x, y) {
  const offset = (y * image.width + x) * 4
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]]
}

function cloneImage(image) {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) }
}

export function makeNoiseImage(width = 48, height = 48, seed = 0) {
  const image = blank(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(image, x, y, [
        (x * 37 + y * 19 + seed) % 256,
        (x * 11 + y * 53 + 7 + seed) % 256,
        (x * 71 + y * 5 + 13 + seed) % 256,
        255,
      ])
    }
  }
  return image
}

export function makeSparseNoiseSprite(width = 64, height = 64, seed = 0) {
  const image = blank(width, height)
  for (let y = 8; y < height - 8; y += 1) {
    for (let x = 8; x < width - 8; x += 1) {
      if ((x * 17 + y * 29 + seed) % 7 > 3) continue
      setPixel(image, x, y, [
        (x * 31 + y * 7 + seed) % 256,
        (x * 5 + y * 43 + seed) % 256,
        (x * 19 + y * 13 + seed) % 256,
        255,
      ])
    }
  }
  return image
}

export function makePlanarGradient(size = 64) {
  const image = blank(size, size)
  const last = size - 1
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      setPixel(image, x, y, [
        Math.round(255 * x / last),
        Math.round(255 * y / last),
        Math.round(255 * (x + y) / (last * 2)),
        255,
      ])
    }
  }
  return image
}

export function makeRadialGradient(size = 64) {
  const image = blank(size, size)
  const center = (size - 1) / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = Math.round(Math.min(255, 4 * Math.hypot(x - center, y - center)))
      setPixel(image, x, y, [value, Math.round(0.7 * value + 30), 255 - value, 255])
    }
  }
  return image
}

function logicalSizeFor(split, fixed = null) {
  if (fixed) return fixed
  return split === 'heldout' ? HELD_OUT_LOGICAL : CALIBRATION_LOGICAL
}

function seedFor(split) {
  return split === 'heldout' ? SEED_B : SEED_A
}

export function uniqueOffsets(cell) {
  return [...new Set([0, Math.floor(cell / 2), cell - 1])]
}

function makeLogicalSprite(size, seed) {
  const image = blank(size, size)
  const thin = new Uint8Array(size * size)
  const body = PALETTE[1 + (mixHash(1, 1, seed) % 4)]
  const outline = PALETTE[6]
  const eye = PALETTE[5]
  const pupil = PALETTE[7]
  const line = PALETTE[2]
  const ditherA = PALETTE[3]
  const ditherB = PALETTE[4]
  for (let y = 2; y < size - 2; y += 1) {
    for (let x = 2; x < size - 2; x += 1) setPixel(image, x, y, body)
  }
  for (let x = 2; x < size - 2; x += 1) {
    setPixel(image, x, 2, outline)
    setPixel(image, x, size - 3, outline)
    thin[2 * size + x] = 1
    thin[(size - 3) * size + x] = 1
  }
  for (let y = 2; y < size - 2; y += 1) {
    setPixel(image, 2, y, outline)
    setPixel(image, size - 3, y, outline)
    thin[y * size + 2] = 1
    thin[y * size + (size - 3)] = 1
  }
  const eyeY = Math.min(size - 6, 6)
  for (const eyeX of [5, Math.min(size - 6, 9)]) {
    setPixel(image, eyeX, eyeY, eye)
    setPixel(image, eyeX, eyeY + 1, pupil)
    thin[eyeY * size + eyeX] = 1
    thin[(eyeY + 1) * size + eyeX] = 1
  }
  const lineY = size - 6
  for (let x = 4; x < size - 4; x += 1) {
    setPixel(image, x, lineY, line)
    thin[lineY * size + x] = 1
  }
  const origin = Math.max(4, size - 10)
  for (let y = origin; y < origin + 4 && y < size - 3; y += 1) {
    for (let x = origin; x < origin + 4 && x < size - 3; x += 1) {
      setPixel(image, x, y, mixHash(x, y, seed) % 2 === 0 ? ditherA : ditherB)
      thin[y * size + x] = 1
    }
  }
  return { image, thin }
}

function paintCell(image, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) setPixel(image, x, y, color)
  }
}

function integerBoundaries(offset, cell, count) {
  const values = []
  for (let index = 1; index < count; index += 1) values.push(offset + index * cell)
  return values
}

export function phaseForConvention(convention) {
  return convention === 'round' ? 0.5 : 0
}

function scaleBoundaries(scale, count, convention) {
  const phase = phaseForConvention(convention)
  const at = (index) => Math.floor(phase + index * scale)
  const values = []
  for (let index = 1; index < count; index += 1) values.push(at(index))
  return { at, values, phase }
}

function upscaleInteger(logical, cell, offset) {
  const image = blank(offset + logical.width * cell, offset + logical.height * cell)
  for (let y = 0; y < logical.height; y += 1) {
    for (let x = 0; x < logical.width; x += 1) {
      const color = getPixel(logical, x, y)
      if (color[3] === 0) continue
      paintCell(image, offset + x * cell, offset + y * cell, offset + (x + 1) * cell, offset + (y + 1) * cell, color)
    }
  }
  return image
}

function upscaleFractional(logical, scaleX, scaleY, convention) {
  const xMap = scaleBoundaries(scaleX, logical.width + 1, convention)
  const yMap = scaleBoundaries(scaleY, logical.height + 1, convention)
  const image = blank(xMap.at(logical.width), yMap.at(logical.height))
  for (let y = 0; y < logical.height; y += 1) {
    for (let x = 0; x < logical.width; x += 1) {
      const color = getPixel(logical, x, y)
      if (color[3] === 0) continue
      paintCell(image, xMap.at(x), yMap.at(y), xMap.at(x + 1), yMap.at(y + 1), color)
    }
  }
  return { image, boundaries: { x: xMap.values.filter((x) => x < image.width), y: yMap.values.filter((y) => y < image.height) }, phase: xMap.phase }
}

function translate(image, dx, dy) {
  const output = blank(image.width, image.height)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) setPixel(output, x + dx, y + dy, getPixel(image, x, y))
  }
  return output
}

function cellStarts(length, cell, offset, scale, convention) {
  if (scale == null) return Array.from({ length: Math.ceil(length / cell) + 1 }, (_, index) => offset + index * cell).filter((value) => value > 0 && value < length)
  const phase = phaseForConvention(convention)
  const values = []
  for (let index = 0; Math.floor(phase + index * scale) < length; index += 1) {
    const value = Math.floor(phase + index * scale)
    if (value > 0) values.push(value)
  }
  return values
}

function blendToward(current, other, weight) {
  return current.map((channel, index) => index === 3 ? channel : Math.round(channel * (1 - weight) + other[index] * weight))
}

function applyBoundaryAA(image, kind, geometry) {
  const source = cloneImage(image)
  const output = cloneImage(image)
  const vertical = new Set(cellStarts(image.width, geometry.cell, geometry.offset, geometry.scale, geometry.convention))
  const horizontal = new Set(cellStarts(image.height, geometry.cell, geometry.offset, geometry.scale, geometry.convention))
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const current = getPixel(source, x, y)
      if (current[3] === 0) continue
      if (kind === 'aa-one-sided') {
        const neighbors = []
        if (vertical.has(x) && x > 0) neighbors.push(getPixel(source, x - 1, y))
        if (horizontal.has(y) && y > 0) neighbors.push(getPixel(source, x, y - 1))
        const usable = neighbors.filter((color) => color[3] > 0)
        if (!usable.length) continue
        const average = usable.reduce((sum, color) => sum.map((channel, index) => channel + color[index]), [0, 0, 0, 0])
        setPixel(output, x, y, blendToward(current, average.map((channel) => channel / usable.length), 0.5))
      } else {
        const neighbors = []
        if (vertical.has(x) && x > 0) neighbors.push(getPixel(source, x - 1, y))
        if (vertical.has(x + 1)) neighbors.push(getPixel(source, x + 1, y))
        if (horizontal.has(y) && y > 0) neighbors.push(getPixel(source, x, y - 1))
        if (horizontal.has(y + 1)) neighbors.push(getPixel(source, x, y + 1))
        const usable = neighbors.filter((color) => color[3] > 0)
        if (!usable.length) continue
        const average = usable.reduce((sum, color) => sum.map((channel, index) => channel + color[index]), [0, 0, 0, 0])
        setPixel(output, x, y, blendToward(current, average.map((channel) => channel / usable.length), 0.25))
      }
    }
  }
  return output
}

function contaminate(image, kind, { cell = 6, offset = 0, scale = null, convention = 'floor', seed = 0 } = {}) {
  const output = cloneImage(image)
  if (kind === 'aa-one-sided' || kind === 'aa-symmetric') return applyBoundaryAA(image, kind, { cell, offset, scale, convention })
  if (kind === 'alpha-fringe') {
    for (let y = 0; y < output.height; y += 1) {
      for (let x = 0; x < output.width; x += 1) {
        const color = getPixel(output, x, y)
        if (color[3] === 0) continue
        const edge = x === 0 || y === 0 || x === output.width - 1 || y === output.height - 1 || [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => getPixel(image, x + dx, y + dy)[3] === 0)
        if (edge) setPixel(output, x, y, [color[0], color[1], color[2], 128])
      }
    }
    return output
  }
  if (kind === 'block-noise') {
    for (let y = 0; y < output.height; y += 1) {
      for (let x = 0; x < output.width; x += 1) {
        const color = getPixel(output, x, y)
        if (color[3] === 0) continue
        const delta = (mixHash(x >> 3, y >> 3, seed) % 13) - 6
        setPixel(output, x, y, color.map((channel, index) => index === 3 ? channel : Math.max(0, Math.min(255, channel + delta))))
      }
    }
    return output
  }
  if (kind === 'hidden-rgb') {
    for (let y = 0; y < output.height; y += 1) {
      for (let x = 0; x < output.width; x += 1) {
        if (getPixel(output, x, y)[3] !== 0) continue
        if (mixHash(x, y, seed) % 5 !== 0) continue
        setPixel(output, x, y, [mixHash(x, y, seed + 1) % 256, mixHash(x, y, seed + 2) % 256, mixHash(x, y, seed + 3) % 256, 0])
      }
    }
    return output
  }
  if (kind === 'display-outline') {
    for (let y = 0; y < output.height; y += 1) for (let x = 0; x < output.width; x += 1) {
      if (getPixel(image, x, y)[3]) continue
      const touches = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => x + dx >= 0 && y + dy >= 0 && x + dx < image.width && y + dy < image.height && getPixel(image, x + dx, y + dy)[3] > 0))
      if (touches) setPixel(output, x, y, [24, 24, 32, 255])
    }
    return output
  }
  return output
}

function sampleBilinear(logical, x, y) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(logical.width - 1, x0 + 1)
  const y1 = Math.min(logical.height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const a = getPixel(logical, Math.max(0, x0), Math.max(0, y0))
  const b = getPixel(logical, x1, Math.max(0, y0))
  const c = getPixel(logical, Math.max(0, x0), y1)
  const d = getPixel(logical, x1, y1)
  return [0, 1, 2, 3].map((index) => Math.round(a[index] * (1 - tx) * (1 - ty) + b[index] * tx * (1 - ty) + c[index] * (1 - tx) * ty + d[index] * tx * ty))
}

function sampleCubic(logical, x, y) {
  const cubic = (t) => {
    const at = Math.abs(t)
    if (at <= 1) return 1.5 * at ** 3 - 2.5 * at ** 2 + 1
    if (at < 2) return -0.5 * at ** 3 + 2.5 * at ** 2 - 4 * at + 2
    return 0
  }
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const channels = [0, 0, 0, 0]
  for (let dy = -1; dy <= 2; dy += 1) {
    for (let dx = -1; dx <= 2; dx += 1) {
      const weight = cubic(x - (x0 + dx)) * cubic(y - (y0 + dy))
      const color = getPixel(logical, Math.max(0, Math.min(logical.width - 1, x0 + dx)), Math.max(0, Math.min(logical.height - 1, y0 + dy)))
      for (let index = 0; index < 4; index += 1) channels[index] += color[index] * weight
    }
  }
  return channels.map((value) => Math.max(0, Math.min(255, Math.round(value))))
}

function softUpscale(logical, scale, kernel) {
  const width = Math.max(1, Math.round(logical.width * scale))
  const height = Math.max(1, Math.round(logical.height * scale))
  const image = blank(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sample = kernel === 'bicubic' ? sampleCubic(logical, x / scale, y / scale) : sampleBilinear(logical, x / scale, y / scale)
      setPixel(image, x, y, sample)
    }
  }
  return image
}

function vectorShade(size, seed) {
  const image = blank(size, size)
  const center = size / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const radius = Math.hypot(x - center, y - center) / center
      if (radius > 0.82) continue
      const shade = Math.round(40 + 180 * (1 - radius) + (seed % 7))
      setPixel(image, x, y, [shade, Math.round(shade * 0.55), 80 + (seed % 20), 255])
    }
  }
  return image
}

function blurredShapes(size, seed) {
  const source = blank(size, size)
  for (let n = 0; n < 6; n += 1) {
    const x0 = mixHash(n, 1, seed) % size
    const y0 = mixHash(n, 2, seed) % size
    const w = 4 + mixHash(n, 3, seed) % 8
    const h = 4 + mixHash(n, 4, seed) % 8
    const color = PALETTE[n % PALETTE.length]
    paintCell(source, x0, y0, Math.min(size, x0 + w), Math.min(size, y0 + h), color)
  }
  const image = blank(size, size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const channels = [0, 0, 0, 0]
      let count = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = Math.max(0, Math.min(size - 1, x + dx))
          const sy = Math.max(0, Math.min(size - 1, y + dy))
          const color = getPixel(source, sx, sy)
          for (let index = 0; index < 4; index += 1) channels[index] += color[index]
          count += 1
        }
      }
      setPixel(image, x, y, channels.map((value) => Math.round(value / count)))
    }
  }
  return image
}

function accumulatedWidths(count, widthAt, seed) {
  let position = 0
  const starts = [0]
  for (let index = 0; index < count; index += 1) {
    position += widthAt(index, seed)
    starts.push(Math.round(position))
  }
  return starts.slice(1).map((value, index) => Math.max(1, value - starts[index]))
}

function driftFrame(logical, kind, seed = 0) {
  if (kind === 'jitter') {
    const widths = accumulatedWidths(logical.width, (index, value) => 5 + (mixHash(index, 9, value) % 3) - 1, seed)
    if (new Set(widths).size < 2) widths[1] = widths[0] === 5 ? 6 : 5
    return paintVariable(logical, widths, widths.map(() => 6))
  }
  if (kind === 'ramp') {
    const widths = accumulatedWidths(logical.width, (index) => 5.5 + (6.2 - 5.5) * index / Math.max(1, logical.width - 1), seed)
    return paintVariable(logical, widths, widths.map(() => 6))
  }
  const left = Math.floor(logical.width / 2)
  const widths = Array.from({ length: logical.width }, (_, index) => index < left ? 5 : 6)
  return paintVariable(logical, widths, widths.map(() => 6))
}

function paintVariable(logical, widths, heights) {
  const width = widths.reduce((sum, value) => sum + value, 0)
  const height = heights.reduce((sum, value) => sum + value, 0)
  const image = blank(width, height)
  const xStarts = []
  const yStarts = []
  let cursor = 0
  for (const value of widths) {
    xStarts.push(cursor)
    cursor += value
  }
  cursor = 0
  for (const value of heights) {
    yStarts.push(cursor)
    cursor += value
  }
  for (let y = 0; y < logical.height; y += 1) {
    for (let x = 0; x < logical.width; x += 1) {
      const color = getPixel(logical, x, y)
      if (color[3] === 0) continue
      paintCell(image, xStarts[x], yStarts[y], xStarts[x] + widths[x], yStarts[y] + heights[y], color)
    }
  }
  return {
    image,
    boundaries: {
      x: xStarts.slice(1),
      y: yStarts.slice(1),
    },
  }
}

export const NORMALIZER_SCALE = 0.6875
export const SPAN150_SCALE = Object.freeze({ numerator: 7, denominator: 10 })

function normalizerFrame(logical, ratio = { numerator: 11, denominator: 16 }) {
  const cell = 8
  const upscaled = upscaleInteger(logical, cell, 0)
  const { numerator, denominator } = ratio
  const scale = numerator / denominator
  const width = Math.floor(upscaled.width * numerator / denominator)
  const height = Math.floor(upscaled.height * numerator / denominator)
  const image = blank(width, height)
  const boundaries = { x: [], y: [] }
  let previousX = -1
  let previousY = -1
  for (let x = 0; x < width; x += 1) {
    const sourceCell = Math.floor(Math.floor(x * denominator / numerator) / cell)
    if (x > 0 && sourceCell !== previousX) boundaries.x.push(x)
    previousX = sourceCell
  }
  for (let y = 0; y < height; y += 1) {
    const sourceCell = Math.floor(Math.floor(y * denominator / numerator) / cell)
    if (y > 0 && sourceCell !== previousY) boundaries.y.push(y)
    previousY = sourceCell
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(image, x, y, getPixel(upscaled, Math.min(upscaled.width - 1, Math.floor(x * denominator / numerator)), Math.min(upscaled.height - 1, Math.floor(y * denominator / numerator))))
    }
  }
  let a = cell * numerator
  let b = denominator
  while (b) [a, b] = [b, a % b]
  const periodDenominator = denominator / a
  return { image, boundaries, scale, ratio, period: cell * numerator / denominator, phase: (periodDenominator - 1) / periodDenominator }
}

function baseSpec(partial) {
  return {
    role: 'report',
    minCellRelevant: true,
    ...partial,
  }
}

export function listRecoveryCases() {
  const cases = []
  for (const split of ['calibration', 'heldout']) {
    const seed = seedFor(split)
    const logical = logicalSizeFor(split)
    for (const cell of F1_CELLS) {
      for (const offset of uniqueOffsets(cell)) {
        cases.push(baseSpec({
          id: `F1/c${cell}/off${offset}/${split}`,
          family: 'F1',
          split,
          seed,
          cell,
          offset,
          logicalSize: logical,
          role: 'positive',
        }))
      }
    }
    for (const scale of F2_SCALES) {
      for (const convention of ['floor', 'round']) {
        cases.push(baseSpec({
          id: `F2/s${scale}/${convention}/${split}`,
          family: 'F2',
          split,
          seed,
          scale,
          convention,
          logicalSize: logical,
          role: 'negative',
        }))
      }
    }
    cases.push(baseSpec({
      id: `F2/anisotropic/${split}`,
      family: 'F2',
      split,
      seed,
      variant: 'anisotropic',
      logicalSize: logical,
      role: 'negative',
    }))
    cases.push(baseSpec({
      id: `F2/normalizer/${split}`,
      family: 'F2',
      split,
      seed,
      variant: 'normalizer',
      logicalSize: logical,
      role: 'negative',
    }))
    cases.push(baseSpec({
      id: `F2/span150/${split}`,
      family: 'F2',
      split,
      seed,
      variant: 'span150',
      logicalSize: 150,
      logicalHeight: 8,
      role: 'negative',
      fixedSize: true,
    }))
    for (const contamination of F3_CONTAMINATIONS) {
      cases.push(baseSpec({
        id: `F3-int/${contamination}/${split}`,
        family: 'F3-int',
        split,
        seed,
        contamination,
        cell: 6,
        offset: 2,
        logicalSize: logical,
        role: 'positive',
      }))
      cases.push(baseSpec({
        id: `F3-frac/${contamination}/${split}`,
        family: 'F3-frac',
        split,
        seed,
        contamination,
        scale: 5.5,
        convention: 'floor',
        logicalSize: logical,
        role: 'negative',
      }))
    }
    for (const scale of [4, 5.5, 6]) {
      for (const kernel of ['bilinear', 'bicubic']) {
        cases.push(baseSpec({
          id: `F3-soft/s${scale}/${kernel}/${split}`,
          family: 'F3-soft',
          split,
          seed,
          scale,
          kernel,
          logicalSize: logical,
          role: 'report',
        }))
      }
    }
    for (const variant of ['jitter', 'ramp', 'split']) {
      cases.push(baseSpec({
        id: `F4/${variant}/${split}`,
        family: 'F4',
        split,
        seed,
        variant,
        logicalSize: logical,
        role: 'report',
      }))
    }
    for (const variant of F5_VARIANTS) {
      cases.push(baseSpec({
        id: `F5-int/${variant}/${split}`,
        family: 'F5-int',
        split,
        seed,
        variant,
        cell: 6,
        offset: 2,
        logicalSize: 32,
        frames: 8,
        role: variant === 'display-shift' ? 'report' : 'positive',
        fixedSize: true,
      }))
    }
    cases.push(baseSpec({
      id: `F5-frac/${split}`,
      family: 'F5-frac',
      split,
      seed,
      scale: 5.5,
      logicalSize: 32,
      frames: 8,
      role: 'negative',
      fixedSize: true,
    }))
    for (const kind of F6_KINDS) {
      cases.push(baseSpec({
        id: `F6-single/${kind}/${split}`,
        family: 'F6-single',
        split,
        seed,
        kind,
        logicalSize: kind.endsWith('-64') ? 64 : logical,
        role: 'negative',
        fixedSize: kind.endsWith('-64'),
      }))
    }
    cases.push(baseSpec({
      id: `F6-multi/${split}`,
      family: 'F6-multi',
      split,
      seed,
      logicalSize: 64,
      frames: 8,
      role: 'negative',
      fixedSize: true,
    }))
  }
  for (const kind of ['planar-64', 'radial-64']) {
    cases.push(baseSpec({
      id: `F6-regression/${kind}`,
      family: 'F6-single',
      split: 'regression',
      seed: 0,
      kind,
      logicalSize: 64,
      role: 'regression',
      fixedSize: true,
      regressionControl: true,
    }))
  }
  return cases
}

export function buildRecoveryCase(id) {
  const spec = listRecoveryCases().find((item) => item.id === id)
  if (!spec) throw new Error(`unknown recovery case ${id}`)
  const size = spec.logicalSize
  const height = spec.logicalHeight ?? size
  const sprite = spec.family.startsWith('F6') ? null : makeLogicalSprite(size, spec.seed)
  if (sprite && height !== size) {
    const short = makeLogicalSprite(size, spec.seed)
    short.image = blank(size, height)
    short.thin = new Uint8Array(size * height)
    const source = makeLogicalSprite(Math.min(size, 24), spec.seed)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const color = getPixel(source.image, x % source.image.width, y % source.image.height)
        setPixel(short.image, x, y, color)
        short.thin[y * size + x] = source.thin[(y % source.image.height) * source.image.width + (x % source.image.width)]
      }
    }
    return finishCase(spec, short)
  }
  return finishCase(spec, sprite)
}

function finishCase(spec, sprite) {
  if (spec.family === 'F6-single') return finishNoise(spec)
  if (spec.family === 'F6-multi') return finishMulti(spec)
  const logical = { width: sprite.image.width, height: sprite.image.height, data: sprite.image.data }
  if (spec.family === 'F1' || spec.family === 'F3-int' || spec.family === 'F5-int') {
    const base = upscaleInteger(logical, spec.cell, spec.offset)
    const frames = spec.family === 'F5-int' ? sequenceFrames(base, spec, logical) : [applyContamination(base, spec)]
    const pad = spec.variant === 'whole-cell-shift' ? 4 * spec.cell : spec.variant === 'display-shift' ? 2 : 0
    const origin = spec.offset + pad
    const firstShift = frames[0].shift ?? { x: 0, y: 0 }
    const phase = { x: origin + firstShift.x, y: origin + firstShift.y }
    return pack(spec, logical, sprite.thin, frames, {
      period: { x: spec.cell, y: spec.cell },
      phase,
      boundaries: { x: integerBoundaries(phase.x, spec.cell, logical.width), y: integerBoundaries(phase.y, spec.cell, logical.height) },
    })
  }
  if (spec.family === 'F2' && spec.variant === 'span150') {
    const sampled = normalizerFrame(logical, SPAN150_SCALE)
    return pack(spec, logical, sprite.thin, [sampled.image], { period: { x: sampled.period, y: sampled.period }, phase: { x: sampled.phase, y: sampled.phase }, boundaries: sampled.boundaries, scale: sampled.scale, scaleRatio: sampled.ratio })
  }
  if (spec.family === 'F2' && spec.variant === 'anisotropic') {
    const scaled = upscaleFractional(logical, 6, 5.5, 'floor')
    return pack(spec, logical, sprite.thin, [scaled.image], { period: { x: 6, y: 5.5 }, phase: { x: 0, y: 0 }, boundaries: scaled.boundaries })
  }
  if (spec.family === 'F2' && spec.variant === 'normalizer') {
    const sampled = normalizerFrame(logical)
    return pack(spec, logical, sprite.thin, [sampled.image], { period: { x: sampled.period, y: sampled.period }, phase: { x: sampled.phase, y: sampled.phase }, boundaries: sampled.boundaries, scale: sampled.scale, scaleRatio: sampled.ratio })
  }
  if (spec.family === 'F2') {
    const scaled = upscaleFractional(logical, spec.scale, spec.scale, spec.convention)
    return pack(spec, logical, sprite.thin, [scaled.image], { period: { x: spec.scale, y: spec.scale }, phase: { x: scaled.phase, y: scaled.phase }, boundaries: scaled.boundaries })
  }
  if (spec.family === 'F3-frac') {
    const scaled = upscaleFractional(logical, spec.scale, spec.scale, spec.convention)
    return pack(spec, logical, sprite.thin, [applyContamination(scaled.image, { ...spec, scale: spec.scale })], { period: { x: spec.scale, y: spec.scale }, phase: { x: scaled.phase, y: scaled.phase }, boundaries: scaled.boundaries })
  }
  if (spec.family === 'F3-soft') {
    return pack(spec, logical, sprite.thin, [softUpscale(logical, spec.scale, spec.kernel)], { period: { x: spec.scale, y: spec.scale }, phase: { x: 0, y: 0 }, boundaries: { x: [], y: [] }, soft: true })
  }
  if (spec.family === 'F4') {
    const drifted = driftFrame(logical, spec.variant, spec.seed)
    return pack(spec, logical, sprite.thin, [drifted.image], { period: { x: null, y: null }, phase: { x: 0, y: 0 }, boundaries: drifted.boundaries, drift: true })
  }
  if (spec.family === 'F5-frac') {
    const frames = []
    const shifts = []
    for (let index = 0; index < 8; index += 1) {
      const scaled = upscaleFractional(logical, 5.5, 5.5, 'floor')
      const shift = index - 3
      frames.push(placeShifted(scaled.image, shift, 0, 4))
      shifts.push({ x: shift, y: 0 })
    }
    const boundaries = upscaleFractional(logical, 5.5, 5.5, 'floor').boundaries
    return pack(spec, logical, sprite.thin, frames, { period: { x: 5.5, y: 5.5 }, phase: { x: 1, y: 4 }, boundaries: { x: boundaries.x.map((x) => x + 1), y: boundaries.y.map((y) => y + 4) }, shifts })
  }
  throw new Error(`unbuilt case ${spec.id}`)
}

function applyContamination(image, spec) {
  if (!spec.contamination) return image
  return contaminate(image, spec.contamination, spec)
}

function placeShifted(base, dx, dy, pad) {
  const output = blank(base.width + pad * 2, base.height + pad * 2)
  for (let y = 0; y < base.height; y += 1) {
    for (let x = 0; x < base.width; x += 1) setPixel(output, pad + dx + x, pad + dy + y, getPixel(base, x, y))
  }
  return output
}

function sequenceFrames(base, spec, logical) {
  const shifts = []
  const frames = []
  const displayShifts = [-2, -1, 0, 1, 2, -2, -1, 0]
  const pad = spec.variant === 'whole-cell-shift' ? 4 * spec.cell : 2
  for (let index = 0; index < 8; index += 1) {
    if (spec.variant === 'display-shift') {
      frames.push(placeShifted(base, displayShifts[index], 0, pad))
      shifts.push({ x: displayShifts[index], y: 0, wholeCell: 0 })
    } else if (spec.variant === 'whole-cell-shift') {
      const cells = index - 3
      frames.push(placeShifted(base, cells * spec.cell, 0, pad))
      shifts.push({ x: cells * spec.cell, y: 0, wholeCell: cells })
    } else if (spec.variant === 'limb' && index === 3) {
      const changed = cloneImage(logical)
      setPixel(changed, 6, 8, PALETTE[2])
      frames.push(upscaleInteger(changed, spec.cell, spec.offset))
      shifts.push({ x: 0, y: 0, limb: true })
    } else if (spec.variant === 'outlier' && index === 4) {
      frames.push(makeNoiseImage(base.width, base.height, spec.seed + index))
      shifts.push({ x: 0, y: 0, outlier: true })
    } else if (spec.variant === 'frame-noise') {
      frames.push(contaminate(base, 'block-noise', { ...spec, seed: spec.seed + index * 17 }))
      shifts.push({ x: 0, y: 0 })
    } else {
      frames.push(cloneImage(base))
      shifts.push({ x: 0, y: 0 })
    }
  }
  return frames.map((frame, index) => ({ ...frame, shift: shifts[index] }))
}

function finishNoise(spec) {
  const size = spec.logicalSize
  let image
  if (spec.kind === 'planar-64') image = makePlanarGradient(64)
  else if (spec.kind === 'radial-64') image = makeRadialGradient(64)
  else if (spec.kind === 'planar-sprite') image = makePlanarGradient(size)
  else if (spec.kind === 'radial-sprite') {
    image = makeRadialGradient(size)
    const center = (size - 1) / 2
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      if (Math.hypot(x - center, y - center) > size * 0.42) setPixel(image, x, y, [0, 0, 0, 0])
    }
  }
  else if (spec.kind === 'vector-shade') image = vectorShade(size, spec.seed)
  else if (spec.kind === 'noise') image = makeNoiseImage(size, size, spec.seed)
  else if (spec.kind === 'sparse-noise') image = makeSparseNoiseSprite(size, size, spec.seed)
  else image = blurredShapes(size, spec.seed)
  return pack(spec, null, null, [image], { period: { x: null, y: null }, phase: { x: null, y: null }, boundaries: { x: [], y: [] }, noGrid: true })
}

function finishMulti(spec) {
  const frames = []
  for (let index = 0; index < 8; index += 1) {
    const image = blank(64, 64)
    const center = 22 + (mixHash(0, 0, spec.seed) % 5) + index
    const centerY = 29.5 + (mixHash(1, 0, spec.seed) % 5)
    const slope = 3.5 + (mixHash(2, 0, spec.seed) % 5) / 4
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const value = Math.round(Math.min(255, slope * Math.hypot(x - center, y - centerY)))
        setPixel(image, x, y, [value, Math.round(0.7 * value + 30), 255 - value, 255])
      }
    }
    frames.push(image)
  }
  return pack(spec, null, null, frames, { period: { x: null, y: null }, phase: { x: null, y: null }, boundaries: { x: [], y: [] }, noGrid: true })
}

function truthAxisSpans(limit, period, phase, count, boundaries) {
  if (!(period > 0)) {
    const edges = [0, ...boundaries.filter((value) => value > 0 && value < limit), limit]
    return edges.slice(0, -1).map((start, index) => ({ start, end: edges[index + 1], source_index: index }))
  }
  const sourceEdges = boundaries.length === count - 1
    ? [Math.floor(phase), ...boundaries, Math.floor(phase + count * period)]
    : Array.from({ length: count + 1 }, (_, index) => Math.floor(phase + index * period))
  const at = (index) => index >= 0 && index <= count ? sourceEdges[index] : Math.floor(phase + index * period)
  const spans = []
  for (let index = Math.floor(-phase / period) - 1; index <= Math.ceil((limit - phase) / period); index += 1) {
    const start = Math.max(0, at(index))
    const end = Math.min(limit, at(index + 1))
    if (end > start) spans.push({ start, end, source_index: index })
  }
  return spans
}

function alignedTruth(logical, thin, truth, frame) {
  if (!logical) return null
  const spans = {
    x: truthAxisSpans(frame.width, truth.period.x, truth.phase.x, logical.width, truth.boundaries.x),
    y: truthAxisSpans(frame.height, truth.period.y, truth.phase.y, logical.height, truth.boundaries.y),
  }
  const width = spans.x.length
  const height = spans.y.length
  const image = blank(width, height)
  const mask = new Uint8Array(width * height)
  const outline = new Uint8Array(width * height)
  for (let ly = 0; ly < height; ly += 1) {
    for (let lx = 0; lx < width; lx += 1) {
      const cx = spans.x[lx].source_index
      const cy = spans.y[ly].source_index
      if (cx < 0 || cy < 0 || cx >= logical.width || cy >= logical.height) continue
      const color = getPixel(logical, cx, cy)
      setPixel(image, lx, ly, color)
      mask[ly * width + lx] = thin?.[cy * logical.width + cx] ?? 0
      outline[ly * width + lx] = color.every((channel, index) => channel === PALETTE[6][index]) ? 1 : 0
    }
  }
  return { image, thin: mask, outline, spans, origin: { x: spans.x[0].source_index, y: spans.y[0].source_index } }
}

function pack(spec, logical, thin, frames, truth) {
  const packedFrames = frames.map((frame) => ({ width: frame.width, height: frame.height, data: frame.data }))
  const shifts = frames.map((frame) => frame.shift ?? { x: 0, y: 0 })
  for (const frame of packedFrames) {
    if (frame.width * frame.height > 1_000_000) throw new Error(`${spec.id} exceeds 1 MP`)
  }
  const aligned = alignedTruth(logical, thin, truth, packedFrames[0])
  const phase = Object.fromEntries(['x', 'y'].map((axis) => [axis, truth.period[axis] > 0 ? ((truth.phase[axis] % truth.period[axis]) + truth.period[axis]) % truth.period[axis] : truth.phase[axis]]))
  return {
    ...spec,
    frames: packedFrames,
    truth: {
      logical: aligned?.image ?? logical,
      sprite: logical,
      thin: aligned?.thin ?? thin,
      outline: aligned?.outline ?? null,
      spans: aligned?.spans ?? null,
      origin: aligned?.origin ?? { x: 0, y: 0 },
      source_origin: truth.phase,
      shifts: truth.shifts ?? shifts,
      period: truth.period,
      phase,
      scale: truth.scale ?? null,
      scale_ratio: truth.scaleRatio ?? null,
      boundaries: aligned && !truth.soft ? { x: aligned.spans.x.slice(1).map((span) => span.start), y: aligned.spans.y.slice(1).map((span) => span.start) } : truth.boundaries,
      soft: Boolean(truth.soft),
      drift: Boolean(truth.drift),
      noGrid: Boolean(truth.noGrid),
    },
  }
}
