// Original bounded grid fitting and global cell sampling, promoted from the visual benchmark.
// No fixture metadata, cached estimates, palette reduction or local edge snapping.
const FIXED_POINT = 65536
const COARSE_LOOKUP_CAP = 6 * 2 ** 20
const REFINE_LOOKUP_CAP = 2 * 2 ** 20
const round6 = value => Math.round(value * 1e6) / 1e6

function pixel(image, x, y) {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset],
    image.data[offset + 1],
    image.data[offset + 2],
    image.data[offset + 3],
  ]
}

export function interiorEdgeProfiles(image, { noiseFloor = 16, alphaThreshold = 8, includeSilhouette = false } = {}) {
  const x = new Float64Array(image.width)
  const y = new Float64Array(image.height)
  for (let row = 0; row < image.height; row += 1) {
    for (let column = 1; column < image.width; column += 1) {
      const left = pixel(image, column - 1, row)
      const right = pixel(image, column, row)
      const silhouette = (left[3] < alphaThreshold) !== (right[3] < alphaThreshold)
      if ((left[3] < alphaThreshold || right[3] < alphaThreshold) && !(includeSilhouette && silhouette)) continue
      const delta = silhouette ? Math.abs(left[3] - right[3]) : Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]) + Math.abs(left[3] - right[3])
      if (delta >= noiseFloor) x[column] += delta
    }
  }
  for (let column = 0; column < image.width; column += 1) {
    for (let row = 1; row < image.height; row += 1) {
      const above = pixel(image, column, row - 1)
      const below = pixel(image, column, row)
      const silhouette = (above[3] < alphaThreshold) !== (below[3] < alphaThreshold)
      if ((above[3] < alphaThreshold || below[3] < alphaThreshold) && !(includeSilhouette && silhouette)) continue
      const delta = silhouette ? Math.abs(above[3] - below[3]) : Math.abs(above[0] - below[0]) + Math.abs(above[1] - below[1]) + Math.abs(above[2] - below[2]) + Math.abs(above[3] - below[3])
      if (delta >= noiseFloor) y[row] += delta
    }
  }
  return { x, y }
}


function exactLift(profile, periodQ, phaseQ, total, budget) {
  let on = 0
  if (!(total > 0) || !(periodQ > 0)) return { lift: null }
  phaseQ = ((phaseQ % periodQ) + periodQ) % periodQ
  const limit = profile.length * FIXED_POINT
  for (let k = 0; phaseQ + k * periodQ < limit; k += 1) {
    const boundary = Math.floor((phaseQ + k * periodQ) / FIXED_POINT)
    if (boundary <= 0 || boundary >= profile.length) continue
    if (budget.used >= budget.cap) {
      budget.truncated = true
      return { lift: null }
    }
    budget.used += 1
    on += profile[boundary]
  }
  const period = periodQ / FIXED_POINT
  const chance = 1 / period
  const lift = chance < 1 ? (on / total - chance) / (1 - chance) : null
  return { lift }
}

function scanPeriod(profile, periodQ, phaseStepQ, total, budget) {
  let best = -Infinity
  const candidates = []
  for (let phaseQ = 0; phaseQ < periodQ; phaseQ += phaseStepQ) {
    const measured = exactLift(profile, periodQ, phaseQ, total, budget)
    if (budget.truncated) break
    if (measured.lift == null) continue
    best = Math.max(best, measured.lift)
    candidates.push({ phaseQ, lift: measured.lift })
  }
  return { best, candidates }
}

// Disconnected phase intervals are not bridged through a low-fit gap.
export function phaseIntervalCentre(phases, periodQ, stepQ) {
  const sorted = [...new Set(phases)].sort((a, b) => a - b)
  if (!sorted.length) return 0
  const intervals = []
  for (const phase of sorted) {
    const last = intervals.at(-1)
    if (last && phase - last[1] <= stepQ) last[1] = phase
    else intervals.push([phase, phase])
  }
  if (intervals.length > 1 && sorted[0] + periodQ - sorted.at(-1) <= stepQ) {
    const last = intervals.pop()
    intervals[0] = [last[0], intervals[0][1] + periodQ]
  }
  return Math.min(...intervals.map(([lo, hi]) => Math.floor((lo + hi) / 2) % periodQ))
}

export function coarseScanPlan(length, { minCell = 2, maxCell = 32, cap = COARSE_LOOKUP_CAP } = {}) {
  const lower = Math.max(2, minCell)
  let periodStep = 1 / 16
  const planned = (step) => {
    let total = 0
    let extra = 0
    for (let p = lower; p <= maxCell; p += step) {
      const bound = Math.ceil(8 * p) * Math.ceil(Math.max(0, length - 1) / p)
      total += bound
      extra = Math.max(extra, bound)
    }
    return total + extra + Math.ceil(Math.max(0, length - 1) / lower)
  }
  while (planned(periodStep) > cap && Math.floor((maxCell - lower) / periodStep) + 1 > 1) periodStep *= 2
  return { periodStep, estimate: planned(periodStep), fits: planned(periodStep) <= cap, lower, maxCell }
}


// Fit all observed raster boundaries, not just one local peak of their energy.
// Coordinates are (period, position of the first observed boundary). Each
// observed edge contributes a strip b <= anchor + k*period < b+1. Endpoint
// integer counts enumerate aliases; clipping rejects inconsistent ones.
function supportLattice(profile, lower, upper, budget) {
  const positions = []
  for (let i = 1; i < profile.length; i += 1) if (profile[i] > 0) positions.push(i)
  if (positions.length < 4) return { candidate: null, positions: positions.length, checks: 0, reason: 'few_positions' }
  const first = positions[0], span = positions.at(-1) - first
  let checks = 0
  const clip = (polygon, a, b, c) => {
    const out = []
    for (let i = 0; i < polygon.length; i += 1) {
      if (++checks > budget) return null
      const v = polygon[i], w = polygon[(i + 1) % polygon.length]
      const fv = a * v[0] + b * v[1] - c, fw = a * w[0] + b * w[1] - c
      if (fv <= 0) out.push(v)
      if ((fv <= 0) !== (fw <= 0)) {
        const t = fv / (fv - fw)
        out.push([v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])])
      }
    }
    return out
  }
  const gcd = (a, b) => b ? gcd(b, a % b) : a
  const spacing = positions.slice(1).reduce((d, b) => gcd(d, b - first), 0)
  let integer = 0
  for (let p = Math.ceil(lower); p <= Math.min(upper, spacing); p += 1) if (spacing % p === 0) integer = p
  function * intervalCounts() {
    const preferred = integer ? span / integer : null
    if (preferred != null) yield preferred
    for (let n = Math.max(1, Math.ceil((span - 1) / upper)); n <= Math.floor((span + 1) / lower); n += 1) if (n !== preferred) yield n
  }
  for (const n of intervalCounts()) {
    const lo = Math.max(lower, (span - 1) / n), hi = Math.min(upper, (span + 1) / n)
    if (!(hi > lo)) continue
    const seed = span / n
    let polygon = [[lo, first], [hi, first], [hi, first + 1 - 1 / FIXED_POINT], [lo, first + 1 - 1 / FIXED_POINT]]
    for (const b of positions.slice(1)) {
      const k = Math.round((b - first) / seed)
      polygon = clip(polygon, -k, -1, -b)
      if (polygon == null) return { candidate: null, positions: positions.length, checks: budget, truncated: true }
      if (!polygon.length) break
      polygon = clip(polygon, k, 1, b + 1 - 1 / FIXED_POINT)
      if (polygon == null) return { candidate: null, positions: positions.length, checks: budget, truncated: true }
      if (!polygon.length) break
    }
    if (!polygon.length) continue
    const pLo = Math.min(...polygon.map(v => v[0])), pHi = Math.max(...polygon.map(v => v[0]))
    let period = polygon.reduce((s, v) => s + v[0], 0) / polygon.length
    const integer = Math.round(period)
    if (integer >= pLo && integer <= pHi) period = integer
    const periodQ = Math.round(period * FIXED_POINT)
    period = periodQ / FIXED_POINT
    let anchorLo = first, anchorHi = first + 1
    for (const b of positions) {
      const k = Math.round((b - first) / seed)
      anchorLo = Math.max(anchorLo, b - k * period)
      anchorHi = Math.min(anchorHi, b + 1 - k * period)
    }
    if (!(anchorHi > anchorLo)) continue
    const anchorQ = Math.floor((anchorLo + anchorHi) * FIXED_POINT / 2)
    const phaseQ = ((anchorQ % periodQ) + periodQ) % periodQ
    let uncertainCount = 0
    const uncertain = []
    for (let k = -Math.ceil((first + 1) / pLo); k <= Math.ceil((profile.length - first) / pLo); k += 1) {
      const values = []
      for (const v of polygon) {
        if (++checks > budget) return { candidate: null, positions: positions.length, checks: budget, truncated: true }
        values.push(Math.floor(v[1] + k * v[0] + 1e-9))
      }
      const min = Math.min(...values), max = Math.max(...values)
      if (min !== max && max > 0 && min < profile.length) {
        uncertainCount += 1
        if (uncertain.length < 12) uncertain.push({ min, max })
      }
    }
    return { candidate: { period, phase: phaseQ / FIXED_POINT, period_interval: [pLo, pHi], integer_preference: Number.isInteger(period),
      boundary_status: uncertainCount ? 'ambiguous' : 'stable_within_feasible_model',
      boundary_uncertainty_extent: profile.length,
      uncertain_boundary_count: uncertainCount, uncertain_boundary_examples: uncertain }, positions: positions.length, checks }
  }
  return { candidate: null, positions: positions.length, checks, reason: 'inconsistent_support' }
}

export function fractionalSearchPair(profiles, options = {}) {
  const found = Object.fromEntries(['x', 'y'].map(axis => [axis, fractionalSearch(profiles[axis], options)]))
  if (Object.values(found).some(f => f.truncated) || !Object.values(found).some(f => f.method === 'support_constraints')) return found
  const combined = new Float64Array(Math.max(profiles.x.length, profiles.y.length))
  for (const axis of ['x', 'y']) for (let i = 0; i < profiles[axis].length; i += 1) combined[i] += profiles[axis][i]
  const remaining = Math.min(...['x', 'y'].map(axis => (options.supportCap ?? REFINE_LOOKUP_CAP) - (found[axis].support_constraint_checks ?? 0)))
  const joint = supportLattice(combined, Math.max(2, options.minCell ?? 2), options.maxCell ?? 32, remaining)
  for (const axis of ['x', 'y']) Object.assign(found[axis], { shared_constraint_checks: joint.checks, shared_constraint_truncated: joint.truncated ?? false, shared_profile_visits: combined.length })
  if (joint.candidate && ['x', 'y'].every(axis => {
    const f = found[axis], p = joint.candidate.period
    return !f.truncated && (f.support_positions < 4 || (f.period_interval && p >= f.period_interval[0] && p <= f.period_interval[1]))
  })) {
    if (['x', 'y'].some(axis => Math.ceil(profiles[axis].length / joint.candidate.period) + found[axis].refinement_lookups > (options.refineCap ?? REFINE_LOOKUP_CAP))) {
      for (const axis of ['x', 'y']) found[axis].shared_score_skipped = 'refinement_cap'
      return found
    }
    const scores = {}
    for (const axis of ['x', 'y']) {
      const target = found[axis], budget = { used: target.refinement_lookups, cap: options.refineCap ?? REFINE_LOOKUP_CAP, truncated: false }
      const score = exactLift(profiles[axis], Math.round(joint.candidate.period * FIXED_POINT), Math.round(joint.candidate.phase * FIXED_POINT), profiles[axis].reduce((s, v) => s + v, 0), budget)
      Object.assign(target, { refinement_lookups: budget.used, lookups: target.coarse_lookups + budget.used })
      scores[axis] = { ...score, truncated: budget.truncated }
    }
    if (Object.values(scores).some(score => score.truncated || score.lift == null || score.lift < 1 - 1e-12)) return found
    for (const axis of ['x', 'y']) {
      found[axis] = { ...found[axis], ...joint.candidate, lift: scores[axis].lift, method: 'shared_lattice_supported', independent_period: false,
        shared_origin: true,
        shared_axis: axis === 'x' ? 'y' : 'x', shared_constraint_checks: joint.checks,
        lattice: Number.isInteger(joint.candidate.period) ? 'integer' : 'fractional' }
    }
    return found
  }
  return found
}

export function fractionalSearch(profile, {
  minCell = 2,
  maxCell = 32,
  length = profile.length,
  coarseCap = COARSE_LOOKUP_CAP,
  refineCap = REFINE_LOOKUP_CAP,
  supportCap = REFINE_LOOKUP_CAP,
} = {}) {
  const lower = Math.max(2, minCell)
  const total = profile.reduce((sum, value) => sum + value, 0)
  const coarse = { used: 0, cap: coarseCap, truncated: false }
  const refinement = { used: 0, cap: refineCap, truncated: false }
  let supportCounts = { support_constraint_checks: 0, support_constraint_cap: supportCap }
  const counts = () => ({ lookups: coarse.used + refinement.used, coarse_lookups: coarse.used, refinement_lookups: refinement.used, energy_visits: profile.length, ...supportCounts })
  const plan = coarseScanPlan(length, { minCell, maxCell, cap: coarseCap })
  const periodStep = plan.periodStep
  if (!plan.fits) {
    return { period: null, phase: null, lattice: null, ...counts(), truncated: true, reason: 'coarse_cap' }
  }
  const support = supportLattice(profile, lower, maxCell, supportCap)
  supportCounts = { support_positions: support.positions, support_constraint_checks: support.checks, support_constraint_cap: supportCap }
  if (support.truncated) return { period: null, phase: null, lattice: null, ...counts(), ...supportCounts, truncated: true, reason: 'support_cap' }
  if (support.candidate) {
    const { period, phase } = support.candidate
    const scored = exactLift(profile, Math.round(period * FIXED_POINT), Math.round(phase * FIXED_POINT), total, refinement)
    if (refinement.truncated) return { period: null, phase: null, lattice: null, ...counts(), ...supportCounts, truncated: true, reason: 'refinement_cap' }
    if (scored.lift >= 1 - 1e-12) return { ...support.candidate, lift: scored.lift,
      lattice: Number.isInteger(period) ? 'integer' : 'fractional', method: 'support_constraints', independent_period: true,
      ...counts(), ...supportCounts, coarse_step: periodStep, truncated: false }
  }
  const phaseStepQ = FIXED_POINT / 8
  const samples = []
  for (let period = lower; period <= maxCell + 1e-9; period = round6(period + periodStep)) {
    const measured = scanPeriod(profile, Math.round(period * FIXED_POINT), phaseStepQ, total, coarse)
    if (coarse.truncated) return { period: null, phase: null, lattice: null, ...counts(), truncated: true, reason: 'coarse_cap' }
    if (measured.best > -Infinity) samples.push({ period, lift: measured.best, candidates: measured.candidates })
  }
  if (!samples.length) return { period: null, phase: null, lattice: null, ...counts(), truncated: false }
  const bestLift = Math.max(...samples.map((item) => item.lift))
  const tie = samples.filter((item) => item.lift >= bestLift - 0.02)
  const clusters = []
  for (const item of tie) {
    const previous = clusters[clusters.length - 1]
    if (!previous || item.period - previous.max > periodStep * 1.5) clusters.push({ min: item.period, max: item.period, items: [item] })
    else {
      previous.max = item.period
      previous.items.push(item)
    }
  }
  clusters.sort((a, b) => ((b.min + b.max) - (a.min + a.max)) || (a.min - b.min))
  const cluster = clusters[0]
  const integers = cluster.items.filter((item) => Math.abs(item.period - Math.round(item.period)) < 1e-9)
  if (integers.length) {
    const clusterCentre = (cluster.min + cluster.max) / 2
    const chosen = integers.sort((a, b) => Math.abs(a.period - clusterCentre) - Math.abs(b.period - clusterCentre) || a.period - b.period)[0]
    const centre = phaseIntervalCentre(chosen.candidates.filter((item) => item.lift >= bestLift - 0.02).map((item) => item.phaseQ), Math.round(chosen.period * FIXED_POINT), phaseStepQ) / FIXED_POINT
    const cell = Math.round(chosen.period)
    const snapped = exactLift(profile, cell * FIXED_POINT, (Math.floor(centre) % cell) * FIXED_POINT, total, coarse)
    if (coarse.truncated) return { period: null, phase: null, lattice: null, ...counts(), truncated: true, reason: 'coarse_cap' }
    return {
      period: cell,
      phase: Math.floor(centre) % cell,
      lattice: 'integer',
      lift: snapped.lift,
      ...counts(),
      ...supportCounts,
      coarse_step: periodStep,
      truncated: false,
    }
  }
  const centrePeriod = (cluster.min + cluster.max) / 2
  const centreScan = scanPeriod(profile, Math.round(centrePeriod * FIXED_POINT), phaseStepQ, total, coarse)
  if (coarse.truncated) return { period: null, phase: null, lattice: null, ...counts(), truncated: true, reason: 'coarse_cap' }
  const centreCandidates = centreScan.candidates.filter((item) => item.lift >= bestLift - 0.02)
  if (!centreCandidates.length) return { period: null, phase: null, lattice: null, ...counts(), truncated: false, reason: 'no_eligible_centre_candidate', coarse_best_lift: bestLift, selected_cluster: { min: cluster.min, max: cluster.max }, centre_period: centrePeriod }
  const centrePhase = phaseIntervalCentre(centreCandidates.map((item) => item.phaseQ), Math.round(centrePeriod * FIXED_POINT), phaseStepQ) / FIXED_POINT
  const refined = refineFractional(profile, centrePeriod, centrePhase, total, refinement, lower, maxCell)
  return {
    period: refined.period,
    phase: refined.phase,
    lattice: 'fractional',
    lift: refined.lift,
    ...counts(),
    ...supportCounts,
    method: 'local_energy_search',
    coarse_step: periodStep,
    truncated: refined.truncated,
  }
}

function refineFractional(profile, period, phase, total, budget, lower, upper) {
  const levels = [
    { step: 1 / 256, radius: 1 / 16 },
    { step: 1 / 1024, radius: 4 / 1024 },
    { step: 1 / 4096, radius: 4 / 4096 },
    { step: 1 / 16384, radius: 4 / 16384 },
    { step: 1 / 65536, radius: 4 / 65536 },
  ]
  let currentP = period
  // Origin-phase refinement preserves the accepted global sampling result.
  // Exact raster support above handles long-span drift before this noisy fallback.
  let currentPhase = phase
  let truncated = false
  let lift = null
  for (const level of levels) {
    const tied = []
    let best = -Infinity
    let stopped = false
    for (let p = currentP - level.radius; p <= currentP + level.radius + 1e-12 && !stopped; p += level.step) {
      if (p < lower || p > upper) continue
      for (let value = currentPhase - level.radius; value <= currentPhase + level.radius + 1e-12; value += level.step) {
        const phaseQ = ((Math.round(value * FIXED_POINT) % Math.round(p * FIXED_POINT)) + Math.round(p * FIXED_POINT)) % Math.round(p * FIXED_POINT)
        const measured = exactLift(profile, Math.round(p * FIXED_POINT), phaseQ, total, budget)
        if (budget.truncated) {
          truncated = true
          stopped = true
          break
        }
        if (measured.lift == null) continue
        if (measured.lift > best + 1e-12) {
          best = measured.lift
          tied.length = 0
          tied.push({ p, phase: value })
        } else if (measured.lift >= best - 1e-12) tied.push({ p, phase: value })
      }
    }
    if (truncated || !tied.length) break
    const centreP = Math.floor((Math.min(...tied.map((item) => item.p)) + Math.max(...tied.map((item) => item.p))) * FIXED_POINT / 2) / FIXED_POINT
    const centrePhase = Math.floor((Math.min(...tied.map((item) => item.phase)) + Math.max(...tied.map((item) => item.phase))) * FIXED_POINT / 2) / FIXED_POINT
    const centre = exactLift(profile, Math.round(centreP * FIXED_POINT), Math.round(centrePhase * FIXED_POINT), total, budget)
    if (budget.truncated) { truncated = true; break }
    // A centre outside a disconnected maximum set must not replace its maximum.
    const normalized = (item) => ((item.phase % item.p) + item.p) % item.p
    tied.sort((a, b) => Math.abs(a.p - centreP) + Math.abs(a.phase - centrePhase) - (Math.abs(b.p - centreP) + Math.abs(b.phase - centrePhase)) || normalized(a) - normalized(b) || a.p - b.p)
    currentP = centre.lift >= best - 1e-12 ? centreP : tied[0].p
    const selectedPhase = centre.lift >= best - 1e-12 ? centrePhase : tied[0].phase
    currentPhase = ((selectedPhase % currentP) + currentP) % currentP
    lift = centre.lift >= best - 1e-12 ? centre.lift : best
  }
  const normalizedPhase = ((currentPhase % currentP) + currentP) % currentP
  return { period: currentP, phase: normalizedPhase, lift, truncated }
}


export function latticeBoundaries(period, phase, length) {
  const values = []
  if (!(period > 0)) return values
  const periodQ = Math.round(period * FIXED_POINT)
  const phaseQ = ((Math.round(phase * FIXED_POINT) % periodQ) + periodQ) % periodQ
  for (let k = 0; phaseQ + k * periodQ < length * FIXED_POINT; k += 1) {
    const boundary = Math.floor((phaseQ + k * periodQ) / FIXED_POINT)
    if (boundary > 0 && boundary < length) values.push(boundary)
  }
  return values
}


function median(values) {
  values.sort((a, b) => a - b)
  return values[Math.floor((values.length - 1) / 2)]
}

// Alpha-aware channel median: hidden RGB never contributes to a visible cell.
// A median may create a new RGB triplet; no palette or ground truth is consulted.
export function sampleCells(image, grid) {
  const width = grid.x.length - 1, height = grid.y.length - 1
  const output = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let row = 0; row < height; row += 1) for (let col = 0; col < width; col += 1) {
    const channels = [[], [], [], []]
    for (let y = grid.y[row]; y < grid.y[row + 1]; y += 1) for (let x = grid.x[col]; x < grid.x[col + 1]; x += 1) {
      const offset = (y * image.width + x) * 4
      const alpha = image.data[offset + 3]
      channels[3].push(alpha < 8 ? 0 : alpha)
      if (alpha >= 8) for (let c = 0; c < 3; c += 1) channels[c].push(image.data[offset + c])
    }
    const alpha = median(channels[3])
    const offset = (row * width + col) * 4
    if (alpha) {
      for (let c = 0; c < 3; c += 1) output.data[offset + c] = median(channels[c])
      output.data[offset + 3] = alpha
    }
  }
  return output
}


export const SOURCE_PIXEL_RECOVERY_MODE = 'global_median_v1'
export const SOURCE_PIXEL_MAX_PIXELS = 4 * 1024 * 1024

// A visual regularizer, not a certificate that every hidden source boundary is unique.
export function recoverPixelGrid(image) {
  if (!Number.isSafeInteger(image?.width) || !Number.isSafeInteger(image?.height)
    || image.width < 1 || image.height < 1 || image.width > 4096 || image.height > 4096
    || image.width * image.height > SOURCE_PIXEL_MAX_PIXELS
    || !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)
    || image.data.length !== image.width * image.height * 4) throw new Error('Invalid or oversized pixel recovery image')
  const report = {
    method: SOURCE_PIXEL_RECOVERY_MODE, status: 'passthrough', exact_recovery: false,
    input: { width: image.width, height: image.height },
    sampling: 'alpha_aware_channel_lower_median', alpha_threshold: 8, noise_floor: 16,
    local_snapping: false, palette_reduction: false,
  }
  const passthrough = reason => ({ image, report: { ...report, reason, output: report.input } })
  const profiles = interiorEdgeProfiles(image, { noiseFloor: 16, alphaThreshold: 8, includeSilhouette: true })
  if (['x', 'y'].some(axis => profiles[axis].filter(value => value > 0).length < 4)) return passthrough('insufficient_edges')
  const grid = fractionalSearchPair(profiles, { minCell: 2, maxCell: 32 })
  report.axes = grid
  if (['x', 'y'].some(axis => grid[axis].truncated || grid[axis].shared_constraint_truncated)) return passthrough('search_budget')
  if (['x', 'y'].some(axis => !Number.isFinite(grid[axis].period) || !Number.isFinite(grid[axis].phase)
    || !Number.isFinite(grid[axis].lift) || grid[axis].lift < 0.3)) return passthrough('insufficient_grid_support')
  const bounds = Object.fromEntries(['x', 'y'].map(axis => [axis,
    [0, ...latticeBoundaries(grid[axis].period, grid[axis].phase, profiles[axis].length), profiles[axis].length]]))
  const output = sampleCells(image, bounds)
  return { image: output, report: { ...report, status: 'resampled', reason: null,
    output: { width: output.width, height: output.height },
    boundary_status: 'candidate_not_unique_recovery',
  } }
}
