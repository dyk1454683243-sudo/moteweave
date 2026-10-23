// Product adapter for the existing bounded local experiments. Thresholds and
// lattice calculations are unchanged; only strict_gate can publish a preview.
import { createHash } from 'node:crypto'
import { recoverPixelGrid, interiorEdgeProfiles, phaseIntervalCentre, latticeBoundaries, sampleCells } from '../character-pack/pixelGridSampling.js'
import { detectAutomaticBackground, applyBackgroundSelection } from '../character-pack/generalAssetFrames.js'

const FROZEN_SPEC = {
  min_lift: 0.3,
  max_lift_drop: 0.15,
  primary_rel_tol: 0.02,
  v4_drift_tol_px: 0.5,
  harmonic_rel_tol: 0.05,
  min_primary_fraction_strict: 0.80,
  fixed_point: 65536,
  coarse_lookup_cap: 6 * 2 ** 20,
  refine_lookup_cap: 2 * 2 ** 20,
}

const FIXED_POINT = FROZEN_SPEC.fixed_point
const COARSE_LOOKUP_CAP = FROZEN_SPEC.coarse_lookup_cap
const REFINE_LOOKUP_CAP = FROZEN_SPEC.refine_lookup_cap

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function hashImage(image) {
  if (!image) return null
  return sha256(Buffer.concat([
    Buffer.from(`${image.width}x${image.height}:`),
    Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
  ]))
}

// ==================== PHASE SOLVER AT FIXED PERIOD (FOR NEW SYNTHETIC CASES ONLY) ====================
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

function refinePhaseOnly(profile, period, initialPhase, total, budget) {
  const levels = [
    { step: 1 / 256, radius: 1 / 16 },
    { step: 1 / 1024, radius: 4 / 1024 },
    { step: 1 / 4096, radius: 4 / 4096 },
    { step: 1 / 16384, radius: 4 / 16384 },
    { step: 1 / 65536, radius: 4 / 65536 },
  ]
  const periodQ = Math.round(period * FIXED_POINT)
  let currentPhase = initialPhase
  let truncated = false
  let lift = null
  for (const level of levels) {
    const tied = []
    let best = -Infinity
    for (let value = currentPhase - level.radius; value <= currentPhase + level.radius + 1e-12; value += level.step) {
      const phaseQ = ((Math.round(value * FIXED_POINT) % periodQ) + periodQ) % periodQ
      const measured = exactLift(profile, periodQ, phaseQ, total, budget)
      if (budget.truncated) {
        truncated = true
        break
      }
      if (measured.lift == null) continue
      if (measured.lift > best + 1e-12) {
        best = measured.lift
        tied.length = 0
        tied.push({ phase: value })
      } else if (measured.lift >= best - 1e-12) {
        tied.push({ phase: value })
      }
    }
    if (truncated || !tied.length) break
    const centrePhase = Math.floor((Math.min(...tied.map(i => i.phase)) + Math.max(...tied.map(i => i.phase))) * FIXED_POINT / 2) / FIXED_POINT
    const centre = exactLift(profile, periodQ, ((Math.round(centrePhase * FIXED_POINT) % periodQ) + periodQ) % periodQ, total, budget)
    if (budget.truncated) {
      truncated = true
      break
    }
    const normalized = item => ((item.phase % period) + period) % period
    tied.sort((a, b) => Math.abs(a.phase - centrePhase) - Math.abs(b.phase - centrePhase) || normalized(a) - normalized(b))
    const selectedPhase = centre.lift >= best - 1e-12 ? centrePhase : tied[0].phase
    currentPhase = ((selectedPhase % period) + period) % period
    lift = centre.lift >= best - 1e-12 ? centre.lift : best
  }
  const normalizedPhase = ((currentPhase % period) + period) % period
  return { period, phase: normalizedPhase, lift, truncated }
}

function solvePhaseAtFixedPeriod(profile, period) {
  const total = profile.reduce((s, v) => s + v, 0)
  const coarse = { used: 0, cap: COARSE_LOOKUP_CAP, truncated: false }
  const refinement = { used: 0, cap: REFINE_LOOKUP_CAP, truncated: false }
  const periodQ = Math.round(period * FIXED_POINT)
  const phaseStepQ = FIXED_POINT / 8
  const scan = scanPeriod(profile, periodQ, phaseStepQ, total, coarse)
  if (coarse.truncated || !scan.candidates.length) {
    return { period, phase: 0, lift: null, truncated: coarse.truncated, reason: 'no_phase_candidates' }
  }
  const tie = scan.candidates.filter(item => item.lift >= scan.best - 0.02)
  const centrePhase = phaseIntervalCentre(tie.map(item => item.phaseQ), periodQ, phaseStepQ) / FIXED_POINT

  if (Math.abs(period - Math.round(period)) < 1e-9) {
    const cell = Math.round(period)
    const intPhase = Math.floor(centrePhase) % cell
    const snapped = exactLift(profile, cell * FIXED_POINT, intPhase * FIXED_POINT, total, coarse)
    const fine = refinePhaseOnly(profile, period, centrePhase, total, refinement)
    return {
      period: cell,
      phase: intPhase,
      lift: snapped.lift,
      fine_phase: fine.phase,
      fine_lift: fine.lift,
      centre_phase: centrePhase,
      coarse_best_lift: scan.best,
      lattice: 'integer',
      truncated: coarse.truncated || fine.truncated,
    }
  }

  const fine = refinePhaseOnly(profile, period, centrePhase, total, refinement)
  return {
    period,
    phase: fine.phase,
    lift: fine.lift,
    centre_phase: centrePhase,
    coarse_best_lift: scan.best,
    lattice: 'fractional',
    truncated: fine.truncated,
  }
}

function medianLower(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

function evaluateSharedScaleCandidateA(framesMeta, methodARows, methodBRows, sharedPeriod) {
  const totalCount = framesMeta.length
  const cPassedIndices = []
  for (let i = 0; i < totalCount; i += 1) {
    const a = methodARows[i]
    const xOk = a.axes?.x && !a.axes.x.truncated && Number.isFinite(a.axes.x.period) && Number.isFinite(a.axes.x.phase) && Number.isFinite(a.axes.x.lift) && a.axes.x.lift >= FROZEN_SPEC.min_lift
    const yOk = a.axes?.y && !a.axes.y.truncated && Number.isFinite(a.axes.y.period) && Number.isFinite(a.axes.y.phase) && Number.isFinite(a.axes.y.lift) && a.axes.y.lift >= FROZEN_SPEC.min_lift
    if (a.status === 'resampled' && xOk && yOk) {
      cPassedIndices.push(i)
    }
  }

  if (cPassedIndices.length === 0 || !sharedPeriod) {
    return {
      c_passed_count: 0,
      total_count: totalCount,
      shared_period: null,
      strict_gate: {
        verdict: 'undetermined',
        reason: 'no_c_passed_frames',
        triggered_conditions: ['c_passed_count === 0'],
      },
      per_frame_diagnostics: methodARows.map((a, i) => ({
        index: i,
        frame_id: a.frame_id,
        c_passed: false,
        c_status: a.status,
        c_reason: a.reason,
        axes: { x: null, y: null },
      })),
    }
  }

  const perFrame = []
  for (let i = 0; i < totalCount; i += 1) {
    const a = methodARows[i]
    const b = methodBRows[i]
    const cPassed = cPassedIndices.includes(i)
    const axesDiag = {}
    for (const axis of ['x', 'y']) {
      const L = axis === 'x' ? framesMeta[i].width : framesMeta[i].height
      const pShared = sharedPeriod[axis]
      const aAxis = a.axes?.[axis] || null
      const bAxis = b.solved_axes?.[axis] || null
      const cAxisOk = cPassed && aAxis != null
      const fixedSearchOk = Boolean(bAxis && !bAxis.truncated && Number.isFinite(bAxis.lift))
      const fixedLiftOk = fixedSearchOk && bAxis.lift >= FROZEN_SPEC.min_lift
      const liftDrop = (cAxisOk && fixedSearchOk) ? Number((aAxis.lift - bAxis.lift).toFixed(6)) : null
      const liftDropOk = liftDrop !== null && liftDrop <= FROZEN_SPEC.max_lift_drop
      const relPeriodDiff = cAxisOk ? Number((Math.abs(aAxis.period - pShared) / pShared).toFixed(6)) : null
      const cellCountEst = Math.ceil(L / pShared)
      const driftFromSharedPx = cAxisOk ? Number((Math.abs(aAxis.period - pShared) * cellCountEst).toFixed(6)) : null
      const relHalfDiff = cAxisOk ? Number((Math.abs(aAxis.period - 0.5 * pShared) / (0.5 * pShared)).toFixed(6)) : null
      const relDoubleDiff = cAxisOk ? Number((Math.abs(aAxis.period - 2.0 * pShared) / (2.0 * pShared)).toFixed(6)) : null

      let periodBand = 'incompatible'
      if (cAxisOk) {
        if (relPeriodDiff <= FROZEN_SPEC.primary_rel_tol) {
          periodBand = 'primary'
        } else if (relHalfDiff <= FROZEN_SPEC.harmonic_rel_tol) {
          periodBand = 'sub_harmonic_half'
        } else if (relDoubleDiff <= FROZEN_SPEC.harmonic_rel_tol) {
          periodBand = 'super_harmonic_double'
        }
      }

      const exactSubgridSupportBroken = Boolean(
        cAxisOk &&
        fixedSearchOk &&
        aAxis.lift >= 1 - 1e-9 &&
        bAxis.lift < 1 - 1e-9
      )

      axesDiag[axis] = {
        c_period: aAxis?.period ?? null,
        c_phase: aAxis?.phase ?? null,
        c_lift: aAxis?.lift ?? null,
        c_lattice: aAxis?.lattice ?? null,
        c_method: aAxis?.method ?? null,
        c_truncated: Boolean(aAxis?.truncated),
        shared_period: pShared,
        fixed_phase: bAxis?.phase ?? null,
        fixed_lift: bAxis?.lift ?? null,
        fixed_truncated: Boolean(bAxis?.truncated),
        c_axis_ok: cAxisOk,
        fixed_search_ok: fixedSearchOk,
        fixed_lift_ok: fixedLiftOk,
        lift_drop: liftDrop,
        lift_drop_ok: liftDropOk,
        rel_period_diff: relPeriodDiff,
        drift_from_shared_px: driftFromSharedPx,
        drift_le_0_5px: driftFromSharedPx !== null && driftFromSharedPx <= FROZEN_SPEC.v4_drift_tol_px,
        rel_half_diff: relHalfDiff,
        rel_double_diff: relDoubleDiff,
        period_band: periodBand,
        exact_subgrid_support_broken: exactSubgridSupportBroken,
      }
    }

    const bothAxesShiftedTogether = axesDiag.x.period_band !== 'primary' && axesDiag.y.period_band !== 'primary'
    perFrame.push({
      index: i,
      frame_id: a.frame_id,
      c_passed: cPassed,
      c_status: a.status,
      c_reason: a.reason,
      both_axes_shifted_together: bothAxesShiftedTogether,
      axes: axesDiag,
    })
  }

  // Axis-level primary fraction & spread
  const axisSummary = {}
  for (const axis of ['x', 'y']) {
    const primaryFrames = perFrame.filter(f => f.axes[axis].period_band === 'primary')
    const subHarmonicFrames = perFrame.filter(f => f.axes[axis].period_band === 'sub_harmonic_half')
    const superHarmonicFrames = perFrame.filter(f => f.axes[axis].period_band === 'super_harmonic_double')
    const incompatibleFrames = perFrame.filter(f => f.axes[axis].period_band === 'incompatible')
    const primaryPeriods = primaryFrames.map(f => f.axes[axis].c_period)
    const primarySpread = primaryPeriods.length >= 2
      ? Math.max(...primaryPeriods) - Math.min(...primaryPeriods)
      : 0
    const maxL = Math.max(...framesMeta.map(m => (axis === 'x' ? m.width : m.height)))
    const primaryDriftPx = primarySpread * Math.ceil(maxL / sharedPeriod[axis])

    axisSummary[axis] = {
      primary_count: primaryFrames.length,
      primary_fraction: Number((primaryFrames.length / totalCount).toFixed(4)),
      sub_harmonic_half_count: subHarmonicFrames.length,
      super_harmonic_double_count: superHarmonicFrames.length,
      incompatible_count: incompatibleFrames.length,
      primary_period_spread: Number(primarySpread.toFixed(6)),
      primary_cumulative_drift_px: Number(primaryDriftPx.toFixed(6)),
    }
  }

  // Evaluate G_strict
  const strictTriggers = []
  let strictVerdict = 'accepted'
  let strictReason = 'all_frames_in_primary_shared_scale_cluster'

  const anyFailedCorFixedLift = perFrame.some(f =>
    !f.c_passed ||
    !f.axes.x.fixed_search_ok || !f.axes.y.fixed_search_ok ||
    !f.axes.x.fixed_lift_ok || !f.axes.y.fixed_lift_ok
  )
  const anyLiftDropExceeded = perFrame.some(f =>
    !f.axes.x.lift_drop_ok || !f.axes.y.lift_drop_ok
  )
  const anyIncompatibleOrSuper = perFrame.some(f =>
    f.axes.x.period_band === 'incompatible' || f.axes.x.period_band === 'super_harmonic_double' ||
    f.axes.y.period_band === 'incompatible' || f.axes.y.period_band === 'super_harmonic_double'
  )
  const anyMultimodal = (
    axisSummary.x.primary_fraction < FROZEN_SPEC.min_primary_fraction_strict ||
    axisSummary.y.primary_fraction < FROZEN_SPEC.min_primary_fraction_strict
  )
  const subHarmonicFramesAll = perFrame.filter(f =>
    f.axes.x.period_band === 'sub_harmonic_half' || f.axes.y.period_band === 'sub_harmonic_half'
  )

  if (anyFailedCorFixedLift) {
    strictVerdict = 'rejected'
    strictReason = 'frame_failed_c_or_fixed_lift_below_0_3'
    strictTriggers.push('frame_failed_c_or_fixed_lift_below_0_3')
  }
  if (anyLiftDropExceeded) {
    strictVerdict = 'rejected'
    if (strictTriggers.length === 0) strictReason = 'lift_drop_exceeds_0_15'
    strictTriggers.push('lift_drop_exceeds_0_15')
  }
  if (anyIncompatibleOrSuper) {
    strictVerdict = 'rejected'
    if (strictTriggers.length === 0) strictReason = 'incompatible_or_superharmonic_period'
    strictTriggers.push('incompatible_or_superharmonic_period')
  }
  if (anyMultimodal) {
    strictVerdict = 'rejected'
    if (strictTriggers.length === 0) strictReason = 'multimodal_period_distribution'
    strictTriggers.push('multimodal_period_distribution')
  }

  if (strictVerdict === 'accepted' && subHarmonicFramesAll.length > 0) {
    const hasTrueHalfScaleEvidence = subHarmonicFramesAll.some(f =>
      f.axes.x.exact_subgrid_support_broken ||
      f.axes.y.exact_subgrid_support_broken ||
      f.both_axes_shifted_together
    )
    if (hasTrueHalfScaleEvidence) {
      strictVerdict = 'rejected'
      strictReason = 'sub_period_has_true_half_scale_evidence'
      strictTriggers.push('sub_period_has_true_half_scale_evidence')
    } else {
      strictVerdict = 'undetermined'
      strictReason = 'single_axis_subharmonic_cannot_prove_common_scale_without_truth'
      strictTriggers.push('single_axis_subharmonic_cannot_prove_common_scale_without_truth')
    }
  }
  if (strictTriggers.length === 0) {
    strictTriggers.push('all_frames_primary_and_lift_valid')
  }


  return {
    c_passed_count: cPassedIndices.length,
    total_count: totalCount,
    shared_period: sharedPeriod,
    axis_summary: axisSummary,
    strict_gate: {
      verdict: strictVerdict,
      reason: strictReason,
      triggered_conditions: strictTriggers,
    },
    per_frame_diagnostics: perFrame,
  }
}

function buildOldAxisInfo(period, phase, length) {
  const interior = latticeBoundaries(period, phase, length)
  const bounds = [0, ...interior, length]
  const numCells = bounds.length - 1
  const periodQ = Math.round(period * FIXED_POINT)
  const phaseQ = ((Math.round(phase * FIXED_POINT) % periodQ) + periodQ) % periodQ
  const firstBoundary = Math.floor(phaseQ / FIXED_POINT)
  const mMinOld = firstBoundary > 0 ? -1 : 0
  const mMaxOld = mMinOld + numCells - 1
  const leadRemainderPx = firstBoundary > 0 ? firstBoundary : 0
  const lastBoundary = interior.length ? interior[interior.length - 1] : 0
  const trailRemainderPx = length - lastBoundary
  return {
    bounds,
    interior_count: interior.length,
    num_cells: numCells,
    first_boundary: firstBoundary,
    last_boundary: lastBoundary,
    lead_remainder_px: leadRemainderPx,
    trail_remainder_px: trailRemainderPx,
    m_min_old: mMinOld,
    m_max_old: mMaxOld,
  }
}

function selectCircularReferencePhase(phases, period) {
  const N = phases.length
  let sumCos = 0
  let sumSin = 0
  for (let i = 0; i < N; i += 1) {
    const theta = (2 * Math.PI * phases[i]) / period
    sumCos += Math.cos(theta)
    sumSin += Math.sin(theta)
  }
  const C = sumCos / N
  const S = sumSin / N
  const R = Math.hypot(C, S)
  if (R <= 1e-9) {
    return {
      ref_phase: phases[0],
      ref_frame_index: 0,
      circular_mean_phase: phases[0],
      resultant_length: Number(R.toFixed(6)),
      selection_mode: 'fallback_frame_0',
    }
  }
  let circPhase = ((Math.atan2(S, C) / (2 * Math.PI)) * period) % period
  if (circPhase < 0) circPhase += period
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < N; i += 1) {
    const diff = Math.abs(phases[i] - circPhase)
    const circDist = Math.min(diff, period - diff)
    if (circDist < bestDist - 1e-12) {
      bestDist = circDist
      bestIdx = i
    }
  }
  return {
    ref_phase: phases[bestIdx],
    ref_frame_index: bestIdx,
    circular_mean_phase: Number(circPhase.toFixed(6)),
    resultant_length: Number(R.toFixed(6)),
    selection_mode: 'closest_observed_to_circular_mean',
  }
}

function unwrapPhaseAndIndex(phase, refPhase, period, oldAxisInfo) {
  const delta = phase - refPhase
  const halfP = period / 2
  // Half-open interval [refPhase - P/2, refPhase + P/2):
  // delta < -P/2 -> n = +1
  // delta >= +P/2 -> n = -1
  // otherwise -> n = 0
  let nOffset = 0
  if (delta < -halfP - 1e-12) {
    nOffset = 1
  } else if (delta >= halfP - 1e-12) {
    nOffset = -1
  }
  const unwrappedPhase = Number((phase + nOffset * period).toFixed(6))
  // Physical grid identity: phase + m_old * P = (phase + nOffset * P) + (m_old - nOffset) * P
  const mMinNew = oldAxisInfo.m_min_old - nOffset
  const mMaxNew = oldAxisInfo.m_max_old - nOffset
  return {
    modular_phase: phase,
    ref_phase: refPhase,
    delta_from_ref: Number(delta.toFixed(6)),
    period_winding_n: nOffset,
    unwrapped_phase: unwrappedPhase,
    m_min_old: oldAxisInfo.m_min_old,
    m_max_old: oldAxisInfo.m_max_old,
    m_min_new: mMinNew,
    m_max_new: mMaxNew,
    lead_remainder_px: oldAxisInfo.lead_remainder_px,
    trail_remainder_px: oldAxisInfo.trail_remainder_px,
    num_cells: oldAxisInfo.num_cells,
  }
}

function placeSampledFrame(sampled, mMinX, mMinY, sharedRangeX, sharedRangeY) {
  const width = sharedRangeX.M_max - sharedRangeX.M_min + 1
  const height = sharedRangeY.M_max - sharedRangeY.M_min + 1
  const offsetX = mMinX - sharedRangeX.M_min
  const offsetY = mMinY - sharedRangeY.M_min
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let y = 0; y < sampled.height; y += 1) {
    const srcStart = y * sampled.width * 4
    const dstStart = ((y + offsetY) * width + offsetX) * 4
    out.data.set(sampled.data.subarray(srcStart, srcStart + sampled.width * 4), dstStart)
  }
  return {
    image: out,
    offset: { x: offsetX, y: offsetY },
  }
}

function evaluatePhaseUnwrappingCandidateB(framesInput, sharedPeriod, solvedPhasesPerFrame, expectedSampledHashes = null) {
  if (!sharedPeriod) {
    return null
  }
  const N = framesInput.length
  const xPhases = solvedPhasesPerFrame.map(s => s.x)
  const yPhases = solvedPhasesPerFrame.map(s => s.y)
  const refX = selectCircularReferencePhase(xPhases, sharedPeriod.x)
  const refY = selectCircularReferencePhase(yPhases, sharedPeriod.y)

  const perFrame = []
  for (let i = 0; i < N; i += 1) {
    const src = framesInput[i].image
    const oldX = buildOldAxisInfo(sharedPeriod.x, xPhases[i], src.width)
    const oldY = buildOldAxisInfo(sharedPeriod.y, yPhases[i], src.height)
    const sampled = sampleCells(src, { x: oldX.bounds, y: oldY.bounds })
    const sampledSha = hashImage(sampled)
    if (expectedSampledHashes && expectedSampledHashes[i] && sampledSha !== expectedSampledHashes[i]) {
      throw new Error(`Sampled image SHA mismatch at frame ${i}: got ${sampledSha}, expected ${expectedSampledHashes[i]}`)
    }
    const unwrapX = unwrapPhaseAndIndex(xPhases[i], refX.ref_phase, sharedPeriod.x, oldX)
    const unwrapY = unwrapPhaseAndIndex(yPhases[i], refY.ref_phase, sharedPeriod.y, oldY)
    perFrame.push({
      index: i,
      frame_id: framesInput[i].frame_id,
      sampled_width: sampled.width,
      sampled_height: sampled.height,
      sampled_rgba_sha256: sampledSha,
      x: unwrapX,
      y: unwrapY,
      _sampled: sampled,
    })
  }

  const oldSharedX = {
    M_min: Math.min(...perFrame.map(f => f.x.m_min_old)),
    M_max: Math.max(...perFrame.map(f => f.x.m_max_old)),
  }
  const oldSharedY = {
    M_min: Math.min(...perFrame.map(f => f.y.m_min_old)),
    M_max: Math.max(...perFrame.map(f => f.y.m_max_old)),
  }
  const newSharedX = {
    M_min: Math.min(...perFrame.map(f => f.x.m_min_new)),
    M_max: Math.max(...perFrame.map(f => f.x.m_max_new)),
  }
  const newSharedY = {
    M_min: Math.min(...perFrame.map(f => f.y.m_min_new)),
    M_max: Math.max(...perFrame.map(f => f.y.m_max_new)),
  }

  for (const f of perFrame) {
    const oldPlaced = placeSampledFrame(f._sampled, f.x.m_min_old, f.y.m_min_old, oldSharedX, oldSharedY)
    const newPlaced = placeSampledFrame(f._sampled, f.x.m_min_new, f.y.m_min_new, newSharedX, newSharedY)
    f.old_placed = {
      width: oldPlaced.image.width,
      height: oldPlaced.image.height,
      offset: oldPlaced.offset,
      rgba_sha256: hashImage(oldPlaced.image),
    }
    f.new_placed = {
      width: newPlaced.image.width,
      height: newPlaced.image.height,
      offset: newPlaced.offset,
      rgba_sha256: hashImage(newPlaced.image),
    }
    f._oldPlacedImg = oldPlaced.image
    f._newPlacedImg = newPlaced.image
  }

  return {
    shared_period: sharedPeriod,
    reference_phase: { x: refX, y: refY },
    old_shared_index_range: { x: oldSharedX, y: oldSharedY },
    old_shared_canvas: {
      width: oldSharedX.M_max - oldSharedX.M_min + 1,
      height: oldSharedY.M_max - oldSharedY.M_min + 1,
    },
    new_shared_index_range: { x: newSharedX, y: newSharedY },
    new_shared_canvas: {
      width: newSharedX.M_max - newSharedX.M_min + 1,
      height: newSharedY.M_max - newSharedY.M_min + 1,
    },
    frames: perFrame,
  }
}

function runFullMethodAandFixedSolve(framesInput) {
  const methodA = []
  for (let i = 0; i < framesInput.length; i += 1) {
    const item = framesInput[i]
    const res = recoverPixelGrid(item.image)
    const profiles = interiorEdgeProfiles(item.image, { noiseFloor: 16, alphaThreshold: 8, includeSilhouette: true })
    methodA.push({
      index: i,
      frame_id: item.frame_id,
      input_width: item.image.width,
      input_height: item.image.height,
      input_rgba_sha256: hashImage(item.image),
      status: res.report.status,
      reason: res.report.reason,
      output_width: res.image.width,
      output_height: res.image.height,
      output_rgba_sha256: hashImage(res.image),
      axes: {
        x: res.report.axes?.x ? {
          period: res.report.axes.x.period,
          phase: res.report.axes.x.phase,
          lift: res.report.axes.x.lift,
          lattice: res.report.axes.x.lattice,
          method: res.report.axes.x.method || null,
          truncated: Boolean(res.report.axes.x.truncated),
        } : null,
        y: res.report.axes?.y ? {
          period: res.report.axes.y.period,
          phase: res.report.axes.y.phase,
          lift: res.report.axes.y.lift,
          lattice: res.report.axes.y.lattice,
          method: res.report.axes.y.method || null,
          truncated: Boolean(res.report.axes.y.truncated),
        } : null,
      },
      _profiles: profiles,
    })
  }

  const passed = methodA.filter(f => f.status === 'resampled')
  if (!passed.length) {
    return { methodA, sharedPeriod: null, methodBRows: [] }
  }
  const sharedPeriod = {
    x: medianLower(passed.map(f => f.axes.x.period)),
    y: medianLower(passed.map(f => f.axes.y.period)),
  }
  const methodBRows = methodA.map((aRow) => ({
    index: aRow.index,
    frame_id: aRow.frame_id,
    solved_axes: {
      x: solvePhaseAtFixedPeriod(aRow._profiles.x, sharedPeriod.x),
      y: solvePhaseAtFixedPeriod(aRow._profiles.y, sharedPeriod.y),
    },
  }))
  for (const aRow of methodA) delete aRow._profiles
  return { methodA, sharedPeriod, methodBRows }
}

function findOpaqueSubRect(image) {
  let minX = image.width, minY = image.height, maxX = -1, maxY = -1
  let nonZeroAlphaCount = 0
  let opaqueCount = 0
  let semiTransparentCount = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const a = image.data[(y * image.width + x) * 4 + 3]
      if (a > 0) {
        nonZeroAlphaCount += 1
        if (a === 255) opaqueCount += 1
        else semiTransparentCount += 1
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { valid: false, reason: 'empty_image' }
  }
  const rectW = maxX - minX + 1
  const rectH = maxY - minY + 1
  const rectArea = rectW * rectH
  const isFullCanvas = minX === 0 && minY === 0 && rectW === image.width && rectH === image.height
  const isSolidOpaqueRect = opaqueCount === rectArea && nonZeroAlphaCount === rectArea
  return {
    valid: isSolidOpaqueRect,
    is_full_canvas: isFullCanvas,
    has_transparent_padding: !isFullCanvas && isSolidOpaqueRect,
    rect: { x: minX, y: minY, w: rectW, h: rectH },
    rect_area: rectArea,
    non_zero_alpha_count: nonZeroAlphaCount,
    opaque_count: opaqueCount,
    semi_transparent_count: semiTransparentCount,
    reason: isSolidOpaqueRect ? null : 'non_transparent_region_is_not_a_solid_opaque_rectangle',
  }
}

function extractSubImage(image, rect) {
  const out = { width: rect.w, height: rect.h, data: new Uint8ClampedArray(rect.w * rect.h * 4) }
  for (let y = 0; y < rect.h; y += 1) {
    const srcOffset = ((rect.y + y) * image.width + rect.x) * 4
    out.data.set(image.data.subarray(srcOffset, srcOffset + rect.w * 4), y * rect.w * 4)
  }
  return out
}

function pasteSubImage(canvasW, canvasH, subImage, rect) {
  const out = { width: canvasW, height: canvasH, data: new Uint8ClampedArray(canvasW * canvasH * 4) }
  for (let y = 0; y < rect.h; y += 1) {
    const srcOffset = y * rect.w * 4
    const dstOffset = ((rect.y + y) * canvasW + rect.x) * 4
    out.data.set(subImage.data.subarray(srcOffset, srcOffset + rect.w * 4), dstOffset)
  }
  return out
}

// Count remaining interior pixels that match the detected background color (enclosed holes not reached by border flood fill)
function countRemainingBgColorPixels(image, repColor) {
  if (!repColor) return 0
  let count = 0
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] !== 255) continue
    const dr = Math.abs(image.data[i] - repColor.r)
    const dg = Math.abs(image.data[i + 1] - repColor.g)
    const db = Math.abs(image.data[i + 2] - repColor.b)
    if (Math.max(dr, dg, db) <= 28 && (dr + dg + db) <= 64) count += 1
  }
  return count
}

function runBackgroundRemovalOnImage(image, { allowSubRect = false } = {}) {
  let hasTrans = false
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] !== 255) {
      hasTrans = true
      break
    }
  }
  // 1. Raw full-canvas detectAutomaticBackground
  const rawAuto = detectAutomaticBackground(image.data, image.width, image.height)
  const rawApplied = applyBackgroundSelection(image.data, image.width, image.height, {
    proposedMask: rawAuto.mask,
    transparent: false,
  })
  const rawOutput = { width: image.width, height: image.height, data: new Uint8ClampedArray(rawApplied.working) }

  // 2. Sub-rectangle adapted background removal (when outer padding is transparent and interior is a solid opaque rectangle)
  const subCheck = findOpaqueSubRect(image)
  let subResult = null
  if (allowSubRect) {
    if (!subCheck.valid) {
      subResult = {
        applicable: false,
        reason: subCheck.reason,
        sub_check: subCheck,
      }
    } else {
      const subImg = extractSubImage(image, subCheck.rect)
      const subAuto = detectAutomaticBackground(subImg.data, subImg.width, subImg.height)
      const subApplied = applyBackgroundSelection(subImg.data, subImg.width, subImg.height, {
        proposedMask: subAuto.mask,
        transparent: false,
      })
      const subCleanImg = { width: subImg.width, height: subImg.height, data: new Uint8ClampedArray(subApplied.working) }
      const fullOut = pasteSubImage(image.width, image.height, subCleanImg, subCheck.rect)
      const remainingBgLike = countRemainingBgColorPixels(fullOut, subAuto.color)
      subResult = {
        applicable: true,
        rect: subCheck.rect,
        status: subAuto.status,
        reason: subAuto.reason,
        detected_id: subAuto.id,
        detected_color: subAuto.color,
        omitted_count: subApplied.omittedCount,
        remaining_interior_bg_like_pixels: remainingBgLike,
        output_rgba_sha256: hashImage(fullOut),
        _image: fullOut,
      }
    }
  }

  const rawRemainingBgLike = countRemainingBgColorPixels(rawOutput, rawAuto.color)
  return {
    source_has_transparent_pixel: hasTrans,
    prepare_general_asset_frame_would_skip: hasTrans,
    raw_full_canvas: {
      status: rawAuto.status,
      reason: rawAuto.reason,
      detected_id: rawAuto.id,
      detected_color: rawAuto.color,
      omitted_count: rawApplied.omittedCount,
      remaining_interior_bg_like_pixels: rawRemainingBgLike,
      output_rgba_sha256: hashImage(rawOutput),
      _image: rawOutput,
    },
    sub_rect_adapted: subResult,
  }
}

export { runFullMethodAandFixedSolve, evaluateSharedScaleCandidateA, evaluatePhaseUnwrappingCandidateB, runBackgroundRemovalOnImage }
