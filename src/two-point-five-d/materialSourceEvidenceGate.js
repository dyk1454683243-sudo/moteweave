import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'

import sharp from 'sharp'

import { writeTwoPointFiveDTilesetArtifacts } from './atlasExporter.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from './tilesetContract.js'

const MODE = 'two_point_five_d_material_source_evidence_gate_v1'
const MANIFEST_MODE = 'two_point_five_d_material_source_manifest_v1'
const QUALITY_CLOSURE_MODE = 'two_point_five_d_material_source_quality_closure_v1'
const DEFAULT_OUTPUT_DIR = 'generated/two-point-five-d-material-source-evidence'
const VALID_SOURCE_RIGHTS = new Set([
  'cc0',
  'original',
  'public_domain',
  'test_generated',
  'user_provided_local_only',
  'user_provided_for_repository_test_use',
  'user_provided_with_repository_test_rights',
])
const STATUS_ORDER = Object.freeze({ pass: 0, warning: 1, fail: 2, error: 3 })

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function runIdFromDate(date = new Date()) {
  return `material_source_evidence_${date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')}`
}

function safePathSegment(value = 'sample', fallback = 'sample') {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback
}

function normalizeId(value = '') {
  return String(value || '').trim()
}

function normalizeSourceRights(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function pathInside(baseDir, filePath) {
  const base = path.resolve(baseDir)
  const resolved = path.resolve(filePath)
  return resolved === base || resolved.startsWith(`${base}${path.sep}`)
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function issue(sampleId, severity, code, message, details = {}) {
  return {
    sample_id: sampleId ?? null,
    severity,
    code,
    message,
    ...details,
  }
}

function statusFromIssues(issues) {
  if (issues.some((item) => item.severity === 'error')) return 'fail'
  if (issues.some((item) => item.severity === 'warning')) return 'warning'
  return 'pass'
}

function summarizeIssues(issues) {
  return {
    status: statusFromIssues(issues),
    errors: issues.filter((item) => item.severity === 'error').length,
    warnings: issues.filter((item) => item.severity === 'warning').length,
    total_issues: issues.length,
  }
}

async function imageInfo(buffer) {
  const metadata = await sharp(buffer).metadata()
  if (!metadata.width || !metadata.height || !metadata.format) throw new Error('image metadata is incomplete')
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
  }
}

function resolveManifestPath(baseDir, filePath) {
  const resolved = path.resolve(baseDir, filePath)
  if (!pathInside(baseDir, resolved)) {
    throw new Error('manifest sample file must stay inside the manifest directory')
  }
  return resolved
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function readContract({ manifest, baseDir, sample }) {
  const contractPath = sample.contract ?? manifest.contract
  if (!contractPath) return DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT
  return readJsonFile(path.resolve(baseDir, contractPath))
}

async function readMaterialLayout({ manifest, baseDir, sample }) {
  const layoutPath = sample.material_layout ?? manifest.material_layout
  if (!layoutPath) return null
  return readJsonFile(path.resolve(baseDir, layoutPath))
}

function selectSamples(manifest, sampleIds = []) {
  const idSet = new Set(sampleIds.map(String))
  const samples = Array.isArray(manifest.samples) ? manifest.samples : []
  if (!idSet.size) return samples
  return samples.filter((sample) => idSet.has(sample.id))
}

export async function validateMaterialSourceEvidenceManifest({ manifestPath } = {}) {
  if (!manifestPath) throw new Error('manifestPath is required')
  const resolvedManifest = path.resolve(manifestPath)
  const baseDir = path.dirname(resolvedManifest)
  const manifest = JSON.parse(await readFile(resolvedManifest, 'utf8'))
  const issues = []
  const items = []
  const samples = Array.isArray(manifest.samples) ? manifest.samples : []
  if (!Number.isInteger(manifest.schema_version)) {
    issues.push(issue(null, 'error', 'manifest.schema_version_missing', 'manifest.schema_version must be an integer'))
  }
  if (!Array.isArray(manifest.samples)) {
    issues.push(issue(null, 'error', 'manifest.samples_missing', 'manifest.samples must be an array'))
  }

  const seenIds = new Set()
  for (const sample of samples) {
    const id = normalizeId(sample.id)
    const sampleIssues = []
    if (!id) sampleIssues.push(issue(null, 'error', 'sample.id_missing', 'sample id is required'))
    if (id && !/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
      sampleIssues.push(issue(id, 'error', 'sample.id_invalid', 'sample id must be lowercase letters, numbers, underscores, or hyphens'))
    }
    if (id && seenIds.has(id)) sampleIssues.push(issue(id, 'error', 'sample.id_duplicate', `duplicate sample id: ${id}`))
    if (id) seenIds.add(id)
    if (!sample.file) {
      sampleIssues.push(issue(id, 'error', 'sample.file_missing', 'sample file is required'))
    }
    const rights = normalizeSourceRights(sample.source_rights)
    if (!rights) {
      sampleIssues.push(issue(id, 'error', 'sample.source_rights_missing', 'sample source_rights is required'))
    } else if (!VALID_SOURCE_RIGHTS.has(rights)) {
      sampleIssues.push(issue(id, 'error', 'sample.source_rights_invalid', `unsupported source_rights: ${sample.source_rights}`))
    }
    if (sample.expected_status && !['pass', 'warning', 'fail', 'error'].includes(sample.expected_status)) {
      sampleIssues.push(issue(id, 'warning', 'sample.expected_status_invalid', 'sample expected_status should be pass, warning, fail, or error'))
    }
    let fileInfo = null
    let hash = null
    if (sample.file) {
      try {
        const filePath = resolveManifestPath(baseDir, sample.file)
        const buffer = await readFile(filePath)
        fileInfo = await imageInfo(buffer)
        hash = sha256(buffer)
        if (sample.sha256 && sample.sha256 !== hash) {
          sampleIssues.push(issue(id, 'error', 'sample.sha256_mismatch', 'sample sha256 does not match file content'))
        }
      } catch (error) {
        sampleIssues.push(issue(id, 'error', 'sample.file_unreadable', error.message ?? 'sample file cannot be read', { file: sample.file }))
      }
    }
    issues.push(...sampleIssues)
    items.push({
      id,
      file: sample.file ?? null,
      source_rights: rights || null,
      expected_status: sample.expected_status ?? null,
      status: statusFromIssues(sampleIssues),
      image: fileInfo,
      sha256: hash,
      issues: sampleIssues,
    })
  }

  return {
    schema_version: 1,
    mode: MANIFEST_MODE,
    manifest: {
      path: resolvedManifest,
      base_dir: baseDir,
      fixture_set: manifest.fixture_set ?? null,
      schema_version: manifest.schema_version ?? null,
    },
    summary: {
      total: samples.length,
      ...summarizeIssues(issues),
    },
    issues,
    items,
  }
}

function collectItemWarnings(result) {
  return [
    ...(result.validation?.warnings ?? []),
    ...(result.plan?.source_normalization?.warnings ?? []).map((code) => `source_normalization.${code}`),
    ...(result.plan?.material_source?.warnings ?? []).map((code) => `material_source.${code}`),
    ...(result.plan?.material_source?.quality_gates?.warnings ?? []).map((code) => `quality_gate.${code}`),
    ...(result.plan?.material_source_guidance?.issues ?? [])
      .filter((item) => item.severity !== 'info')
      .map((item) => `guidance.${item.code}`),
  ]
}

function collectItemBlockingErrors(result) {
  return [
    ...(result.validation?.blocking_errors ?? []),
  ]
}

function itemStatus({ result, warnings, blockingErrors }) {
  if (result.status === 'fail' || blockingErrors.length) return 'fail'
  if (warnings.length) return 'warning'
  return 'pass'
}

function statusCounts(items) {
  const counts = { pass: 0, warning: 0, fail: 0, error: 0 }
  for (const item of items) {
    const status = counts[item.status] === undefined ? 'error' : item.status
    counts[status] += 1
  }
  return counts
}

function overallStatus(items, manifestValidation) {
  if (manifestValidation.summary.status === 'fail') return 'fail'
  let status = 'pass'
  for (const item of items) {
    if ((STATUS_ORDER[item.status] ?? 3) > (STATUS_ORDER[status] ?? 0)) status = item.status
  }
  return status === 'error' ? 'fail' : status
}

function topIssueTaxonomy(items) {
  const map = new Map()
  for (const item of items) {
    for (const code of [...(item.warnings ?? []), ...(item.blocking_errors ?? [])]) {
      const entry = map.get(code) ?? { id: code, count: 0, examples: [] }
      entry.count += 1
      if (entry.examples.length < 3) entry.examples.push(item.id)
      map.set(code, entry)
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

function summaryForItems(items, manifestValidation) {
  const validation = statusCounts(items)
  const usable = validation.pass + validation.warning
  const expectationItems = items.filter((item) => item.expectation_met !== null)
  const expectationMet = expectationItems.filter((item) => item.expectation_met).length
  return {
    total: items.length,
    validation,
    usable_count: usable,
    usable_rate: items.length ? round(usable / items.length) : 0,
    expectation_count: expectationItems.length,
    expectation_met_count: expectationMet,
    expectation_met_rate: expectationItems.length ? round(expectationMet / expectationItems.length) : null,
    manifest_status: manifestValidation.summary.status,
    failure_taxonomy: {
      top_categories: topIssueTaxonomy(items),
    },
  }
}

function canonicalIssueCode(code) {
  const value = String(code || '')
  if (value.startsWith('source_normalization.')) return value
  return value.replace(/^(guidance|material_source|quality_gate)\./, '')
}

function issueFamily(code) {
  if (code === 'palette_color_count_exceeds_max') {
    return {
      stage: 'validator',
      family: 'palette_policy',
      severity: 'release_warning',
      action: 'limit_material_patch_palette',
      message: 'Rendered atlas exceeds the limited palette contract.',
    }
  }
  if (code === 'source_normalization.source_format_normalized_to_png') {
    return {
      stage: 'source_normalizer',
      family: 'source_format',
      severity: 'advisory',
      action: 'export_true_png_sources',
      message: 'Source payload was normalized to PNG before material extraction.',
    }
  }
  if (code.startsWith('source_normalization.')) {
    return {
      stage: 'source_normalizer',
      family: 'source_normalization',
      severity: 'advisory',
      action: 'tighten_manual_source_handoff',
      message: 'Source normalization changed the input before extraction.',
    }
  }
  if (code.startsWith('material_slot_low_distinction_')) {
    return {
      stage: 'material_builder',
      family: 'slot_distinction',
      severity: 'release_warning',
      action: 'improve_material_slot_separation',
      message: 'Required material slots are too visually similar.',
    }
  }
  if (code.startsWith('material_patch_repeat_edge_delta_')) {
    return {
      stage: 'material_builder',
      family: 'patch_tileability',
      severity: 'release_warning',
      action: 'improve_tileable_patch_extraction',
      message: 'Extracted material patch edges do not self-repeat cleanly.',
    }
  }
  if (code.startsWith('material_patch_low_')) {
    return {
      stage: 'material_builder',
      family: 'patch_texture_detail',
      severity: 'authoring_warning',
      action: 'improve_patch_texture_detail',
      message: 'Extracted material patch has weak texture detail.',
    }
  }
  if (code.startsWith('sample_region_')) {
    return {
      stage: 'material_builder',
      family: 'sample_region_quality',
      severity: 'authoring_warning',
      action: 'improve_sample_region_content',
      message: 'Configured sample region has weak material content.',
    }
  }
  return {
    stage: 'unknown',
    family: 'other',
    severity: 'release_warning',
    action: 'review_material_source_warning',
    message: 'Material source gate reported a warning that needs review.',
  }
}

function severityWeight(severity) {
  if (severity === 'blocking') return 100
  if (severity === 'release_warning') return 10
  if (severity === 'authoring_warning') return 5
  return 1
}

function buildMaterialSourceQualityClosure({ items, summary, manifestValidation }) {
  const issueGroups = new Map()
  const actionGroups = new Map()
  const stageGroups = new Map()
  const prioritizedSamples = []
  let deterministicBlockerCount = 0
  let releaseWarningItemCount = 0
  let authoringWarningItemCount = 0
  let advisoryOnlyItemCount = 0

  for (const item of items) {
    const canonicalWarnings = [...new Set((item.warnings ?? []).map(canonicalIssueCode))]
    const blockingErrors = [...new Set(item.blocking_errors ?? [])]
    if (blockingErrors.length || item.status === 'fail' || item.status === 'error') deterministicBlockerCount += 1

    const sampleIssues = [
      ...blockingErrors.map((code) => ({
        code,
        stage: 'validator',
        family: 'blocking_error',
        severity: 'blocking',
        action: 'fix_deterministic_blocker',
        message: 'Deterministic validation blocked this sample.',
      })),
      ...canonicalWarnings.map((code) => ({
        code,
        ...issueFamily(code),
      })),
    ]
    const hasReleaseWarning = sampleIssues.some((issue) => issue.severity === 'release_warning')
    const hasAuthoringWarning = sampleIssues.some((issue) => issue.severity === 'authoring_warning')
    const hasOnlyAdvisory = sampleIssues.length && sampleIssues.every((issue) => issue.severity === 'advisory')
    if (hasReleaseWarning) releaseWarningItemCount += 1
    if (hasAuthoringWarning) authoringWarningItemCount += 1
    if (hasOnlyAdvisory) advisoryOnlyItemCount += 1

    for (const issueItem of sampleIssues) {
      const key = issueItem.code
      const entry = issueGroups.get(key) ?? {
        id: key,
        stage: issueItem.stage,
        family: issueItem.family,
        severity: issueItem.severity,
        action: issueItem.action,
        message: issueItem.message,
        count: 0,
        examples: [],
      }
      entry.count += 1
      if (entry.examples.length < 3) entry.examples.push(item.id)
      issueGroups.set(key, entry)

      const action = actionGroups.get(issueItem.action) ?? {
        id: issueItem.action,
        severity: issueItem.severity,
        count: 0,
        issue_families: new Set(),
        examples: [],
      }
      action.count += 1
      action.issue_families.add(issueItem.family)
      if (action.examples.length < 3 && !action.examples.includes(item.id)) action.examples.push(item.id)
      actionGroups.set(issueItem.action, action)

      const stage = stageGroups.get(issueItem.stage) ?? { id: issueItem.stage, count: 0, families: new Set() }
      stage.count += 1
      stage.families.add(issueItem.family)
      stageGroups.set(issueItem.stage, stage)
    }

    const riskScore = sampleIssues.reduce((total, issueItem) => total + severityWeight(issueItem.severity), 0)
    prioritizedSamples.push({
      id: item.id,
      status: item.status,
      risk_score: riskScore,
      layout_selected_id: item.metrics?.layout_selected_id ?? null,
      release_warnings: sampleIssues.filter((issue) => issue.severity === 'release_warning').map((issue) => issue.code),
      authoring_warnings: sampleIssues.filter((issue) => issue.severity === 'authoring_warning').map((issue) => issue.code),
      advisories: sampleIssues.filter((issue) => issue.severity === 'advisory').map((issue) => issue.code),
      blocking_errors: blockingErrors,
    })
  }

  const issueGroupsList = [...issueGroups.values()].sort((a, b) =>
    severityWeight(b.severity) - severityWeight(a.severity) ||
    b.count - a.count ||
    a.id.localeCompare(b.id)
  )
  const topActions = [...actionGroups.values()]
    .map((item) => ({
      ...item,
      issue_families: [...item.issue_families].sort(),
    }))
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.count - a.count || a.id.localeCompare(b.id))
  const stages = [...stageGroups.values()]
    .map((item) => ({
      ...item,
      families: [...item.families].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
  const releaseReady = deterministicBlockerCount === 0 && releaseWarningItemCount === 0 && authoringWarningItemCount === 0
  return {
    schema_version: 1,
    mode: QUALITY_CLOSURE_MODE,
    status: deterministicBlockerCount
      ? 'blocked'
      : releaseReady
        ? advisoryOnlyItemCount ? 'ready_with_advisories' : 'ready'
        : 'not_ready',
    release_ready: releaseReady,
    release_readiness: {
      deterministic_blocker_count: deterministicBlockerCount,
      release_warning_item_count: releaseWarningItemCount,
      authoring_warning_item_count: authoringWarningItemCount,
      advisory_only_item_count: advisoryOnlyItemCount,
      pass_count: summary.validation.pass,
      warning_count: summary.validation.warning,
      fail_count: summary.validation.fail + summary.validation.error,
      manifest_status: manifestValidation.summary.status,
    },
    stages,
    issue_groups: issueGroupsList,
    top_actions: topActions,
    prioritized_samples: prioritizedSamples
      .sort((a, b) => b.risk_score - a.risk_score || a.id.localeCompare(b.id))
      .slice(0, 12),
    claim_boundary: 'A ready closure means reviewed configured material sources are locally acceptable; it still does not prove arbitrary raw terrain images are production-ready.',
  }
}

function buildQualityGate({ status, summary, manifestValidation }) {
  const gates = [
    {
      id: 'manifest_valid',
      status: manifestValidation.summary.status === 'fail' ? 'fail' : manifestValidation.summary.status,
      message: `${manifestValidation.summary.errors} manifest errors, ${manifestValidation.summary.warnings} manifest warnings`,
    },
    {
      id: 'all_samples_processed',
      status: summary.validation.error ? 'fail' : 'pass',
      message: `${summary.validation.error} samples had runtime errors`,
    },
    {
      id: 'no_failed_sources',
      status: summary.validation.fail ? 'fail' : 'pass',
      message: `${summary.validation.fail} samples failed deterministic tileset validation`,
    },
    {
      id: 'manual_source_warnings_reviewed',
      status: summary.validation.warning ? 'warning' : 'pass',
      message: `${summary.validation.warning} samples need manual source review`,
    },
  ]
  return {
    status,
    gates,
    interpretation: {
      pass: 'all reviewed manual material sources passed deterministic extraction and atlas validation',
      warning: 'at least one source produced usable artifacts but needs source or patch review',
      fail: 'one or more sources cannot currently be accepted as 2.5D material sources',
    },
    claim_boundary: 'This gate reviews configured manual material-source regions; it does not prove arbitrary unsegmented source images are production-ready.',
  }
}

function relativePath(fromDir, filePath) {
  return path.relative(fromDir, filePath).split(path.sep).join('/')
}

async function resizePanel(inputPath, { width = 192, height = 192 } = {}) {
  if (!inputPath || !existsSync(inputPath)) {
    return sharp({
      create: { width, height, channels: 4, background: '#11161cff' },
    }).png().toBuffer()
  }
  return sharp(inputPath)
    .resize(width, height, { fit: 'contain', background: '#11161cff', kernel: 'nearest' })
    .png()
    .toBuffer()
}

async function renderComparisonContactSheet({ artifacts, labels = [] } = {}) {
  const panelW = 192
  const panelH = 192
  const labelH = 28
  const gap = 8
  const panels = [
    ['normalized source', artifacts.normalized_material_source_png],
    ['sample overlay', artifacts.material_source_samples_png],
    ['material patches', artifacts.material_patches_png],
    ['strict atlas', artifacts.strict_atlas_png],
    ['rule preview', artifacts.rule_map_preview_png ?? artifacts.random_map_preview_png],
  ]
  const width = panels.length * panelW + (panels.length + 1) * gap
  const height = panelH + labelH + gap * 2
  const base = await sharp({
    create: { width, height, channels: 4, background: '#202426ff' },
  }).png().toBuffer()
  const composites = []
  const textParts = []
  for (let index = 0; index < panels.length; index += 1) {
    const [label, filePath] = panels[index]
    const x = gap + index * (panelW + gap)
    const y = gap + labelH
    composites.push({
      input: await resizePanel(filePath, { width: panelW, height: panelH }),
      left: x,
      top: y,
    })
    textParts.push(`<text x="${x}" y="20" font-family="monospace" font-size="13" fill="#edf2f7">${label}</text>`)
  }
  for (const label of labels) {
    textParts.push(`<text x="${gap}" y="${height - 6}" font-family="monospace" font-size="11" fill="#9aa7b5">${String(label).replace(/[&<>]/g, '')}</text>`)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${textParts.join('')}</svg>`
  return sharp(base).composite([...composites, { input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer()
}

function failedRuntimeItem(sample, error) {
  return {
    id: safePathSegment(sample.id ?? sample.file ?? 'sample'),
    file: sample.file ?? null,
    status: 'error',
    expected_status: sample.expected_status ?? null,
    expectation_met: sample.expected_status ? sample.expected_status === 'error' : null,
    warnings: [],
    blocking_errors: ['material_source_evidence.runtime_error'],
    error: error.message ?? String(error),
    artifacts: {},
    metrics: {},
    notes: sample.notes ?? '',
  }
}

async function analyzeSample({ manifest, baseDir, sample, runDir }) {
  const sampleId = safePathSegment(sample.id)
  const sourcePath = resolveManifestPath(baseDir, sample.file)
  const contract = await readContract({ manifest, baseDir, sample })
  const materialSampleLayout = await readMaterialLayout({ manifest, baseDir, sample })
  const result = await writeTwoPointFiveDTilesetArtifacts({
    contract,
    materialSource: { path: sourcePath, buffer: await readFile(sourcePath) },
    materialSampleLayout,
    outputDir: path.join(runDir, 'items'),
    runId: sampleId,
  })
  const warnings = [...new Set(collectItemWarnings(result))]
  const blockingErrors = [...new Set(collectItemBlockingErrors(result))]
  const status = itemStatus({ result, warnings, blockingErrors })
  const itemDir = result.output_dir
  const contactSheetPath = path.join(itemDir, 'evidence_contact_sheet.png')
  await writeFile(contactSheetPath, await renderComparisonContactSheet({
    artifacts: result.artifacts,
    labels: [`sample: ${sampleId} | status: ${status} | layout: ${result.plan.material_source?.layout_selection?.selected?.id ?? 'n/a'}`],
  }))
  return {
    id: sampleId,
    file: sample.file,
    file_path: sourcePath,
    source_rights: normalizeSourceRights(sample.source_rights),
    status,
    expected_status: sample.expected_status ?? null,
    expectation_met: sample.expected_status ? sample.expected_status === status : null,
    warnings,
    blocking_errors: blockingErrors,
    metrics: {
      patch_count: result.plan.material_source?.extraction?.patch_count ?? null,
      warning_patch_count: result.plan.material_source?.extraction?.warning_patch_count ?? null,
      warning_sample_count: result.plan.material_source?.quality_gates?.warning_sample_count ?? null,
      layout_selected_id: result.plan.material_source?.layout_selection?.selected?.id ?? null,
      layout_selected_score: result.plan.material_source?.layout_selection?.selected?.score ?? null,
      layout_candidate_count: result.plan.material_source?.layout_selection?.candidates?.length ?? null,
      validation_visible_pixel_count: result.validation.metrics?.pixel_validation?.visible_pixel_count ?? null,
      validation_semi_transparent_pixel_count: result.validation.metrics?.pixel_validation?.semi_transparent_pixel_count ?? null,
      rule_map_status: result.tile_map_validation?.status ?? null,
      rule_map_edge_mismatch_count: result.tile_map_validation?.metrics?.edge_mismatch_count ?? null,
      constraint_solver_status: result.constraint_solver_report?.status ?? null,
      constraint_solver_decision_count: result.constraint_solver_report?.decision_count ?? null,
      map_editor_workflow_status: result.map_editor_workflow?.status ?? null,
      map_editor_changed_cell_count: result.map_editor_workflow?.changed_cell_count ?? null,
      ldtk_project_status: result.ldtk_project_validation?.status ?? null,
      ldtk_auto_layer_rule_count: result.ldtk_project_validation?.metrics?.auto_layer_rule_count ?? null,
      ldtk_workflow_validation_status: result.ldtk_workflow_validation?.status ?? null,
      workflow_release_evidence_status: result.workflow_release_evidence?.status ?? null,
      workflow_release_ready: result.workflow_release_evidence?.release_ready ?? null,
      consumer_package_audit_status: result.consumer_package_audit?.status ?? null,
      import_validation_status: result.import_validation?.status ?? null,
      release_demo_pack_status: result.release_demo_manifest?.status ?? null,
      release_demo_ready: result.release_demo_manifest?.release_ready ?? null,
      external_tool_probe_status: result.external_tool_probe?.status ?? null,
      external_import_smoke_status: result.external_import_smoke?.status ?? null,
      external_roundtrip_validation_status: result.external_roundtrip_validation?.status ?? null,
      external_roundtrip_ready: result.external_roundtrip_validation?.ready_for_manual_roundtrip ?? null,
    },
    pipeline_stages: result.plan.pipeline_stages,
    source_normalization: {
      status: result.plan.source_normalization?.status ?? null,
      warnings: result.plan.source_normalization?.warnings ?? [],
    },
    material_source: {
      status: result.plan.material_source?.status ?? null,
      warnings: result.plan.material_source?.warnings ?? [],
      quality_gates: result.plan.material_source?.quality_gates ?? null,
      extraction: result.plan.material_source?.extraction
        ? {
            mode: result.plan.material_source.extraction.mode,
            patch_count: result.plan.material_source.extraction.patch_count,
            palette_limit: result.plan.material_source.extraction.palette_limit ?? null,
            tileability: result.plan.material_source.extraction.tileability ?? null,
            warning_patch_count: result.plan.material_source.extraction.warning_patch_count,
          }
        : null,
      semantic_slot_selection: result.plan.material_source?.semantic_slot_selection ?? null,
      slot_separation: result.plan.material_source?.slot_separation ?? null,
      layout_selection: result.plan.material_source?.layout_selection ?? null,
    },
    validation: {
      status: result.validation.status,
      warnings: result.validation.warnings,
      blocking_errors: result.validation.blocking_errors,
    },
    artifacts: Object.fromEntries(Object.entries({
      output_dir: itemDir,
      normalized_material_source_png: result.artifacts.normalized_material_source_png,
      material_source_samples_png: result.artifacts.material_source_samples_png,
      material_layout_candidates_png: result.artifacts.material_layout_candidates_png,
      material_slot_candidates_png: result.artifacts.material_slot_candidates_png,
      material_patches_png: result.artifacts.material_patches_png,
      strict_atlas_png: result.artifacts.strict_atlas_png,
      random_map_preview_png: result.artifacts.random_map_preview_png,
      rule_map_preview_png: result.artifacts.rule_map_preview_png,
      map_editor_preview_png: result.artifacts.map_editor_preview_png,
      map_editor_workflow_json: result.artifacts.map_editor_workflow,
      constraint_solver_report_json: result.artifacts.constraint_solver_report,
      tile_map_json: result.artifacts.tile_map,
      tile_map_validation_json: result.artifacts.tile_map_validation,
      ldtk_project: result.artifacts.ldtk_project,
      ldtk_auto_layer_rules_json: result.artifacts.ldtk_auto_layer_rules,
      ldtk_project_validation_json: result.artifacts.ldtk_project_validation,
      ldtk_workflow_validation_json: result.artifacts.ldtk_workflow_validation,
      workflow_release_evidence_json: result.artifacts.workflow_release_evidence,
      workflow_release_evidence_md: result.artifacts.workflow_release_evidence_md,
      consumer_package_audit_json: result.artifacts.consumer_package_audit,
      import_validation_json: result.artifacts.import_validation,
      release_demo_manifest_json: result.artifacts.release_demo_manifest,
      release_demo_readme_md: result.artifacts.release_demo_readme,
      release_demo_pack_zip: result.artifacts.release_demo_pack_zip,
      external_tool_probe_json: result.artifacts.external_tool_probe,
      external_import_smoke_json: result.artifacts.external_import_smoke,
      external_roundtrip_validation_json: result.artifacts.external_roundtrip_validation,
      external_roundtrip_checklist_md: result.artifacts.external_roundtrip_checklist_md,
      evidence_contact_sheet_png: contactSheetPath,
      material_source_report: result.artifacts.material_source_report,
      material_source_guidance_json: result.artifacts.material_source_guidance_json,
    }).map(([key, value]) => [key, value ? relativePath(runDir, value) : null])),
    notes: sample.notes ?? '',
  }
}

export function renderMaterialSourceEvidenceMarkdown(report) {
  return [
    `# 2.5D Material Source Evidence Gate ${report.run_id}`,
    '',
    `Status: ${report.quality_gate.status}`,
    `Manifest: ${report.manifest.path}`,
    `Samples: ${report.summary.total}`,
    `Usable rate: ${report.summary.usable_rate}`,
    '',
    '## Gate Checks',
    '',
    '| Gate | Status | Message |',
    '|---|---|---|',
    ...report.quality_gate.gates.map((gate) => `| ${gate.id} | ${gate.status} | ${gate.message} |`),
    '',
    '## Quality Closure',
    '',
    `Closure status: ${report.quality_closure.status}`,
    `Release ready: ${report.quality_closure.release_ready}`,
    '',
    '| Issue | Stage | Family | Severity | Count | Action | Examples |',
    '|---|---|---|---|---:|---|---|',
    ...report.quality_closure.issue_groups.map((item) => `| ${item.id} | ${item.stage} | ${item.family} | ${item.severity} | ${item.count} | ${item.action} | ${item.examples.join(', ')} |`),
    '',
    '## Prioritized Samples',
    '',
    '| Sample | Risk | Layout | Release warnings | Authoring warnings | Advisories |',
    '|---|---:|---|---:|---:|---:|',
    ...report.quality_closure.prioritized_samples.map((item) => `| ${item.id} | ${item.risk_score} | ${item.layout_selected_id ?? 'n/a'} | ${item.release_warnings.length} | ${item.authoring_warnings.length} | ${item.advisories.length} |`),
    '',
    '## Items',
    '',
    '| Sample | Status | Layout | Patches | Patch warnings | Sample warnings | Contact sheet | Blocking errors |',
    '|---|---|---|---:|---:|---:|---|---|',
    ...report.items.map((item) => `| ${item.id} | ${item.status} | ${item.metrics?.layout_selected_id ?? 'n/a'} | ${item.metrics?.patch_count ?? 'n/a'} | ${item.metrics?.warning_patch_count ?? 'n/a'} | ${item.metrics?.warning_sample_count ?? 'n/a'} | ${item.artifacts?.evidence_contact_sheet_png ? `[contact](${item.artifacts.evidence_contact_sheet_png})` : ''} | ${(item.blocking_errors ?? []).join(', ')} |`),
    '',
    '## Top Issues',
    '',
    '| Issue | Count | Examples |',
    '|---|---:|---|',
    ...report.summary.failure_taxonomy.top_categories.map((item) => `| ${item.id} | ${item.count} | ${item.examples.join(', ')} |`),
    '',
  ].join('\n')
}

export async function runMaterialSourceEvidenceGate({
  manifestPath,
  outputDir = DEFAULT_OUTPUT_DIR,
  runId = runIdFromDate(),
  sampleIds = [],
} = {}) {
  if (!manifestPath) throw new Error('tileset material-source-evidence requires --manifest')
  const resolvedManifest = path.resolve(manifestPath)
  const baseDir = path.dirname(resolvedManifest)
  const manifest = JSON.parse(await readFile(resolvedManifest, 'utf8'))
  const manifestValidation = await validateMaterialSourceEvidenceManifest({ manifestPath: resolvedManifest })
  const samples = selectSamples(manifest, sampleIds)
  const runDir = path.join(outputDir, runId)
  await mkdir(runDir, { recursive: true })

  const items = []
  for (const sample of samples) {
    const validationItem = manifestValidation.items.find((item) => item.id === normalizeId(sample.id))
    if (validationItem?.status === 'fail') {
      items.push({
        ...validationItem,
        status: 'fail',
        warnings: validationItem.issues.filter((item) => item.severity === 'warning').map((item) => item.code),
        blocking_errors: validationItem.issues.filter((item) => item.severity === 'error').map((item) => item.code),
        artifacts: {},
        metrics: {},
        notes: sample.notes ?? '',
      })
      continue
    }
    try {
      items.push(await analyzeSample({ manifest, baseDir, sample, runDir }))
    } catch (error) {
      items.push(failedRuntimeItem(sample, error))
    }
  }
  const status = overallStatus(items, manifestValidation)
  const summary = summaryForItems(items, manifestValidation)
  const qualityClosure = buildMaterialSourceQualityClosure({ items, summary, manifestValidation })
  const qualityGate = buildQualityGate({ status, summary, manifestValidation })
  const report = {
    schema_version: 1,
    mode: MODE,
    run_id: runId,
    created_at: new Date().toISOString(),
    output_dir: runDir,
    manifest: {
      path: resolvedManifest,
      fixture_set: manifest.fixture_set ?? null,
      schema_version: manifest.schema_version ?? null,
    },
    filters: {
      sample_ids: sampleIds,
    },
    manifest_validation: manifestValidation,
    summary,
    quality_closure: qualityClosure,
    quality_gate: qualityGate,
    items,
  }
  report.markdown = renderMaterialSourceEvidenceMarkdown(report)
  await writeFile(path.join(runDir, 'material_source_evidence_gate.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(runDir, 'material_source_evidence_gate.md'), report.markdown)
  return report
}
