import { createHash } from 'node:crypto'

import { cloneRgba } from './imageMath.js'

export const EQUIPMENT_POLICY = Object.freeze({
  NONE: 'none',
  PRESERVE: 'preserve',
  SEPARATE: 'separate',
})

export const EQUIPMENT_POLICIES = Object.freeze(Object.values(EQUIPMENT_POLICY))

const EQUIPMENT_POLICY_SET = new Set(EQUIPMENT_POLICIES)

function policyError() {
  return new TypeError('equipment policy must be none, preserve, or separate')
}

export function normalizeEquipmentPolicy(value, { defaultPolicy = EQUIPMENT_POLICY.NONE } = {}) {
  if (!EQUIPMENT_POLICY_SET.has(defaultPolicy)) throw policyError()
  if (value == null || value === '') return defaultPolicy
  if (typeof value !== 'string') throw policyError()
  const normalized = value.trim().toLowerCase()
  if (!EQUIPMENT_POLICY_SET.has(normalized)) throw policyError()
  return normalized
}

export function equipmentPolicyContract(value, options = {}) {
  const policy = normalizeEquipmentPolicy(value, options)
  return Object.freeze({
    policy,
    body_layer_equipment_free: policy !== EQUIPMENT_POLICY.PRESERVE,
    inline_equipment_allowed: policy === EQUIPMENT_POLICY.PRESERVE,
    separate_attachment_layer: policy === EQUIPMENT_POLICY.SEPARATE,
    automatic_acceptance_allowed: false,
    automatic_retry_allowed: false,
  })
}

export function equipmentPromptRules(value, options = {}) {
  const policy = normalizeEquipmentPolicy(value, options)
  if (policy === EQUIPMENT_POLICY.NONE) {
    return Object.freeze([
      'Equipment policy: none. The character must be visibly unarmed with empty hands in every frame.',
      'Do not draw or imply any sword, blade, knife, dagger, spear, axe, bow, arrow, staff, wand, shield, gun, tool, prop, held object, scabbard, holster, or equipment silhouette, even if the written instruction or a reference image contains one.',
      'Do not replace a forbidden item with a metallic streak, detached line, motion trail, highlight, or hand-adjacent protrusion.',
      'This equipment policy is the final authority and overrides every contrary equipment word in the character description, repair instruction, metadata, or reference image.',
    ])
  }
  if (policy === EQUIPMENT_POLICY.SEPARATE) {
    return Object.freeze([
      'Equipment policy: separate. Render only the equipment-free body layer with empty hands.',
      'Do not bake weapons, shields, tools, props, scabbards, holsters, or held objects into the body image; equipment belongs only in a separate transparent attachment layer.',
      'Do not copy equipment pixels or equipment silhouettes from any reference image into the body layer.',
      'This equipment policy is the final authority and overrides every contrary equipment word in the character description, repair instruction, metadata, or reference image.',
    ])
  }
  return Object.freeze([
    'Equipment policy: preserve. Preserve only equipment explicitly present in the approved character description or parent frame.',
    'Do not invent, add, replace, enlarge, duplicate, or move any weapon, shield, tool, prop, or held object.',
  ])
}

function assertRgba(image, label) {
  const pixelCount = image?.width * image?.height
  if (!image || !Number.isSafeInteger(image.width) || image.width <= 0 ||
      !Number.isSafeInteger(image.height) || image.height <= 0 ||
      !Number.isSafeInteger(pixelCount) ||
      !(image.data instanceof Uint8ClampedArray) || image.data.length !== pixelCount * 4) {
    throw new TypeError(`${label} must be a valid RGBA image`)
  }
}

function assertMatchingImage(image, reference, label) {
  if (reference == null) return
  assertRgba(reference, label)
  if (reference.width !== image.width || reference.height !== image.height) {
    throw new TypeError(`${label} dimensions must match the candidate image`)
  }
}

function rgbaChanged(left, right, pixel) {
  if (!left) return true
  const offset = pixel * 4
  const alphaDelta = Math.abs(left.data[offset + 3] - right.data[offset + 3])
  const rgbDelta = Math.abs(left.data[offset] - right.data[offset]) +
    Math.abs(left.data[offset + 1] - right.data[offset + 1]) +
    Math.abs(left.data[offset + 2] - right.data[offset + 2])
  return alphaDelta >= 32 || rgbDelta >= 72
}

function visibleMask(image) {
  const mask = new Uint8Array(image.width * image.height)
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (image.data[pixel * 4 + 3] > 0) mask[pixel] = 1
  }
  return mask
}

function dilateMask(mask, width, height, radius) {
  if (radius <= 0) return new Uint8Array(mask)
  const output = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let visible = false
      for (let dy = -radius; dy <= radius && !visible; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          if (mask[ny * width + nx]) {
            visible = true
            break
          }
        }
      }
      if (visible) output[y * width + x] = 1
    }
  }
  return output
}

function maskBounds(mask, width, height) {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (!mask[pixel]) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) return null
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1, right, bottom }
}

function connectedComponents(mask, width, height) {
  const seen = new Uint8Array(mask.length)
  const components = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue
    const pixels = []
    const queue = [start]
    seen[start] = 1
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor]
      pixels.push(pixel)
      const x = pixel % width
      const y = Math.floor(pixel / width)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const next = ny * width + nx
          if (!mask[next] || seen[next]) continue
          seen[next] = 1
          queue.push(next)
        }
      }
    }
    const componentMask = new Uint8Array(mask.length)
    for (const pixel of pixels) componentMask[pixel] = 1
    components.push({ pixels, bbox: maskBounds(componentMask, width, height) })
  }
  return components.sort((left, right) => right.pixels.length - left.pixels.length)
}

function componentMetrics(component, { candidate, before, envelope, bodyBounds }) {
  const { bbox, pixels } = component
  let changed = 0
  let outside = 0
  let peripheral = 0
  let metallic = 0
  const bodyCenterX = bodyBounds ? bodyBounds.x + (bodyBounds.w - 1) / 2 : (candidate.width - 1) / 2
  const bodyQuarter = bodyBounds ? Math.max(1, bodyBounds.w * 0.2) : Math.max(1, candidate.width * 0.15)
  const handTop = bodyBounds ? bodyBounds.y + bodyBounds.h * 0.25 : candidate.height * 0.2
  const handBottom = bodyBounds ? bodyBounds.y + bodyBounds.h * 0.92 : candidate.height * 0.92
  for (const pixel of pixels) {
    if (rgbaChanged(before, candidate, pixel)) changed += 1
    if (envelope && !envelope[pixel]) outside += 1
    const x = pixel % candidate.width
    const y = Math.floor(pixel / candidate.width)
    if (Math.abs(x - bodyCenterX) >= bodyQuarter && y >= handTop && y <= handBottom) peripheral += 1
    const offset = pixel * 4
    const r = candidate.data[offset]
    const g = candidate.data[offset + 1]
    const b = candidate.data[offset + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const luma = (r * 299 + g * 587 + b * 114) / 1000
    if (candidate.data[offset + 3] > 0 && max - min <= 42 && luma >= 68 && luma <= 252) metallic += 1
  }
  const area = pixels.length
  const span = Math.max(bbox.w, bbox.h)
  const minor = Math.max(1, Math.min(bbox.w, bbox.h))
  return {
    area,
    span,
    aspect_ratio: Number((span / minor).toFixed(4)),
    fill_ratio: Number((area / (bbox.w * bbox.h)).toFixed(4)),
    changed_pixel_count: changed,
    changed_ratio: Number((changed / area).toFixed(4)),
    outside_reference_ratio: Number((outside / area).toFixed(4)),
    hand_zone_ratio: Number((peripheral / area).toFixed(4)),
    metallic_ratio: Number((metallic / area).toFixed(4)),
  }
}

function unionInto(target, pixels) {
  for (const pixel of pixels) target[pixel] = 1
}

export function equipmentMaskEvidence(mask, width, height) {
  if (!(mask instanceof Uint8Array) || mask.length !== width * height) {
    throw new TypeError('equipment mask dimensions are invalid')
  }
  const runs = []
  for (let start = 0; start < mask.length;) {
    if (!mask[start]) {
      start += 1
      continue
    }
    let end = start + 1
    while (end < mask.length && mask[end]) end += 1
    runs.push({ start, length: end - start })
    start = end
  }
  const activePixelCount = runs.reduce((sum, run) => sum + run.length, 0)
  const sha256 = createHash('sha256')
    .update(JSON.stringify({ width, height, runs }))
    .digest('hex')
  return { width, height, runs, active_pixel_count: activePixelCount, sha256 }
}

export function equipmentMaskBits(maskEvidence) {
  const width = maskEvidence?.width
  const height = maskEvidence?.height
  if (!Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0 || !Array.isArray(maskEvidence?.runs)) {
    throw new TypeError('equipment mask evidence is invalid')
  }
  const bits = new Uint8Array(width * height)
  let previousEnd = -1
  for (const run of maskEvidence.runs) {
    if (!Number.isSafeInteger(run?.start) || run.start < 0 ||
        !Number.isSafeInteger(run?.length) || run.length <= 0 ||
        run.start <= previousEnd || run.start + run.length > bits.length) {
      throw new TypeError('equipment mask evidence is invalid')
    }
    bits.fill(1, run.start, run.start + run.length)
    previousEnd = run.start + run.length - 1
  }
  return bits
}

export function evaluateEquipmentQualityGate({
  candidate,
  before = null,
  template = null,
  equipmentPolicy = EQUIPMENT_POLICY.NONE,
  requireRemovalEvidence = false,
  preferTemplateEnvelope = false,
} = {}) {
  assertRgba(candidate, 'candidate')
  assertMatchingImage(candidate, before, 'before image')
  assertMatchingImage(candidate, template, 'template image')
  if (typeof requireRemovalEvidence !== 'boolean') {
    throw new TypeError('requireRemovalEvidence must be a boolean')
  }
  if (typeof preferTemplateEnvelope !== 'boolean') {
    throw new TypeError('preferTemplateEnvelope must be a boolean')
  }
  const policy = normalizeEquipmentPolicy(equipmentPolicy)
  const bodyContract = equipmentPolicyContract(policy)
  const pixelCount = candidate.width * candidate.height
  const candidateAlpha = visibleMask(candidate)
  const bodyBounds = maskBounds(candidateAlpha, candidate.width, candidate.height)
  const comparisonReference = preferTemplateEnvelope && template ? template : before ?? template
  const referenceAlpha = comparisonReference ? visibleMask(comparisonReference) : null
  const envelopeRadius = Math.max(1, Math.round(Math.min(candidate.width, candidate.height) / 48))
  const envelope = referenceAlpha
    ? dilateMask(referenceAlpha, candidate.width, candidate.height, envelopeRadius)
    : null
  const rejected = new Uint8Array(pixelCount)
  const detections = []

  function addDetection(kind, component, metrics) {
    // A shape already present in the approved reference is not evidence that
    // this repair introduced equipment. Require a small but real changed
    // component so stable grayscale details and detached shadows do not block.
    if (metrics.changed_pixel_count < 2 || metrics.changed_ratio < 0.35) return
    unionInto(rejected, component.pixels)
    detections.push({
      kind,
      severity: 'block',
      pixel_count: component.pixels.length,
      bbox: { ...component.bbox },
      metrics,
    })
  }

  if (envelope) {
    const overflow = new Uint8Array(pixelCount)
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (candidateAlpha[pixel] && !envelope[pixel]) overflow[pixel] = 1
    }
    const minSpan = Math.max(4, Math.round(Math.min(candidate.width, candidate.height) * 0.16))
    for (const component of connectedComponents(overflow, candidate.width, candidate.height)) {
      const metrics = componentMetrics(component, {
        candidate,
        before: comparisonReference,
        envelope,
        bodyBounds,
      })
      const longThin = metrics.span >= minSpan &&
        (metrics.aspect_ratio >= 2.2 || metrics.fill_ratio <= 0.5)
      if (metrics.area >= 2 && longThin) addDetection('silhouette_protrusion', component, metrics)
    }
  }

  const metallicMask = new Uint8Array(pixelCount)
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!candidateAlpha[pixel]) continue
    const offset = pixel * 4
    const r = candidate.data[offset]
    const g = candidate.data[offset + 1]
    const b = candidate.data[offset + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const luma = (r * 299 + g * 587 + b * 114) / 1000
    if (max - min <= 42 && luma >= 68 && luma <= 252) metallicMask[pixel] = 1
  }
  const metalMinSpan = Math.max(5, Math.round(Math.min(candidate.width, candidate.height) * 0.2))
  for (const component of connectedComponents(metallicMask, candidate.width, candidate.height)) {
    const metrics = componentMetrics(component, {
      candidate,
      before: comparisonReference,
      envelope,
      bodyBounds,
    })
    const bladeShape = metrics.area >= 3 && metrics.span >= metalMinSpan &&
      (metrics.aspect_ratio >= 2 || metrics.fill_ratio <= 0.52) &&
      metrics.hand_zone_ratio >= 0.35
    if (bladeShape) addDetection('metallic_blade_shape', component, metrics)
  }

  const alphaComponents = connectedComponents(candidateAlpha, candidate.width, candidate.height)
  for (const component of alphaComponents.slice(1)) {
    const metrics = componentMetrics(component, {
      candidate,
      before: comparisonReference,
      envelope,
      bodyBounds,
    })
    const detachedLine = metrics.area >= 2 && metrics.span >= 3 &&
      (metrics.aspect_ratio >= 2 || metrics.fill_ratio <= 0.55 || metrics.metallic_ratio >= 0.5)
    if (detachedLine) addDetection('detached_component', component, metrics)
  }

  const rejectedMask = equipmentMaskEvidence(rejected, candidate.width, candidate.height)
  let changedPixelCount = 0
  let changedBeforeVisiblePixelCount = 0
  let beforeVisiblePixelCount = 0
  if (before) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const beforeVisible = before.data[pixel * 4 + 3] > 0
      const changed = rgbaChanged(before, candidate, pixel)
      if (beforeVisible) beforeVisiblePixelCount += 1
      if (changed) changedPixelCount += 1
      if (beforeVisible && changed) changedBeforeVisiblePixelCount += 1
    }
  }
  const minimumChangedPixelCount = requireRemovalEvidence
    ? Math.max(2, Math.min(16, Math.ceil(beforeVisiblePixelCount * 0.03)))
    : 0
  const removalObserved = !requireRemovalEvidence || (
    before !== null && changedBeforeVisiblePixelCount >= minimumChangedPixelCount
  )
  const policyBlockingErrors = []
  if (requireRemovalEvidence && before === null) {
    policyBlockingErrors.push('equipment_gate:removal_reference_missing')
  } else if (!removalObserved) {
    policyBlockingErrors.push('equipment_gate:removal_not_observed')
  }
  const blockingErrors = [...new Set([
    ...detections.map((item) => `equipment_gate:${item.kind}`),
    ...policyBlockingErrors,
  ])]
  return {
    mode: 'equipment_quality_gate_v1',
    policy,
    provider_free: true,
    status: blockingErrors.length > 0 ? 'blocked' : 'pass',
    blocking_errors: blockingErrors,
    warnings: referenceAlpha ? [] : ['equipment_gate:no_reference_silhouette'],
    rejected_pixel_count: rejectedMask.active_pixel_count,
    rejected_mask: rejectedMask,
    detection_count: detections.length,
    detections,
    removal_evidence_required: requireRemovalEvidence,
    policy_checks: {
      before_visible_pixel_count: beforeVisiblePixelCount,
      changed_pixel_count: changedPixelCount,
      changed_before_visible_pixel_count: changedBeforeVisiblePixelCount,
      minimum_changed_pixel_count: minimumChangedPixelCount,
      removal_observed: removalObserved,
    },
    reference: {
      before_available: before !== null,
      template_available: template !== null,
      comparison_source: comparisonReference === template && template !== null
        ? 'template'
        : comparisonReference === before && before !== null ? 'before' : 'none',
      template_envelope_preferred: preferTemplateEnvelope,
      envelope_radius: envelopeRadius,
    },
    body_contract: bodyContract,
  }
}

export function buildEquipmentGateOverlay(candidate, gate) {
  assertRgba(candidate, 'candidate')
  const rejected = equipmentMaskBits(gate?.rejected_mask)
  if (gate.rejected_mask.width !== candidate.width || gate.rejected_mask.height !== candidate.height) {
    throw new TypeError('equipment gate dimensions do not match the candidate image')
  }
  const overlay = cloneRgba(candidate)
  for (let pixel = 0; pixel < rejected.length; pixel += 1) {
    const offset = pixel * 4
    if (rejected[pixel]) {
      overlay.data[offset] = 255
      overlay.data[offset + 1] = 0
      overlay.data[offset + 2] = 192
      overlay.data[offset + 3] = 255
    } else {
      overlay.data[offset + 3] = Math.min(overlay.data[offset + 3], 72)
    }
  }
  return overlay
}

export function splitEquipmentLayers(candidate, gate) {
  assertRgba(candidate, 'candidate')
  const rejected = equipmentMaskBits(gate?.rejected_mask)
  if (gate.rejected_mask.width !== candidate.width || gate.rejected_mask.height !== candidate.height) {
    throw new TypeError('equipment gate dimensions do not match the candidate image')
  }
  const body = cloneRgba(candidate)
  const equipment = {
    width: candidate.width,
    height: candidate.height,
    data: new Uint8ClampedArray(candidate.data.length),
  }
  for (let pixel = 0; pixel < rejected.length; pixel += 1) {
    if (!rejected[pixel]) continue
    const offset = pixel * 4
    equipment.data.set(candidate.data.subarray(offset, offset + 4), offset)
    body.data.fill(0, offset, offset + 4)
  }
  return { body, equipment, removed_pixel_count: gate.rejected_mask.active_pixel_count }
}
