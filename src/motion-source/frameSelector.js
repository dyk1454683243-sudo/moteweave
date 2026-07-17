const FNV_OFFSET = 0x811c9dc5
const FNV_OFFSET_SECONDARY = 0x9e3779b9
const FNV_PRIME = 0x01000193
const LOOP_SEAMLESS_THRESHOLD = 0.98
const NEAR_DUPLICATE_MEAN_DELTA_MAX = 2
const NEAR_DUPLICATE_PIXEL_SIMILARITY_MIN = 0.995
const NEAR_DUPLICATE_CHANGED_PIXEL_RATIO_MAX = 0.05
const NEAR_DUPLICATE_BBOX_CENTER_MAX = 1
const NEAR_DUPLICATE_BBOX_AREA_RATIO_MAX = 0.03

export const MOTION_SELECTION_RECIPE_IDS = Object.freeze({
  V1_COMPAT: 'motion_selection_v1_compat',
  V2: 'motion_selection_recipe_v2',
})

export const MOTION_SELECTION_LOOP_EXPECTATIONS = Object.freeze({
  AUTO: 'auto',
  LOOP: 'loop',
  ONCE: 'once',
})

export const MOTION_SELECTION_TEMPORAL_MATTE_MODES = Object.freeze({
  DISABLED: 'disabled',
  EVIDENCE_ONLY: 'evidence_only',
})

const MOTION_SELECTION_OPTION_KEYS = new Set([
  'recipe',
  'loop_expectation',
  'loopExpectation',
  'temporal_matte',
  'temporalMatte',
])
const MOTION_SELECTION_RECIPES = new Set(Object.values(MOTION_SELECTION_RECIPE_IDS))
const MOTION_SELECTION_LOOP_EXPECTATION_VALUES = new Set(Object.values(MOTION_SELECTION_LOOP_EXPECTATIONS))
const MOTION_SELECTION_TEMPORAL_MATTE_VALUES = new Set(Object.values(MOTION_SELECTION_TEMPORAL_MATTE_MODES))
const MOTION_SELECTION_V2_MAX_FRAMES = 64
const MOTION_SELECTION_V2_MAX_RGBA_BYTES = 256 * 1024 * 1024
const MOTION_SELECTION_V2_MAX_FRAME_RGBA_BYTES = 64 * 1024 * 1024
const MOTION_SELECTION_ANALYSIS_MAX_SIDE = 64
const MOTION_SELECTION_REGISTRATION_MAX_SHIFT = 3
const MOTION_SELECTION_REGISTRATION_LOCAL_RADIUS = 1
const MOTION_SELECTION_CLUSTER_SIMILARITY_MIN = 0.97
const MOTION_SELECTION_CLUSTER_CHANGED_RATIO_MAX = 0.06
const MOTION_SELECTION_CLUSTER_ALPHA_IOU_MIN = 0.94
const MOTION_SELECTION_PERIODICITY_SIMILARITY_MIN = 0.965
const MOTION_SELECTION_PERIODICITY_SCORE_MIN = 0.86
const MOTION_SELECTION_PERIODICITY_AMBIGUITY_DELTA = 0.015

function motionSelectionError(code, message, evidence = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, evidence)
  return error
}

function readAliasedSelectionOption(source, snakeKey, camelKey) {
  const hasSnake = Object.prototype.hasOwnProperty.call(source, snakeKey)
  const hasCamel = Object.prototype.hasOwnProperty.call(source, camelKey)
  if (hasSnake && hasCamel && source[snakeKey] !== source[camelKey]) {
    throw motionSelectionError(
      'conflicting_motion_selection_option',
      `Conflicting motion selection options: ${snakeKey} and ${camelKey}`,
      { option: snakeKey, alias: camelKey }
    )
  }
  if (hasSnake) return source[snakeKey]
  if (hasCamel) return source[camelKey]
  return undefined
}

export function normalizeMotionSelectionOptions(value = false) {
  if (value === undefined || value === null || value === false) {
    return {
      recipe: MOTION_SELECTION_RECIPE_IDS.V1_COMPAT,
      loop_expectation: MOTION_SELECTION_LOOP_EXPECTATIONS.AUTO,
      temporal_matte: MOTION_SELECTION_TEMPORAL_MATTE_MODES.DISABLED,
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw motionSelectionError(
      'invalid_motion_selection_options',
      'motion selection options must be an object, null, or false'
    )
  }
  for (const key of Object.keys(value)) {
    if (!MOTION_SELECTION_OPTION_KEYS.has(key)) {
      throw motionSelectionError(
        'unknown_motion_selection_option',
        `Unknown motion selection option: ${key}`,
        { option: key }
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'recipe')) {
    throw motionSelectionError(
      'invalid_motion_selection_recipe',
      'motion selection recipe is required for explicit options'
    )
  }
  if (typeof value.recipe !== 'string' || !MOTION_SELECTION_RECIPES.has(value.recipe)) {
    throw motionSelectionError(
      'invalid_motion_selection_recipe',
      `Unsupported motion selection recipe: ${String(value.recipe)}`,
      { recipe: value.recipe }
    )
  }

  const loopExpectation =
    readAliasedSelectionOption(value, 'loop_expectation', 'loopExpectation') ??
    MOTION_SELECTION_LOOP_EXPECTATIONS.AUTO
  const temporalMatte =
    readAliasedSelectionOption(value, 'temporal_matte', 'temporalMatte') ??
    MOTION_SELECTION_TEMPORAL_MATTE_MODES.DISABLED
  if (!MOTION_SELECTION_LOOP_EXPECTATION_VALUES.has(loopExpectation)) {
    throw motionSelectionError(
      'invalid_motion_selection_option',
      `Unsupported loop expectation: ${String(loopExpectation)}`,
      { option: 'loop_expectation', value: loopExpectation }
    )
  }
  if (!MOTION_SELECTION_TEMPORAL_MATTE_VALUES.has(temporalMatte)) {
    throw motionSelectionError(
      'invalid_motion_selection_option',
      `Unsupported temporal matte mode: ${String(temporalMatte)}`,
      { option: 'temporal_matte', value: temporalMatte }
    )
  }
  if (
    value.recipe === MOTION_SELECTION_RECIPE_IDS.V1_COMPAT &&
    (
      loopExpectation !== MOTION_SELECTION_LOOP_EXPECTATIONS.AUTO ||
      temporalMatte !== MOTION_SELECTION_TEMPORAL_MATTE_MODES.DISABLED
    )
  ) {
    throw motionSelectionError(
      'invalid_motion_selection_option',
      'v1 compatibility recipe does not accept v2 loop or temporal matte behavior',
      { recipe: value.recipe }
    )
  }

  return {
    recipe: value.recipe,
    loop_expectation: loopExpectation,
    temporal_matte: temporalMatte,
  }
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid_${name}`)
}

function assertFrame(frame, index) {
  if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 0 || frame.height <= 0) {
    throw new Error(`invalid_motion_frame:${index}`)
  }
  const expectedLength = frame.width * frame.height * 4
  if (!frame.data || frame.data.length !== expectedLength) throw new Error(`invalid_motion_frame:${index}`)
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function mixHashByte(hash, byte) {
  hash ^= byte & 0xff
  return Math.imul(hash, FNV_PRIME) >>> 0
}

function mixHashNumber(hash, value) {
  let next = hash
  next = mixHashByte(next, value & 0xff)
  next = mixHashByte(next, (value >>> 8) & 0xff)
  next = mixHashByte(next, (value >>> 16) & 0xff)
  next = mixHashByte(next, (value >>> 24) & 0xff)
  return next
}

function hashRgbaFrame(frame) {
  let hash = FNV_OFFSET
  hash = mixHashNumber(hash, frame.width)
  hash = mixHashNumber(hash, frame.height)
  for (let index = 0; index < frame.data.length; index += 1) {
    hash = mixHashByte(hash, frame.data[index])
  }
  return hash.toString(16).padStart(8, '0')
}

function hashRgbaFrameV2(frame) {
  let forward = FNV_OFFSET
  let reverse = FNV_OFFSET_SECONDARY
  forward = mixHashNumber(forward, frame.width)
  forward = mixHashNumber(forward, frame.height)
  reverse = mixHashNumber(reverse, frame.height)
  reverse = mixHashNumber(reverse, frame.width)
  for (let index = 0; index < frame.data.length; index += 1) {
    forward = mixHashByte(forward, frame.data[index])
    reverse = mixHashByte(reverse, frame.data[frame.data.length - 1 - index])
  }
  return [
    forward.toString(16).padStart(8, '0'),
    reverse.toString(16).padStart(8, '0'),
  ].join(':')
}

function alphaBBox(frame) {
  let left = frame.width
  let top = frame.height
  let right = -1
  let bottom = -1
  let visiblePixels = 0
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const alpha = frame.data[(y * frame.width + x) * 4 + 3]
      if (alpha <= 0) continue
      visiblePixels += 1
      if (x < left) left = x
      if (y < top) top = y
      if (x > right) right = x
      if (y > bottom) bottom = y
    }
  }
  if (!visiblePixels) return null
  const width = right - left + 1
  const height = bottom - top + 1
  return {
    left,
    top,
    right: right + 1,
    bottom: bottom + 1,
    width,
    height,
    area: width * height,
    visible_pixels: visiblePixels,
    center_x: round(left + width / 2),
    center_y: round(top + height / 2),
  }
}

function framePixelStats(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    return {
      comparable: false,
      changed_pixel_ratio: 1,
      mean_absolute_rgba_delta: 255,
      pixel_similarity: 0,
    }
  }

  let changedPixels = 0
  let absoluteDelta = 0
  for (let offset = 0; offset < a.data.length; offset += 4) {
    const dr = Math.abs(a.data[offset] - b.data[offset])
    const dg = Math.abs(a.data[offset + 1] - b.data[offset + 1])
    const db = Math.abs(a.data[offset + 2] - b.data[offset + 2])
    const da = Math.abs(a.data[offset + 3] - b.data[offset + 3])
    if (dr || dg || db || da) changedPixels += 1
    absoluteDelta += dr + dg + db + da
  }

  const pixelCount = a.width * a.height
  const meanAbsolute = absoluteDelta / (pixelCount * 4)
  return {
    comparable: true,
    changed_pixel_ratio: round(changedPixels / pixelCount, 6),
    mean_absolute_rgba_delta: round(meanAbsolute, 4),
    pixel_similarity: round(clamp01(1 - meanAbsolute / 255), 6),
  }
}

function bboxMotionStats(current, previous) {
  if (!current && !previous) {
    return {
      bbox_center_dx: 0,
      bbox_center_dy: 0,
      bbox_center_distance: 0,
      bbox_area_delta: 0,
      bbox_area_delta_ratio: 0,
    }
  }
  if (!current || !previous) {
    return {
      bbox_center_dx: null,
      bbox_center_dy: null,
      bbox_center_distance: null,
      bbox_area_delta: current?.area ?? -(previous?.area ?? 0),
      bbox_area_delta_ratio: 1,
    }
  }

  const dx = current.center_x - previous.center_x
  const dy = current.center_y - previous.center_y
  const areaDelta = current.area - previous.area
  const areaDenominator = Math.max(current.area, previous.area, 1)
  return {
    bbox_center_dx: round(dx),
    bbox_center_dy: round(dy),
    bbox_center_distance: round(Math.hypot(dx, dy)),
    bbox_area_delta: areaDelta,
    bbox_area_delta_ratio: round(Math.abs(areaDelta) / areaDenominator, 6),
  }
}

function motionDelta(current, previous) {
  if (!previous) {
    return {
      from_original_index: null,
      pixel_change_ratio: 0,
      mean_absolute_rgba_delta: 0,
      bbox_center_dx: 0,
      bbox_center_dy: 0,
      bbox_center_distance: 0,
      bbox_area_delta: 0,
      bbox_area_delta_ratio: 0,
      score: 0,
    }
  }

  const pixel = framePixelStats(current.frame, previous.frame)
  const bbox = bboxMotionStats(current.bbox, previous.bbox)
  const centerDistance = bbox.bbox_center_distance ?? 0
  const bboxMotionScore = centerDistance + bbox.bbox_area_delta_ratio * 5
  const pixelMotionScore = Math.min(pixel.changed_pixel_ratio, 0.25) * 2 + Math.min(pixel.mean_absolute_rgba_delta / 16, 1)
  const score = bboxMotionScore * 2 + pixelMotionScore
  return {
    from_original_index: previous.original_index,
    pixel_change_ratio: pixel.changed_pixel_ratio,
    mean_absolute_rgba_delta: pixel.mean_absolute_rgba_delta,
    bbox_center_dx: bbox.bbox_center_dx,
    bbox_center_dy: bbox.bbox_center_dy,
    bbox_center_distance: bbox.bbox_center_distance,
    bbox_area_delta: bbox.bbox_area_delta,
    bbox_area_delta_ratio: bbox.bbox_area_delta_ratio,
    alpha_motion_score: round(bboxMotionScore),
    score: round(score),
  }
}

function bboxSimilarity(current, previous, frameWidth, frameHeight) {
  if (!current && !previous) return 1
  if (!current || !previous) return 0
  const motion = bboxMotionStats(current, previous)
  const diagonal = Math.max(Math.hypot(frameWidth, frameHeight), 1)
  const centerScore = clamp01(1 - (motion.bbox_center_distance ?? diagonal) / diagonal)
  const areaScore = clamp01(1 - motion.bbox_area_delta_ratio)
  return round(centerScore * 0.7 + areaScore * 0.3, 6)
}

function compareLoopEndpoints(first, last) {
  if (!first || !last) {
    return {
      start_original_index: null,
      end_original_index: null,
      compared_indexes: [],
      pixel_similarity: 0,
      bbox_similarity: 0,
      bbox_center_distance: null,
      bbox_area_delta_ratio: 1,
      similarity: 0,
      seamless: false,
    }
  }

  const pixel = framePixelStats(first.frame, last.frame)
  const bboxMotion = bboxMotionStats(first.bbox, last.bbox)
  const bboxScore = bboxSimilarity(first.bbox, last.bbox, first.width, first.height)
  const similarity = first.hash === last.hash
    ? 1
    : round(pixel.pixel_similarity * 0.6 + bboxScore * 0.4, 6)
  const stableBBox = (bboxMotion.bbox_center_distance ?? Infinity) <= 2 && bboxMotion.bbox_area_delta_ratio <= 0.05
  const seamless = similarity >= LOOP_SEAMLESS_THRESHOLD || (pixel.pixel_similarity >= 0.995 && stableBBox)

  return {
    start_original_index: first.original_index,
    end_original_index: last.original_index,
    compared_indexes: [first.original_index, last.original_index],
    pixel_similarity: pixel.pixel_similarity,
    bbox_similarity: bboxScore,
    bbox_center_distance: bboxMotion.bbox_center_distance,
    bbox_area_delta_ratio: bboxMotion.bbox_area_delta_ratio,
    similarity,
    seamless,
  }
}

function frameSimilarity(current, previous) {
  const pixel = framePixelStats(current.frame, previous.frame)
  const bboxMotion = bboxMotionStats(current.bbox, previous.bbox)
  const bboxScore = bboxSimilarity(current.bbox, previous.bbox, current.width, current.height)
  return {
    pixel_similarity: pixel.pixel_similarity,
    changed_pixel_ratio: pixel.changed_pixel_ratio,
    mean_absolute_rgba_delta: pixel.mean_absolute_rgba_delta,
    bbox_similarity: bboxScore,
    bbox_center_distance: bboxMotion.bbox_center_distance,
    bbox_area_delta_ratio: bboxMotion.bbox_area_delta_ratio,
    similarity: round(pixel.pixel_similarity * 0.7 + bboxScore * 0.3, 6),
  }
}

function nearDuplicateEvidence(current, previous) {
  if (!previous) return null
  const similarity = frameSimilarity(current, previous)
  const stableBBox =
    (similarity.bbox_center_distance ?? Infinity) <= NEAR_DUPLICATE_BBOX_CENTER_MAX &&
    similarity.bbox_area_delta_ratio <= NEAR_DUPLICATE_BBOX_AREA_RATIO_MAX
  const lowPixelDelta = similarity.mean_absolute_rgba_delta <= NEAR_DUPLICATE_MEAN_DELTA_MAX
  const sparsePixelChange =
    similarity.pixel_similarity >= NEAR_DUPLICATE_PIXEL_SIMILARITY_MIN &&
    similarity.changed_pixel_ratio <= NEAR_DUPLICATE_CHANGED_PIXEL_RATIO_MAX
  if (!stableBBox || (!lowPixelDelta && !sparsePixelChange)) return null
  return similarity
}

function buildFrameAnalysis(frame, index, {
  hashFunction = hashRgbaFrame,
} = {}) {
  assertFrame(frame, index)
  return {
    frame,
    original_index: index,
    source_position: index,
    width: frame.width,
    height: frame.height,
    hash: hashFunction(frame),
    bbox: alphaBBox(frame),
  }
}

function selectionWindows(count, targetCount) {
  if (targetCount >= count) return Array.from({ length: count }, (_, index) => ({ start: index, end: index, center: index }))
  if (targetCount === 1) return [{ start: 0, end: count - 1, center: (count - 1) / 2 }]
  const centers = Array.from({ length: targetCount }, (_, index) => (index * (count - 1)) / (targetCount - 1))
  return centers.map((center, index) => {
    const previousBoundary = index === 0 ? -0.5 : (centers[index - 1] + center) / 2
    const nextBoundary = index === targetCount - 1 ? count - 0.5 : (center + centers[index + 1]) / 2
    return {
      start: Math.max(0, Math.ceil(previousBoundary)),
      end: Math.min(count - 1, Math.floor(nextBoundary)),
      center,
    }
  })
}

function selectionScore(analysis) {
  return analysis.motion_delta?.score ?? 0
}

function chooseMotionAwarePositions(distinct, targetCount) {
  const count = distinct.length
  if (targetCount >= count) {
    return Array.from({ length: count }, (_, index) => ({
      position: index,
      window: { start: index, end: index },
      center: index,
    }))
  }

  const windows = selectionWindows(count, targetCount)
  return windows.map((window) => {
    let bestPosition = window.start
    for (let position = window.start + 1; position <= window.end; position += 1) {
      const best = distinct[bestPosition]
      const candidate = distinct[position]
      const scoreDelta = selectionScore(candidate) - selectionScore(best)
      const bestDistance = Math.abs(bestPosition - window.center)
      const candidateDistance = Math.abs(position - window.center)
      if (scoreDelta > 0.0001 || (Math.abs(scoreDelta) <= 0.0001 && candidateDistance < bestDistance)) {
        bestPosition = position
      }
    }
    return {
      position: bestPosition,
      window: { start: window.start, end: window.end },
      center: round(window.center, 4),
    }
  })
}

function publicFrame(analysis, extra = {}) {
  return {
    original_index: analysis.original_index,
    source_position: analysis.source_position,
    width: analysis.width,
    height: analysis.height,
    hash: analysis.hash,
    bbox: analysis.bbox,
    motion_delta: analysis.motion_delta,
    ...extra,
  }
}

function selectMotionFramesV1(frames, { targetFrameCount = 8 } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('motion_frames_required')
  assertPositiveInteger(targetFrameCount, 'target_frame_count')

  const warnings = []
  const analyzed = frames.map((frame, index) => buildFrameAnalysis(frame, index))
  const loop = compareLoopEndpoints(analyzed[0], analyzed[analyzed.length - 1])
  const seenHashes = new Map()
  const distinct = []
  const rejected = []
  let previousDistinct = null

  for (const analysis of analyzed) {
    const duplicate = seenHashes.get(analysis.hash)
    if (duplicate) {
      analysis.motion_delta = motionDelta(analysis, duplicate)
      rejected.push(publicFrame(analysis, {
        reason: 'duplicate_frame',
        duplicate_of: duplicate.original_index,
      }))
      continue
    }

    if (loop.seamless && analysis.original_index === frames.length - 1 && analysis.original_index !== 0) {
      analysis.motion_delta = motionDelta(analysis, previousDistinct)
      rejected.push(publicFrame(analysis, {
        reason: 'loop_closing_frame',
        loop_duplicate_of: analyzed[0].original_index,
        loop_similarity: loop.similarity,
      }))
      continue
    }

    const nearDuplicate = nearDuplicateEvidence(analysis, previousDistinct)
    if (nearDuplicate) {
      analysis.motion_delta = motionDelta(analysis, previousDistinct)
      rejected.push(publicFrame(analysis, {
        reason: 'near_duplicate_frame',
        near_duplicate_of: previousDistinct.original_index,
        near_duplicate_similarity: nearDuplicate.similarity,
        near_duplicate_evidence: nearDuplicate,
      }))
      continue
    }

    analysis.motion_delta = motionDelta(analysis, previousDistinct)
    distinct.push(analysis)
    seenHashes.set(analysis.hash, analysis)
    previousDistinct = analysis
  }

  if (distinct.length < targetFrameCount) warnings.push('too_few_distinct_frames')

  const selectedChoices = chooseMotionAwarePositions(distinct, Math.min(targetFrameCount, distinct.length))
  const choiceByPosition = new Map(selectedChoices.map((choice) => [choice.position, choice]))
  const selected = []
  for (let position = 0; position < distinct.length; position += 1) {
    const analysis = distinct[position]
    const choice = choiceByPosition.get(position)
    if (choice) {
      selected.push(publicFrame(analysis, {
        selection_index: selected.length,
        distinct_position: position,
        selection_score: selectionScore(analysis),
        selection_window: choice.window,
        reason: 'selected',
      }))
    } else {
      rejected.push(publicFrame(analysis, {
        reason: 'sampled_out',
        distinct_position: position,
        selection_score: selectionScore(analysis),
      }))
    }
  }

  rejected.sort((a, b) => a.original_index - b.original_index)

  if (frames.length > 1 && !loop.seamless) warnings.push('loop_not_seamless')

  return {
    input_frame_count: frames.length,
    distinct_frame_count: distinct.length,
    usable_frame_count: distinct.length,
    target_frame_count: targetFrameCount,
    selected,
    rejected,
    loop,
    warnings,
  }
}

function throwIfMotionSelectionAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('motion frame selection cancelled')
  error.code = 'cancelled'
  error.failure_status = 'cancelled'
  error.cause = signal.reason
  throw error
}

async function yieldMotionSelection(signal) {
  throwIfMotionSelectionAborted(signal)
  await new Promise((resolve) => setTimeout(resolve, 0))
  throwIfMotionSelectionAborted(signal)
}

function normalizeOptionalNonNegativeNumber(value, name) {
  if (value === undefined || value === null) return null
  if (!Number.isFinite(value) || value < 0) {
    throw motionSelectionError(
      'invalid_motion_frame_provenance',
      `Invalid motion frame provenance value: ${name}`,
      { field: name, value }
    )
  }
  return value
}

function normalizeFrameProvenance(frameProvenance, frameCount) {
  if (frameProvenance !== undefined && frameProvenance !== null && !Array.isArray(frameProvenance)) {
    throw motionSelectionError(
      'invalid_motion_frame_provenance',
      'frame provenance must be an aligned array'
    )
  }
  if (Array.isArray(frameProvenance) && frameProvenance.length !== frameCount) {
    throw motionSelectionError(
      'invalid_motion_frame_provenance',
      'frame provenance length must match frame count',
      { expected: frameCount, actual: frameProvenance.length }
    )
  }
  const timingSources = new Set(['exact', 'derived_sampling', 'unavailable'])
  return Array.from({ length: frameCount }, (_, index) => {
    const source = frameProvenance?.[index] ?? {}
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw motionSelectionError(
        'invalid_motion_frame_provenance',
        `Invalid frame provenance record: ${index}`,
        { candidate_index: index }
      )
    }
    const candidateIndex = source.candidate_index ?? index
    if (!Number.isInteger(candidateIndex) || candidateIndex !== index) {
      throw motionSelectionError(
        'invalid_motion_frame_provenance',
        `Frame provenance candidate index must align with its frame: ${index}`,
        { candidate_index: candidateIndex, expected_candidate_index: index }
      )
    }
    const rawIndex = source.raw_index ?? index
    if (!Number.isInteger(rawIndex) || rawIndex < 0) {
      throw motionSelectionError(
        'invalid_motion_frame_provenance',
        `Invalid raw frame index: ${String(rawIndex)}`,
        { candidate_index: index, raw_index: rawIndex }
      )
    }
    const timingSource = source.timing_source ?? 'unavailable'
    if (!timingSources.has(timingSource)) {
      throw motionSelectionError(
        'invalid_motion_frame_provenance',
        `Invalid timing source: ${String(timingSource)}`,
        { candidate_index: index, timing_source: timingSource }
      )
    }
    const sourceEntry = source.source_entry ?? null
    if (sourceEntry !== null && typeof sourceEntry !== 'string') {
      throw motionSelectionError(
        'invalid_motion_frame_provenance',
        `Invalid source entry: ${index}`,
        { candidate_index: index }
      )
    }
    return {
      candidate_index: index,
      raw_index: rawIndex,
      timestamp_ms: normalizeOptionalNonNegativeNumber(source.timestamp_ms, 'timestamp_ms'),
      duration_ms: normalizeOptionalNonNegativeNumber(source.duration_ms, 'duration_ms'),
      timing_source: timingSource,
      source_entry: sourceEntry,
    }
  })
}

function buildV2FrameAnalysis(frame, index, provenance) {
  const analysis = buildFrameAnalysis(frame, index, {
    hashFunction: hashRgbaFrameV2,
  })
  analysis.provenance = provenance
  return analysis
}

function createAnalysisRasterContext(frames) {
  const maxWidth = Math.max(...frames.map((frame) => frame.width))
  const maxHeight = Math.max(...frames.map((frame) => frame.height))
  const scale = Math.min(1, MOTION_SELECTION_ANALYSIS_MAX_SIDE / Math.max(maxWidth, maxHeight))
  return {
    width: Math.max(1, Math.round(maxWidth * scale)),
    height: Math.max(1, Math.round(maxHeight * scale)),
    source_width: maxWidth,
    source_height: maxHeight,
    scale,
  }
}

function createAnalysisRaster(frame, context) {
  const data = new Uint8ClampedArray(context.width * context.height * 4)
  const scaledWidth = Math.max(1, Math.round(frame.width * context.scale))
  const scaledHeight = Math.max(1, Math.round(frame.height * context.scale))
  for (let y = 0; y < Math.min(context.height, scaledHeight); y += 1) {
    const sourceY = Math.min(frame.height - 1, Math.floor((y * frame.height) / scaledHeight))
    for (let x = 0; x < Math.min(context.width, scaledWidth); x += 1) {
      const sourceX = Math.min(frame.width - 1, Math.floor((x * frame.width) / scaledWidth))
      const sourceOffset = (sourceY * frame.width + sourceX) * 4
      const targetOffset = (y * context.width + x) * 4
      data[targetOffset] = frame.data[sourceOffset]
      data[targetOffset + 1] = frame.data[sourceOffset + 1]
      data[targetOffset + 2] = frame.data[sourceOffset + 2]
      data[targetOffset + 3] = frame.data[sourceOffset + 3]
    }
  }
  return {
    width: context.width,
    height: context.height,
    data,
  }
}

function shiftAnalysisRaster(raster, shiftX, shiftY) {
  const data = new Uint8ClampedArray(raster.data.length)
  for (let y = 0; y < raster.height; y += 1) {
    const sourceY = y - shiftY
    if (sourceY < 0 || sourceY >= raster.height) continue
    for (let x = 0; x < raster.width; x += 1) {
      const sourceX = x - shiftX
      if (sourceX < 0 || sourceX >= raster.width) continue
      const sourceOffset = (sourceY * raster.width + sourceX) * 4
      const targetOffset = (y * raster.width + x) * 4
      data[targetOffset] = raster.data[sourceOffset]
      data[targetOffset + 1] = raster.data[sourceOffset + 1]
      data[targetOffset + 2] = raster.data[sourceOffset + 2]
      data[targetOffset + 3] = raster.data[sourceOffset + 3]
    }
  }
  return {
    width: raster.width,
    height: raster.height,
    data,
  }
}

function compareAnalysisRasters(a, b) {
  let unionPixels = 0
  let intersectionPixels = 0
  let changedPixels = 0
  let absoluteDelta = 0
  for (let offset = 0; offset < a.data.length; offset += 4) {
    const aVisible = a.data[offset + 3] > 0
    const bVisible = b.data[offset + 3] > 0
    if (!aVisible && !bVisible) continue
    unionPixels += 1
    if (aVisible && bVisible) intersectionPixels += 1
    const dr = Math.abs(a.data[offset] - b.data[offset])
    const dg = Math.abs(a.data[offset + 1] - b.data[offset + 1])
    const db = Math.abs(a.data[offset + 2] - b.data[offset + 2])
    const da = Math.abs(a.data[offset + 3] - b.data[offset + 3])
    const pixelDelta = dr + dg + db + da
    if (pixelDelta > 8) changedPixels += 1
    absoluteDelta += pixelDelta
  }
  if (!unionPixels) {
    return {
      comparable: true,
      pixel_similarity: 1,
      alpha_iou: 1,
      changed_pixel_ratio: 0,
      mean_absolute_rgba_delta: 0,
      similarity: 1,
    }
  }
  const meanAbsolute = absoluteDelta / (unionPixels * 4)
  const pixelSimilarity = clamp01(1 - meanAbsolute / 255)
  const alphaIou = intersectionPixels / unionPixels
  return {
    comparable: true,
    pixel_similarity: round(pixelSimilarity, 6),
    alpha_iou: round(alphaIou, 6),
    changed_pixel_ratio: round(changedPixels / unionPixels, 6),
    mean_absolute_rgba_delta: round(meanAbsolute, 4),
    similarity: round(pixelSimilarity * 0.65 + alphaIou * 0.35, 6),
  }
}

function clampRegistrationShift(value) {
  return Math.max(
    -MOTION_SELECTION_REGISTRATION_MAX_SHIFT,
    Math.min(MOTION_SELECTION_REGISTRATION_MAX_SHIFT, value)
  )
}

function registerAnalysisFrames(analyzed, context, signal) {
  const rasters = analyzed.map((analysis) => createAnalysisRaster(analysis.frame, context))
  const analysisBBoxes = rasters.map(alphaBBox)
  const referenceIndex = analysisBBoxes.findIndex(Boolean)
  const referenceRaster = referenceIndex >= 0 ? rasters[referenceIndex] : null
  const referenceBBox = referenceIndex >= 0 ? analysisBBoxes[referenceIndex] : null
  const reports = []

  for (let index = 0; index < analyzed.length; index += 1) {
    throwIfMotionSelectionAborted(signal)
    const analysis = analyzed[index]
    const raster = rasters[index]
    const bbox = analysisBBoxes[index]
    let shiftX = 0
    let shiftY = 0
    let status = 'not_applicable'
    let reason = bbox ? 'reference_unavailable' : 'empty_alpha'
    let comparison = compareAnalysisRasters(raster, raster)
    let registeredRaster = raster

    if (referenceRaster && bbox && referenceBBox) {
      if (index === referenceIndex) {
        status = 'reference'
        reason = null
      } else {
        const initialX = clampRegistrationShift(Math.round(referenceBBox.center_x - bbox.center_x))
        const initialY = clampRegistrationShift(Math.round(referenceBBox.center_y - bbox.center_y))
        let best = null
        for (
          let candidateY = Math.max(
            -MOTION_SELECTION_REGISTRATION_MAX_SHIFT,
            initialY - MOTION_SELECTION_REGISTRATION_LOCAL_RADIUS
          );
          candidateY <= Math.min(
            MOTION_SELECTION_REGISTRATION_MAX_SHIFT,
            initialY + MOTION_SELECTION_REGISTRATION_LOCAL_RADIUS
          );
          candidateY += 1
        ) {
          for (
            let candidateX = Math.max(
              -MOTION_SELECTION_REGISTRATION_MAX_SHIFT,
              initialX - MOTION_SELECTION_REGISTRATION_LOCAL_RADIUS
            );
            candidateX <= Math.min(
              MOTION_SELECTION_REGISTRATION_MAX_SHIFT,
              initialX + MOTION_SELECTION_REGISTRATION_LOCAL_RADIUS
            );
            candidateX += 1
          ) {
            const shifted = shiftAnalysisRaster(raster, candidateX, candidateY)
            const evidence = compareAnalysisRasters(referenceRaster, shifted)
            const magnitude = Math.abs(candidateX) + Math.abs(candidateY)
            if (
              !best ||
              evidence.similarity > best.evidence.similarity + 0.000001 ||
              (
                Math.abs(evidence.similarity - best.evidence.similarity) <= 0.000001 &&
                (
                  magnitude < best.magnitude ||
                  (magnitude === best.magnitude && candidateY < best.shiftY) ||
                  (magnitude === best.magnitude && candidateY === best.shiftY && candidateX < best.shiftX)
                )
              )
            ) {
              best = {
                shiftX: candidateX,
                shiftY: candidateY,
                magnitude,
                shifted,
                evidence,
              }
            }
          }
        }
        shiftX = best.shiftX
        shiftY = best.shiftY
        registeredRaster = best.shifted
        comparison = best.evidence
        status = 'registered'
        reason = null
      }
    }

    analysis.analysis_raster = raster
    analysis.registered_raster = registeredRaster
    analysis.registration = {
      candidate_index: analysis.original_index,
      raw_index: analysis.provenance.raw_index,
      status,
      reason,
      reference_candidate_index: referenceIndex >= 0 ? referenceIndex : null,
      raw_bbox: analysis.bbox,
      analysis_bbox: bbox,
      shift_x: shiftX,
      shift_y: shiftY,
      similarity_to_reference: comparison.similarity,
      residual_to_reference: round(1 - comparison.similarity, 6),
    }
    reports.push(analysis.registration)
  }

  return {
    status: 'completed',
    analysis_raster: {
      width: context.width,
      height: context.height,
      max_side: MOTION_SELECTION_ANALYSIS_MAX_SIDE,
      source_width: context.source_width,
      source_height: context.source_height,
      scale: round(context.scale, 6),
    },
    reference_candidate_index: referenceIndex >= 0 ? referenceIndex : null,
    search: {
      kind: 'integer_translation',
      max_shift: MOTION_SELECTION_REGISTRATION_MAX_SHIFT,
      local_radius: MOTION_SELECTION_REGISTRATION_LOCAL_RADIUS,
      analysis_only: true,
    },
    frames: reports,
  }
}

function createRegisteredPairCache(analyzed, signal) {
  const pairs = new Map()
  const keyFor = (left, right) => left < right ? `${left}:${right}` : `${right}:${left}`
  return {
    get(left, right) {
      if (left === right) {
        return {
          left_original_index: left,
          right_original_index: right,
          exact: true,
          comparable: true,
          pixel_similarity: 1,
          alpha_iou: 1,
          changed_pixel_ratio: 0,
          mean_absolute_rgba_delta: 0,
          similarity: 1,
        }
      }
      const key = keyFor(left, right)
      const cached = pairs.get(key)
      if (cached) return cached
      throwIfMotionSelectionAborted(signal)
      const firstIndex = Math.min(left, right)
      const secondIndex = Math.max(left, right)
      const first = analyzed[firstIndex]
      const second = analyzed[secondIndex]
      const rasterEvidence = compareAnalysisRasters(first.registered_raster, second.registered_raster)
      const exact = first.hash === second.hash
      const evidence = {
        left_original_index: firstIndex,
        right_original_index: secondIndex,
        exact,
        ...rasterEvidence,
      }
      pairs.set(key, evidence)
      return evidence
    },
    get size() {
      return pairs.size
    },
  }
}

function isV2NearDuplicatePair(evidence) {
  return evidence.exact || (
    evidence.similarity >= MOTION_SELECTION_CLUSTER_SIMILARITY_MIN &&
    evidence.changed_pixel_ratio <= MOTION_SELECTION_CLUSTER_CHANGED_RATIO_MAX &&
    evidence.alpha_iou >= MOTION_SELECTION_CLUSTER_ALPHA_IOU_MIN
  )
}

function buildCompleteLinkClusters(analyzed, pairCache, signal) {
  const clusters = []
  const clusterByFrame = new Array(analyzed.length)
  for (let index = 0; index < analyzed.length; index += 1) {
    throwIfMotionSelectionAborted(signal)
    let bestAdmission = null
    for (const cluster of clusters) {
      let weakestSimilarity = 1
      let admitted = true
      for (const memberIndex of cluster.member_indexes) {
        const evidence = pairCache.get(index, memberIndex)
        if (!isV2NearDuplicatePair(evidence)) {
          admitted = false
          break
        }
        weakestSimilarity = Math.min(weakestSimilarity, evidence.similarity)
      }
      if (!admitted) continue
      if (
        !bestAdmission ||
        weakestSimilarity > bestAdmission.weakest_similarity + 0.000001 ||
        (
          Math.abs(weakestSimilarity - bestAdmission.weakest_similarity) <= 0.000001 &&
          cluster.representative_original_index < bestAdmission.cluster.representative_original_index
        )
      ) {
        bestAdmission = {
          cluster,
          weakest_similarity: weakestSimilarity,
        }
      }
    }

    let cluster
    if (bestAdmission) {
      cluster = bestAdmission.cluster
      cluster.member_indexes.push(index)
      cluster.weakest_similarity = Math.min(
        cluster.weakest_similarity,
        bestAdmission.weakest_similarity
      )
    } else {
      cluster = {
        id: clusters.length,
        representative_original_index: index,
        member_indexes: [index],
        weakest_similarity: 1,
      }
      clusters.push(cluster)
    }
    clusterByFrame[index] = cluster.id
  }

  return {
    clusters,
    clusterByFrame,
  }
}

function rawBBoxCenterRange(analyzed) {
  const boxes = analyzed.map((analysis) => analysis.bbox).filter(Boolean)
  let maximum = 0
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      maximum = Math.max(
        maximum,
        Math.hypot(
          boxes[left].center_x - boxes[right].center_x,
          boxes[left].center_y - boxes[right].center_y
        )
      )
    }
  }
  return round(maximum, 4)
}

function evaluateStaticGate(analyzed, clusters, analysisContext) {
  const visibleFrameCount = analyzed.filter((analysis) => analysis.bbox).length
  const sourceCenterRange = rawBBoxCenterRange(analyzed)
  const analysisCenterRange = round(
    sourceCenterRange * Number(analysisContext?.scale ?? 1),
    4
  )
  const staticSequence =
    visibleFrameCount === 0 ||
    clusters.length <= 1
  return {
    status: staticSequence ? 'not_applicable_static' : 'motion_detected',
    static: staticSequence,
    visible_frame_count: visibleFrameCount,
    cluster_count: clusters.length,
    raw_bbox_center_range_source_pixels: sourceCenterRange,
    raw_bbox_center_range_analysis_pixels: analysisCenterRange,
  }
}

function scorePeriodicity(analyzed, clusterByFrame, clusters, staticGate, pairCache, signal) {
  if (staticGate.static) {
    return {
      status: 'not_applicable_static',
      selected_period: null,
      confidence: 0,
      candidates: [],
      harmonic_decisions: [],
    }
  }
  const candidates = []
  const maxLag = Math.floor(analyzed.length / 2)
  for (let lag = 1; lag <= maxLag; lag += 1) {
    throwIfMotionSelectionAborted(signal)
    const pairCount = analyzed.length - lag
    if (pairCount < 2) continue
    let similarityTotal = 0
    let minimumSimilarity = 1
    let clusterRepeatCount = 0
    for (let index = 0; index < pairCount; index += 1) {
      const evidence = pairCache.get(index, index + lag)
      similarityTotal += evidence.similarity
      minimumSimilarity = Math.min(minimumSimilarity, evidence.similarity)
      if (clusterByFrame[index] === clusterByFrame[index + lag]) {
        clusterRepeatCount += 1
      }
    }
    const meanSimilarity = similarityTotal / pairCount
    const coverage = pairCount / Math.max(1, analyzed.length - 1)
    const phaseClusterCount = new Set(clusterByFrame.slice(0, lag)).size
    const phaseDiversity = phaseClusterCount / Math.max(1, Math.min(lag, clusters.length))
    const clusterRepeatRatio = clusterRepeatCount / pairCount
    const score = meanSimilarity * 0.85 + coverage * 0.1 + phaseDiversity * 0.05
    candidates.push({
      lag,
      pair_count: pairCount,
      mean_similarity: round(meanSimilarity, 6),
      minimum_similarity: round(minimumSimilarity, 6),
      coverage: round(coverage, 6),
      phase_cluster_count: phaseClusterCount,
      phase_diversity: round(phaseDiversity, 6),
      cluster_repeat_ratio: round(clusterRepeatRatio, 6),
      score: round(score, 6),
      credible:
        lag > 1 &&
        meanSimilarity >= MOTION_SELECTION_PERIODICITY_SIMILARITY_MIN &&
        score >= MOTION_SELECTION_PERIODICITY_SCORE_MIN &&
        phaseDiversity >= 0.5 &&
        clusterRepeatRatio >= 0.75,
    })
  }

  const credibleByLag = candidates
    .filter((candidate) => candidate.credible)
    .sort((a, b) => a.lag - b.lag)
  if (!credibleByLag.length) {
    return {
      status: 'not_confident',
      selected_period: null,
      confidence: 0,
      candidates,
      harmonic_decisions: [],
    }
  }

  const rejectedHarmonics = new Set()
  const harmonicDecisions = []
  for (let smallerIndex = 0; smallerIndex < credibleByLag.length; smallerIndex += 1) {
    const smaller = credibleByLag[smallerIndex]
    for (let largerIndex = smallerIndex + 1; largerIndex < credibleByLag.length; largerIndex += 1) {
      const larger = credibleByLag[largerIndex]
      if (larger.lag % smaller.lag !== 0) continue
      const clearFundamental =
        smaller.mean_similarity >= larger.mean_similarity - 0.01 &&
        smaller.minimum_similarity >= 0.94 &&
        smaller.phase_diversity >= 0.75 &&
        smaller.cluster_repeat_ratio >= 0.9
      if (!clearFundamental) continue
      rejectedHarmonics.add(larger.lag)
      harmonicDecisions.push({
        rejected_lag: larger.lag,
        fundamental_lag: smaller.lag,
        ratio: larger.lag / smaller.lag,
        reason: 'integer_multiple_harmonic',
      })
    }
  }

  const finalists = credibleByLag
    .filter((candidate) => !rejectedHarmonics.has(candidate.lag))
    .sort((a, b) => b.score - a.score || a.lag - b.lag)
  const best = finalists[0]
  const ambiguousPairs = []
  for (let left = 0; left < finalists.length; left += 1) {
    for (let right = left + 1; right < finalists.length; right += 1) {
      const first = finalists[left]
      const second = finalists[right]
      const harmonicPair =
        Math.max(first.lag, second.lag) % Math.min(first.lag, second.lag) === 0
      if (
        harmonicPair &&
        Math.abs(first.mean_similarity - second.mean_similarity) <=
          MOTION_SELECTION_PERIODICITY_AMBIGUITY_DELTA
      ) {
        ambiguousPairs.push([first, second])
      }
    }
  }
  if (ambiguousPairs.length) {
    ambiguousPairs.sort((a, b) => (
      Math.max(b[0].score, b[1].score) - Math.max(a[0].score, a[1].score) ||
      Math.min(a[0].lag, a[1].lag) - Math.min(b[0].lag, b[1].lag)
    ))
    const [first, second] = ambiguousPairs[0]
    return {
      status: 'ambiguous_harmonic',
      selected_period: null,
      confidence: round(Math.max(first.score, second.score), 6),
      ambiguous_lags: [first.lag, second.lag].sort((a, b) => a - b),
      candidates,
      harmonic_decisions: harmonicDecisions,
    }
  }

  return {
    status: 'detected',
    selected_period: best.lag,
    confidence: round(best.score, 6),
    candidates,
    harmonic_decisions: harmonicDecisions,
  }
}

function chooseUniformFrameAnalyses(analyses, targetFrameCount, mode) {
  if (targetFrameCount >= analyses.length) return analyses.slice()
  if (targetFrameCount === 1) {
    return [analyses[mode === 'loop' ? 0 : Math.floor((analyses.length - 1) / 2)]]
  }
  const positions = []
  for (let index = 0; index < targetFrameCount; index += 1) {
    const position = mode === 'loop'
      ? Math.floor((index * analyses.length) / targetFrameCount)
      : Math.round((index * (analyses.length - 1)) / (targetFrameCount - 1))
    if (positions[positions.length - 1] !== position) positions.push(position)
  }
  return positions.map((position) => analyses[position])
}

function selectV2Phases({
  representatives,
  targetFrameCount,
  loopExpectation,
  periodicity,
  warnings,
}) {
  const periodicLoopAvailable =
    periodicity.status === 'detected' &&
    Number.isInteger(periodicity.selected_period) &&
    periodicity.selected_period > 1
  const useLoop =
    loopExpectation === MOTION_SELECTION_LOOP_EXPECTATIONS.LOOP
      ? periodicLoopAvailable
      : (
        loopExpectation === MOTION_SELECTION_LOOP_EXPECTATIONS.AUTO &&
        periodicLoopAvailable
      )
  if (
    loopExpectation === MOTION_SELECTION_LOOP_EXPECTATIONS.LOOP &&
    !periodicLoopAvailable
  ) {
    warnings.push('loop_period_not_confident')
  }
  if (periodicity.status === 'ambiguous_harmonic') {
    warnings.push('ambiguous_harmonic')
  }

  const effectiveMode = useLoop ? 'loop' : 'once'
  const eligible = useLoop
    ? representatives.filter(
      (analysis) => analysis.original_index < periodicity.selected_period
    )
    : representatives
  const selected = chooseUniformFrameAnalyses(
    eligible,
    Math.min(targetFrameCount, eligible.length),
    effectiveMode
  )
  return {
    selected,
    eligible,
    report: {
      status: 'selected',
      requested_mode: loopExpectation,
      effective_mode: effectiveMode,
      selected_period: useLoop ? periodicity.selected_period : null,
      cycle: useLoop
        ? {
          start_candidate_index: 0,
          end_candidate_index_exclusive: periodicity.selected_period,
        }
        : null,
      span: useLoop
        ? null
        : {
          start_candidate_index: eligible[0]?.original_index ?? null,
          end_candidate_index: eligible[eligible.length - 1]?.original_index ?? null,
        },
      eligible_original_indexes: eligible.map((analysis) => analysis.original_index),
      selected_original_indexes: selected.map((analysis) => analysis.original_index),
    },
  }
}

function temporalMatteEvidence(analyzed, mode, signal) {
  if (mode === MOTION_SELECTION_TEMPORAL_MATTE_MODES.DISABLED) {
    return {
      status: 'disabled',
      modifies_pixels: false,
      warnings: [],
    }
  }
  throwIfMotionSelectionAborted(signal)
  const frameCount = analyzed.length
  const pixelCount = analyzed[0].registered_raster.width * analyzed[0].registered_raster.height
  let unionPixels = 0
  let stablePixels = 0
  let variablePixels = 0
  let alphaFlickerTotal = 0
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const alphaOffset = pixel * 4 + 3
    let visibleCount = 0
    let minimumAlpha = 255
    let maximumAlpha = 0
    for (const analysis of analyzed) {
      const alpha = analysis.registered_raster.data[alphaOffset]
      if (alpha > 0) visibleCount += 1
      minimumAlpha = Math.min(minimumAlpha, alpha)
      maximumAlpha = Math.max(maximumAlpha, alpha)
    }
    if (visibleCount === 0) continue
    unionPixels += 1
    if (visibleCount === frameCount) stablePixels += 1
    else variablePixels += 1
    alphaFlickerTotal += (maximumAlpha - minimumAlpha) / 255
  }
  return {
    status: 'evidence_only',
    modifies_pixels: false,
    analysis_frame_count: frameCount,
    union_pixel_count: unionPixels,
    stable_foreground_ratio: round(stablePixels / Math.max(1, unionPixels), 6),
    variable_occupancy_ratio: round(variablePixels / Math.max(1, unionPixels), 6),
    mean_alpha_flicker: round(alphaFlickerTotal / Math.max(1, unionPixels), 6),
    warnings: ['temporal_matte_motion_confounded'],
  }
}

function publicV2Frame(analysis, extra = {}) {
  return publicFrame(analysis, {
    candidate_index: analysis.original_index,
    raw_index: analysis.provenance.raw_index,
    timestamp_ms: analysis.provenance.timestamp_ms,
    duration_ms: analysis.provenance.duration_ms,
    timing_source: analysis.provenance.timing_source,
    source_entry: analysis.provenance.source_entry,
    provenance: analysis.provenance,
    registration: analysis.registration,
    ...extra,
  })
}

function validateMotionSelectionV2Input(frames, targetFrameCount) {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('motion_frames_required')
  assertPositiveInteger(targetFrameCount, 'target_frame_count')
  if (frames.length > MOTION_SELECTION_V2_MAX_FRAMES) {
    throw motionSelectionError(
      'motion_selection_v2_frame_limit_exceeded',
      `Motion Selection v2 accepts at most ${MOTION_SELECTION_V2_MAX_FRAMES} frames`,
      { frame_count: frames.length, max_frame_count: MOTION_SELECTION_V2_MAX_FRAMES }
    )
  }
  let inputRgbaBytes = 0
  for (let index = 0; index < frames.length; index += 1) {
    assertFrame(frames[index], index)
    if (frames[index].data.length > MOTION_SELECTION_V2_MAX_FRAME_RGBA_BYTES) {
      throw motionSelectionError(
        'motion_selection_v2_frame_byte_limit_exceeded',
        'Motion Selection v2 frame exceeds the fixed RGBA byte limit',
        {
          candidate_index: index,
          frame_rgba_bytes: frames[index].data.length,
          max_frame_rgba_bytes: MOTION_SELECTION_V2_MAX_FRAME_RGBA_BYTES,
        }
      )
    }
    inputRgbaBytes += frames[index].data.length
    if (inputRgbaBytes > MOTION_SELECTION_V2_MAX_RGBA_BYTES) {
      throw motionSelectionError(
        'motion_selection_v2_byte_limit_exceeded',
        'Motion Selection v2 input exceeds the fixed RGBA byte limit',
        {
          input_rgba_bytes: inputRgbaBytes,
          max_rgba_bytes: MOTION_SELECTION_V2_MAX_RGBA_BYTES,
        }
      )
    }
  }
  return inputRgbaBytes
}

function initializeMotionSelectionV2(frames, {
  targetFrameCount,
  motionSelection,
  frameProvenance,
  signal,
}) {
  const inputRgbaBytes = validateMotionSelectionV2Input(frames, targetFrameCount)
  throwIfMotionSelectionAborted(signal)
  const provenance = normalizeFrameProvenance(frameProvenance, frames.length)
  const analyzed = frames.map((frame, index) => buildV2FrameAnalysis(frame, index, provenance[index]))
  for (let index = 0; index < analyzed.length; index += 1) {
    analyzed[index].motion_delta = motionDelta(analyzed[index], analyzed[index - 1] ?? null)
  }
  const endpointLoop = compareLoopEndpoints(analyzed[0], analyzed[analyzed.length - 1])
  const analysisContext = createAnalysisRasterContext(frames)
  return {
    frames,
    targetFrameCount,
    motionSelection,
    signal,
    provenance,
    analyzed,
    endpointLoop,
    analysisContext,
    inputRgbaBytes,
  }
}

async function initializeMotionSelectionV2Async(frames, {
  targetFrameCount,
  motionSelection,
  frameProvenance,
  signal,
}) {
  const inputRgbaBytes = validateMotionSelectionV2Input(frames, targetFrameCount)
  throwIfMotionSelectionAborted(signal)
  const provenance = normalizeFrameProvenance(frameProvenance, frames.length)
  const analyzed = []
  for (let index = 0; index < frames.length; index += 1) {
    const analysis = buildV2FrameAnalysis(frames[index], index, provenance[index])
    analysis.motion_delta = motionDelta(analysis, analyzed[index - 1] ?? null)
    analyzed.push(analysis)
    await yieldMotionSelection(signal)
  }
  const endpointLoop = compareLoopEndpoints(analyzed[0], analyzed[analyzed.length - 1])
  await yieldMotionSelection(signal)
  return {
    frames,
    targetFrameCount,
    motionSelection,
    signal,
    provenance,
    analyzed,
    endpointLoop,
    analysisContext: createAnalysisRasterContext(frames),
    inputRgbaBytes,
  }
}

function registerMotionSelectionV2(state) {
  const registration = registerAnalysisFrames(
    state.analyzed,
    state.analysisContext,
    state.signal
  )
  throwIfMotionSelectionAborted(state.signal)
  return { ...state, registration }
}

function clusterMotionSelectionV2(state) {
  const pairCache = createRegisteredPairCache(state.analyzed, state.signal)
  const { clusters, clusterByFrame } = buildCompleteLinkClusters(
    state.analyzed,
    pairCache,
    state.signal
  )
  throwIfMotionSelectionAborted(state.signal)
  return { ...state, pairCache, clusters, clusterByFrame }
}

function periodMotionSelectionV2(state) {
  const staticGate = evaluateStaticGate(
    state.analyzed,
    state.clusters,
    state.analysisContext
  )
  const periodicity = scorePeriodicity(
    state.analyzed,
    state.clusterByFrame,
    state.clusters,
    staticGate,
    state.pairCache,
    state.signal
  )
  throwIfMotionSelectionAborted(state.signal)
  return { ...state, staticGate, periodicity }
}

function finalizeMotionSelectionV2(state) {
  const {
    frames,
    targetFrameCount,
    motionSelection,
    signal,
    provenance,
    analyzed,
    endpointLoop,
    registration,
    pairCache,
    clusters,
    clusterByFrame,
    staticGate,
    periodicity,
    inputRgbaBytes,
  } = state
  const warnings = []
  const representatives = clusters.map(
    (cluster) => analyzed[cluster.representative_original_index]
  )
  const phaseSelection = selectV2Phases({
    representatives,
    targetFrameCount,
    loopExpectation: motionSelection.loop_expectation,
    periodicity,
    warnings,
  })
  const selectedIndexSet = new Set(
    phaseSelection.selected.map((analysis) => analysis.original_index)
  )
  const eligibleIndexSet = new Set(
    phaseSelection.eligible.map((analysis) => analysis.original_index)
  )
  const clusterPositionByRepresentative = new Map(
    clusters.map((cluster, position) => [cluster.representative_original_index, position])
  )
  const selected = []
  const rejected = []

  for (const analysis of analyzed) {
    throwIfMotionSelectionAborted(signal)
    const cluster = clusters[clusterByFrame[analysis.original_index]]
    const representativeIndex = cluster.representative_original_index
    if (analysis.original_index !== representativeIndex) {
      const evidence = pairCache.get(analysis.original_index, representativeIndex)
      if (evidence.exact) {
        rejected.push(publicV2Frame(analysis, {
          reason: 'duplicate_frame',
          duplicate_of: representativeIndex,
          cluster_id: cluster.id,
        }))
      } else {
        rejected.push(publicV2Frame(analysis, {
          reason: 'near_duplicate_frame',
          near_duplicate_of: representativeIndex,
          near_duplicate_scope: 'global_complete_link',
          near_duplicate_similarity: evidence.similarity,
          near_duplicate_evidence: evidence,
          cluster_id: cluster.id,
        }))
      }
      continue
    }
    if (selectedIndexSet.has(analysis.original_index)) {
      selected.push(publicV2Frame(analysis, {
        selection_index: selected.length,
        distinct_position: clusterPositionByRepresentative.get(analysis.original_index),
        selection_score: selectionScore(analysis),
        phase_mode: phaseSelection.report.effective_mode,
        reason: 'selected',
      }))
      continue
    }
    rejected.push(publicV2Frame(analysis, {
      reason: eligibleIndexSet.has(analysis.original_index)
        ? 'phase_sampled_out'
        : 'outside_selected_cycle',
      distinct_position: clusterPositionByRepresentative.get(analysis.original_index),
      selection_score: selectionScore(analysis),
    }))
  }
  rejected.sort((a, b) => a.original_index - b.original_index)

  const targetSatisfied = selected.length === targetFrameCount
  const shortfallCount = Math.max(0, targetFrameCount - selected.length)
  if (!targetSatisfied) warnings.push('insufficient_distinct_phases')
  const temporalMatte = temporalMatteEvidence(
    analyzed,
    motionSelection.temporal_matte,
    signal
  )
  throwIfMotionSelectionAborted(signal)

  return {
    mode: 'motion_selection_report_v2',
    schema_version: 2,
    status: targetSatisfied ? 'selected' : 'insufficient_target',
    recipe: motionSelection.recipe,
    settings: motionSelection,
    input_frame_count: frames.length,
    distinct_frame_count: clusters.length,
    usable_frame_count: representatives.length,
    target_frame_count: targetFrameCount,
    selected,
    rejected,
    loop: {
      start_original_index: selected[0]?.original_index ?? null,
      end_original_index: selected[selected.length - 1]?.original_index ?? null,
      compared_indexes: endpointLoop.compared_indexes,
      similarity:
        phaseSelection.report.effective_mode === 'loop'
          ? periodicity.confidence
          : null,
      seamless:
        phaseSelection.report.effective_mode === 'loop'
          ? true
          : null,
      endpoint_evidence: endpointLoop,
      expectation: motionSelection.loop_expectation,
      periodicity_status: periodicity.status,
      detected_period: periodicity.selected_period,
      phase_mode: phaseSelection.report.effective_mode,
      periodic_cycle_detected: phaseSelection.report.effective_mode === 'loop',
    },
    warnings,
    provenance,
    registration,
    clusters: {
      status: 'completed',
      algorithm: 'complete_link',
      comparison_space: 'registered_analysis_raster',
      raw_rgba_pair_scan_count: 0,
      pair_comparison_count: pairCache.size,
      pair_comparison_limit:
        (MOTION_SELECTION_V2_MAX_FRAMES * (MOTION_SELECTION_V2_MAX_FRAMES - 1)) / 2,
      items: clusters.map((cluster) => ({
        id: cluster.id,
        representative_original_index: cluster.representative_original_index,
        representative_raw_index:
          analyzed[cluster.representative_original_index].provenance.raw_index,
        member_original_indexes: cluster.member_indexes.slice(),
        member_raw_indexes: cluster.member_indexes.map(
          (index) => analyzed[index].provenance.raw_index
        ),
        weakest_similarity: round(cluster.weakest_similarity, 6),
      })),
    },
    static_gate: staticGate,
    periodicity,
    phase_selection: phaseSelection.report,
    temporal_matte: temporalMatte,
    target: {
      status: targetSatisfied ? 'satisfied' : 'insufficient_target',
      target_satisfied: targetSatisfied,
      target_frame_count: targetFrameCount,
      selected_frame_count: selected.length,
      shortfall_count: shortfallCount,
    },
    limits: {
      max_frame_count: MOTION_SELECTION_V2_MAX_FRAMES,
      max_frame_rgba_bytes: MOTION_SELECTION_V2_MAX_FRAME_RGBA_BYTES,
      max_rgba_bytes: MOTION_SELECTION_V2_MAX_RGBA_BYTES,
      input_rgba_bytes: inputRgbaBytes,
      analysis_max_side: MOTION_SELECTION_ANALYSIS_MAX_SIDE,
    },
  }
}

function selectMotionFramesV2(frames, options) {
  const initialized = initializeMotionSelectionV2(frames, options)
  const registered = registerMotionSelectionV2(initialized)
  const clustered = clusterMotionSelectionV2(registered)
  const periodized = periodMotionSelectionV2(clustered)
  return finalizeMotionSelectionV2(periodized)
}

async function selectMotionFramesV2Async(frames, options) {
  const initialized = await initializeMotionSelectionV2Async(frames, options)
  const registered = registerMotionSelectionV2(initialized)
  await yieldMotionSelection(options.signal)
  const clustered = clusterMotionSelectionV2(registered)
  await yieldMotionSelection(options.signal)
  const periodized = periodMotionSelectionV2(clustered)
  await yieldMotionSelection(options.signal)
  return finalizeMotionSelectionV2(periodized)
}

function attachFrameProvenanceToV1Report(report, frameProvenance, frameCount) {
  if (frameProvenance === undefined || frameProvenance === null) return report
  const provenance = normalizeFrameProvenance(frameProvenance, frameCount)
  const enrich = (frame) => {
    const item = provenance[frame.original_index]
    return {
      ...frame,
      candidate_index: frame.original_index,
      raw_index: item.raw_index,
      timestamp_ms: item.timestamp_ms,
      duration_ms: item.duration_ms,
      timing_source: item.timing_source,
      source_entry: item.source_entry,
      provenance: item,
    }
  }
  return {
    ...report,
    provenance,
    selected: report.selected.map(enrich),
    rejected: report.rejected.map(enrich),
  }
}

export function selectMotionFrames(frames, {
  targetFrameCount = 8,
  motionSelection = false,
  frameProvenance = null,
  signal = null,
} = {}) {
  const normalizedMotionSelection = normalizeMotionSelectionOptions(motionSelection)
  if (normalizedMotionSelection.recipe === MOTION_SELECTION_RECIPE_IDS.V1_COMPAT) {
    return attachFrameProvenanceToV1Report(
      selectMotionFramesV1(frames, { targetFrameCount }),
      frameProvenance,
      frames.length
    )
  }
  return selectMotionFramesV2(frames, {
    targetFrameCount,
    motionSelection: normalizedMotionSelection,
    frameProvenance,
    signal,
  })
}

export async function selectMotionFramesAsync(frames, {
  targetFrameCount = 8,
  motionSelection = false,
  frameProvenance = null,
  signal = null,
} = {}) {
  const normalizedMotionSelection = normalizeMotionSelectionOptions(motionSelection)
  if (normalizedMotionSelection.recipe === MOTION_SELECTION_RECIPE_IDS.V1_COMPAT) {
    return attachFrameProvenanceToV1Report(
      selectMotionFramesV1(frames, { targetFrameCount }),
      frameProvenance,
      frames.length
    )
  }
  return selectMotionFramesV2Async(frames, {
    targetFrameCount,
    motionSelection: normalizedMotionSelection,
    frameProvenance,
    signal,
  })
}
