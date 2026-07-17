import { encodeRgbaPng } from '../character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
import { validateNormalizedFrames } from '../character-pack/validator.js'
import { evaluateIdentityConsistency } from './identityConsistencyGate.js'
import { framesFromSheet } from './sheetFrames.js'
import { applyMotionStrip } from './stripApplier.js'
import { validateMotionSourceSetManifest } from './sourceSet.js'

function stripKeys(strip) {
  return [strip?.id, strip?.runtime_action].filter(Boolean).map(String)
}

function indexStrips(strips = []) {
  const map = new Map()
  for (const strip of strips) {
    for (const key of stripKeys(strip)) map.set(key, strip)
  }
  return map
}

function mergedWarnings(...lists) {
  return [...new Set(lists.flat().filter(Boolean))].sort()
}

function mergedErrors(...lists) {
  return [...new Set(lists.flat().filter(Boolean))].sort()
}

function failReport({ setReport, identityReport, blockingErrors = [], warnings = [], profile }) {
  return {
    schema_version: 1,
    mode: 'motion_source_set_apply_report_v1',
    status: 'fail',
    source_set_status: setReport?.status ?? 'fail',
    identity_status: identityReport?.status ?? 'skipped',
    can_apply_multi_strip: false,
    profile_id: profile.id,
    applied_actions: [],
    skipped_actions: [],
    warnings: mergedWarnings(setReport?.warnings ?? [], identityReport?.warnings ?? [], warnings),
    blocking_errors: mergedErrors(setReport?.blocking_errors ?? [], identityReport?.blocking_errors ?? [], blockingErrors),
    validation: { status: 'not_run', blocking_errors: [], warnings: [] },
  }
}

function sourceStrip(strip) {
  return strip?.image ?? strip?.strip ?? strip
}

export async function applyMotionSourceSet({
  sheet,
  manifest,
  strips = [],
  profile = TOPDOWN_RPG_V0,
  resampleStrategy = 'reject_mismatch',
  identityThresholds,
} = {}) {
  const setReport = validateMotionSourceSetManifest(manifest)
  if (!setReport.normalized_manifest) {
    return {
      appliedSheet: sheet,
      appliedNormalizedSheetPng: null,
      setReport,
      identityReport: null,
      report: failReport({ setReport, profile }),
    }
  }

  const normalized = setReport.normalized_manifest
  const stripMap = indexStrips(strips)
  const orderedStrips = []
  const missing = []
  for (const source of normalized.sources) {
    const strip = stripMap.get(source.id) ?? stripMap.get(source.runtime_action)
    if (!strip) {
      missing.push(`missing_motion_strip:${source.id}`)
      continue
    }
    orderedStrips.push({
      ...strip,
      id: source.id,
      runtime_action: source.runtime_action,
      facing_direction: source.facing_direction ?? strip.facing_direction,
    })
  }
  if (missing.length) {
    return {
      appliedSheet: sheet,
      appliedNormalizedSheetPng: null,
      setReport,
      identityReport: null,
      report: failReport({ setReport, blockingErrors: missing, profile }),
    }
  }

  const anchorSource = normalized.sources.find((source) => (
    source.id === normalized.identity_anchor.source_id
    || source.runtime_action === normalized.identity_anchor.source_id
  ))
  const identityReport = evaluateIdentityConsistency(orderedStrips, {
    identityAnchor: {
      ...normalized.identity_anchor,
      facing_direction: normalized.identity_anchor.facing_direction ?? anchorSource?.facing_direction,
    },
    thresholds: identityThresholds ?? manifest.identity_thresholds,
  })
  if (identityReport.status === 'fail') {
    return {
      appliedSheet: sheet,
      appliedNormalizedSheetPng: null,
      setReport,
      identityReport,
      report: failReport({ setReport, identityReport, profile }),
    }
  }

  let currentSheet = sheet
  const appliedActions = []
  for (const source of normalized.sources) {
    const strip = stripMap.get(source.id) ?? stripMap.get(source.runtime_action)
    try {
      const applied = await applyMotionStrip({
        sheet: currentSheet,
        strip: sourceStrip(strip),
        action: source.runtime_action,
        profile,
        resampleStrategy,
      })
      currentSheet = applied.appliedSheet
      appliedActions.push({
        runtime_action: source.runtime_action,
        source_id: source.id,
        status: applied.report.status,
        source_strip_frame_count: applied.report.source_strip_frame_count,
        target_frame_count: applied.report.target_frame_count,
        resample_strategy: applied.report.resample_strategy,
      })
    } catch (error) {
      return {
        appliedSheet: sheet,
        appliedNormalizedSheetPng: null,
        setReport,
        identityReport,
        report: failReport({
          setReport,
          identityReport,
          blockingErrors: [`apply_motion_strip_failed:${source.runtime_action}:${error.message || String(error)}`],
          profile,
        }),
      }
    }
  }

  const frames = framesFromSheet(currentSheet, profile)
  const validation = validateNormalizedFrames(frames, profile)
  const report = {
    schema_version: 1,
    mode: 'motion_source_set_apply_report_v1',
    status: validation.blocking_errors.length ? 'warning' : 'done',
    source_set_status: setReport.status,
    identity_status: identityReport.status,
    can_apply_multi_strip: identityReport.can_apply_multi_strip,
    profile_id: profile.id,
    applied_actions: appliedActions,
    skipped_actions: [],
    warnings: mergedWarnings(setReport.warnings ?? [], identityReport.warnings ?? [], validation.warnings ?? []),
    blocking_errors: validation.blocking_errors,
    validation: {
      status: validation.status,
      blocking_errors: validation.blocking_errors,
      warnings: validation.warnings,
    },
  }

  return {
    appliedSheet: currentSheet,
    appliedNormalizedSheetPng: await encodeRgbaPng(currentSheet),
    setReport,
    identityReport,
    report,
  }
}
