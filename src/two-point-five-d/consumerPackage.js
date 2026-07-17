import path from 'node:path'

import JSZip from 'jszip'

export const TWO_POINT_FIVE_D_CONSUMER_PACKAGE_AUDIT_MODE = 'two_point_five_d_consumer_package_audit_v1'
export const TWO_POINT_FIVE_D_IMPORT_VALIDATION_MODE = 'two_point_five_d_practical_import_validation_v1'
export const TWO_POINT_FIVE_D_RELEASE_DEMO_PACK_MODE = 'two_point_five_d_release_demo_pack_v1'

const LOCAL_PATH_PATTERN = /(?:\/Users\/|\/home\/|\/var\/folders\/|file:\/\/|[A-Za-z]:[\\/])/u

function entryContentPresent(entry) {
  return entry?.content !== undefined && entry.content !== null
}

function isAbsoluteLike(value) {
  const text = String(value ?? '')
  return path.posix.isAbsolute(text) || /^file:\/\//iu.test(text) || /^[A-Za-z]:[\\/]/u.test(text)
}

function normalizePackagePath(packagePath) {
  return String(packagePath ?? '').split(path.sep).join('/')
}

function packagePathIssue(packagePath) {
  const normalized = normalizePackagePath(packagePath)
  if (!normalized) return 'package_path_empty'
  if (normalized.includes('\\')) return 'package_path_uses_backslash'
  if (isAbsoluteLike(normalized)) return 'package_path_absolute'
  if (normalized.split('/').includes('..')) return 'package_path_traversal'
  return null
}

function textContent(entry) {
  if (!entryContentPresent(entry) || Buffer.isBuffer(entry.content)) return null
  if (typeof entry.content === 'string') return entry.content
  return JSON.stringify(entry.content, null, 2)
}

function textWithoutDataUrls(text) {
  return String(text ?? '').replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu, 'data:image/<base64>')
}

function serializeContent(content) {
  if (Buffer.isBuffer(content)) return content
  if (typeof content === 'string') return content
  return JSON.stringify(content, null, 2)
}

function parseJsonContent(entry) {
  if (!entryContentPresent(entry)) return null
  if (typeof entry.content === 'string') return JSON.parse(entry.content)
  if (Buffer.isBuffer(entry.content)) return JSON.parse(entry.content.toString('utf8'))
  return entry.content
}

function pngSignatureValid(content) {
  return Buffer.isBuffer(content)
    && content.length >= 8
    && content[0] === 0x89
    && content[1] === 0x50
    && content[2] === 0x4e
    && content[3] === 0x47
}

function packageRefTarget(sourcePackagePath, ref) {
  if (!ref || isAbsoluteLike(ref)) return null
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePackagePath), ref))
}

function addRefCheck({ checks, blockingErrors, entriesByPath, source, ref, code }) {
  const target = packageRefTarget(source, ref)
  const pass = Boolean(target && entriesByPath.has(target))
  checks.push({ code, source, ref, target, status: pass ? 'pass' : 'fail' })
  if (!pass) blockingErrors.push(code)
}

export function buildTwoPointFiveDConsumerPackageAudit({
  entries = [],
  requiredKeys = [],
  tiledJson = null,
  tiledTsx = '',
  ldtkProject = null,
  metadata = null,
} = {}) {
  const blockingErrors = []
  const warnings = []
  const packagePaths = new Set()
  const entriesByPath = new Map()
  const entrySummaries = []

  for (const entry of entries) {
    const normalizedPath = normalizePackagePath(entry.packagePath)
    const issue = packagePathIssue(normalizedPath)
    if (issue) blockingErrors.push(`${issue}:${entry.key ?? normalizedPath}`)
    if (packagePaths.has(normalizedPath)) blockingErrors.push(`duplicate_package_path:${normalizedPath}`)
    packagePaths.add(normalizedPath)
    entriesByPath.set(normalizedPath, entry)
    if (entry.required && !entryContentPresent(entry)) blockingErrors.push(`missing_required_entry:${entry.key}`)
    if (entry.type === 'png' && entryContentPresent(entry) && !pngSignatureValid(entry.content)) {
      blockingErrors.push(`invalid_png_signature:${entry.key}`)
    }
    if (entry.type === 'json' && entryContentPresent(entry)) {
      try {
        parseJsonContent(entry)
      } catch {
        blockingErrors.push(`invalid_json_entry:${entry.key}`)
      }
    }
    const text = textContent(entry)
    if (text && LOCAL_PATH_PATTERN.test(textWithoutDataUrls(text))) blockingErrors.push(`local_path_leak:${entry.key}`)
    entrySummaries.push({
      key: entry.key,
      package_path: normalizedPath,
      type: entry.type,
      required: Boolean(entry.required),
      present: entryContentPresent(entry),
    })
  }

  for (const key of requiredKeys) {
    if (!entries.some((entry) => entry.key === key && entryContentPresent(entry))) {
      blockingErrors.push(`missing_required_key:${key}`)
    }
  }

  const referenceChecks = []
  const tiledJsonEntry = entries.find((entry) => entry.key === 'tiled_json')
  const tiledTsxEntry = entries.find((entry) => entry.key === 'tiled_tsx')
  const ldtkEntry = entries.find((entry) => entry.key === 'ldtk_project')
  const tiledImage = tiledJson?.image
  if (tiledJsonEntry && tiledImage) {
    addRefCheck({
      checks: referenceChecks,
      blockingErrors,
      entriesByPath,
      source: normalizePackagePath(tiledJsonEntry.packagePath),
      ref: tiledImage,
      code: 'tiled_json_image_reference_missing',
    })
  }
  const tsxImage = String(tiledTsx ?? '').match(/<image\s+source="([^"]+)"/u)?.[1] ?? null
  if (tiledTsxEntry && tsxImage) {
    addRefCheck({
      checks: referenceChecks,
      blockingErrors,
      entriesByPath,
      source: normalizePackagePath(tiledTsxEntry.packagePath),
      ref: tsxImage,
      code: 'tiled_tsx_image_reference_missing',
    })
  }
  const ldtkTilesetRelPath = ldtkProject?.defs?.tilesets?.[0]?.relPath ?? null
  if (ldtkEntry && ldtkTilesetRelPath) {
    addRefCheck({
      checks: referenceChecks,
      blockingErrors,
      entriesByPath,
      source: normalizePackagePath(ldtkEntry.packagePath),
      ref: ldtkTilesetRelPath,
      code: 'ldtk_tileset_rel_path_missing',
    })
  }
  const ldtkLayerRelPaths = (ldtkProject?.levels ?? [])
    .flatMap((level) => level.layerInstances ?? [])
    .map((layer) => layer.__tilesetRelPath)
    .filter(Boolean)
  for (const ref of ldtkLayerRelPaths) {
    addRefCheck({
      checks: referenceChecks,
      blockingErrors,
      entriesByPath,
      source: normalizePackagePath(ldtkEntry?.packagePath ?? 'project.ldtk'),
      ref,
      code: 'ldtk_layer_tileset_rel_path_missing',
    })
  }
  if (tiledImage && tsxImage && tiledImage !== tsxImage) blockingErrors.push('tiled_image_reference_mismatch')
  if (tiledImage && ldtkTilesetRelPath && tiledImage !== ldtkTilesetRelPath) blockingErrors.push('editor_image_reference_mismatch')

  if (metadata?.projection?.logical_tile_size && metadata?.projection?.sprite_cell_size) {
    const [logicalW, logicalH] = metadata.projection.logical_tile_size
    const [spriteW, spriteH] = metadata.projection.sprite_cell_size
    if (spriteW < logicalW || spriteH < logicalH) blockingErrors.push('metadata_sprite_cell_smaller_than_logical_tile')
  }

  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_CONSUMER_PACKAGE_AUDIT_MODE,
    status: blockingErrors.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    blocking_errors: [...new Set(blockingErrors)],
    warnings,
    metrics: {
      package_entry_count: entries.length,
      required_entry_count: requiredKeys.length,
      reference_check_count: referenceChecks.length,
      text_entry_count: entries.filter((entry) => textContent(entry)).length,
      png_entry_count: entries.filter((entry) => entry.type === 'png').length,
    },
    entries: entrySummaries,
    reference_checks: referenceChecks,
    claim_boundary: 'Portable package audit for generated 2.5D artifact references, required payloads, and local-path leaks; it does not launch external editors.',
  }
}

export function buildTwoPointFiveDPracticalImportValidation({
  plan,
  tiledJson,
  tiledTsx,
  ldtkProject,
  ldtkProjectValidation,
  ldtkWorkflowValidation,
  packageAudit,
  externalEditorProbe = null,
} = {}) {
  const blockingErrors = []
  const warnings = []
  const [cellW, cellH] = plan?.atlas?.tile_cell_size ?? [null, null]
  const tiledImage = tiledJson?.image ?? null
  const tsxImage = String(tiledTsx ?? '').match(/<image\s+source="([^"]+)"/u)?.[1] ?? null
  const tsxTileCount = Number(String(tiledTsx ?? '').match(/tilecount="(\d+)"/u)?.[1] ?? NaN)
  const tsxColumns = Number(String(tiledTsx ?? '').match(/columns="(\d+)"/u)?.[1] ?? NaN)
  const ldtkTileset = ldtkProject?.defs?.tilesets?.[0] ?? null
  const terrainMaskLayer = ldtkProject?.defs?.layers?.find((layer) => layer.identifier === 'TerrainMasks')
  const tilesLayer = ldtkProject?.defs?.layers?.find((layer) => layer.identifier === 'Tiles')

  if (packageAudit?.status !== 'pass') blockingErrors.push('consumer_package_audit_not_pass')
  if (tiledJson?.type !== 'tileset') blockingErrors.push('tiled_json_type_invalid')
  if (tiledJson?.tilewidth !== cellW || tiledJson?.tileheight !== cellH) blockingErrors.push('tiled_json_tile_size_mismatch')
  if (tiledJson?.tilecount !== plan?.atlas?.available_cell_count) blockingErrors.push('tiled_json_tilecount_mismatch')
  if (tiledJson?.columns !== plan?.atlas?.grid?.columns) blockingErrors.push('tiled_json_columns_mismatch')
  if (!tiledImage || isAbsoluteLike(tiledImage)) blockingErrors.push('tiled_json_image_reference_invalid')
  if (!tsxImage || isAbsoluteLike(tsxImage)) blockingErrors.push('tiled_tsx_image_reference_invalid')
  if (tiledImage && tsxImage && tiledImage !== tsxImage) blockingErrors.push('tiled_json_tsx_image_mismatch')
  if (tsxTileCount !== plan?.atlas?.available_cell_count) blockingErrors.push('tiled_tsx_tilecount_mismatch')
  if (tsxColumns !== plan?.atlas?.grid?.columns) blockingErrors.push('tiled_tsx_columns_mismatch')
  if (!tiledJson?.tiles?.some((tile) => tile.properties?.some((property) => property.name === 'runtime_inner_rect_x'))) {
    blockingErrors.push('tiled_runtime_inner_rect_metadata_missing')
  }
  if (!tiledJson?.tiles?.some((tile) => tile.properties?.some((property) => property.name === 'collision_w'))) {
    blockingErrors.push('tiled_collision_metadata_missing')
  }

  if (ldtkProjectValidation?.status !== 'pass') blockingErrors.push('ldtk_project_validation_not_pass')
  if (ldtkWorkflowValidation?.status !== 'pass') blockingErrors.push('ldtk_workflow_validation_not_pass')
  if (ldtkProject?.externalLevels !== false) blockingErrors.push('ldtk_external_levels_must_be_false')
  if (!ldtkTileset || ldtkTileset.relPath !== tiledImage) blockingErrors.push('ldtk_tileset_rel_path_mismatch')
  if (!tilesLayer || tilesLayer.tilesetDefUid !== ldtkTileset?.uid) blockingErrors.push('ldtk_tiles_layer_tileset_uid_mismatch')
  if (!terrainMaskLayer?.autoRuleGroups?.length) blockingErrors.push('ldtk_terrain_mask_auto_rules_missing')
  if (!terrainMaskLayer?.intGridValues?.length) blockingErrors.push('ldtk_terrain_mask_values_missing')

  const external = externalEditorProbe ?? {
    status: 'not_run',
    tools: [],
    reason: 'external editor launch and round-trip validation are optional and were not requested for this deterministic build.',
  }
  if (external.status === 'warning') warnings.push(...(external.warnings ?? ['external_editor_probe_warning']))
  if (external.status === 'fail') blockingErrors.push(...(external.blocking_errors ?? ['external_editor_probe_failed']))

  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_IMPORT_VALIDATION_MODE,
    status: blockingErrors.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    blocking_errors: [...new Set(blockingErrors)],
    warnings,
    static_checks: {
      tiled: {
        status: blockingErrors.some((code) => code.startsWith('tiled_')) ? 'fail' : 'pass',
        image_reference: tiledImage,
        tile_size: { width: tiledJson?.tilewidth ?? null, height: tiledJson?.tileheight ?? null },
        tile_count: tiledJson?.tilecount ?? null,
        columns: tiledJson?.columns ?? null,
      },
      ldtk: {
        status: blockingErrors.some((code) => code.startsWith('ldtk_')) ? 'fail' : 'pass',
        project_validation_status: ldtkProjectValidation?.status ?? 'not_run',
        workflow_validation_status: ldtkWorkflowValidation?.status ?? 'not_run',
        tileset_rel_path: ldtkTileset?.relPath ?? null,
        terrain_mask_value_count: terrainMaskLayer?.intGridValues?.length ?? 0,
        auto_rule_group_count: terrainMaskLayer?.autoRuleGroups?.length ?? 0,
      },
      package: {
        status: packageAudit?.status ?? 'not_run',
        entry_count: packageAudit?.metrics?.package_entry_count ?? 0,
        reference_check_count: packageAudit?.metrics?.reference_check_count ?? 0,
      },
    },
    external_editor_probe: external,
    claim_boundary: 'Static practical import validation for Tiled and LDtk payloads plus package portability; no external editor round-trip is claimed unless external_editor_probe reports one.',
  }
}

export function buildTwoPointFiveDReleaseDemoManifest({
  runId,
  plan,
  packageAudit,
  importValidation,
  workflowReleaseEvidence,
  entries,
} = {}) {
  const requiredArtifacts = entries.filter((entry) => entry.required).map((entry) => ({
    key: entry.key,
    package_path: normalizePackagePath(entry.packagePath),
    type: entry.type,
  }))
  const blocking = [
    packageAudit?.status === 'fail' ? 'consumer_package_audit_failed' : null,
    importValidation?.status === 'fail' ? 'import_validation_failed' : null,
    workflowReleaseEvidence?.release_ready === false ? 'workflow_release_evidence_not_ready' : null,
  ].filter(Boolean)
  const warnings = [
    packageAudit?.status === 'warning' ? 'consumer_package_audit_warning' : null,
    importValidation?.status === 'warning' ? 'import_validation_warning' : null,
    workflowReleaseEvidence?.status === 'warning' ? 'workflow_release_evidence_warning' : null,
  ].filter(Boolean)
  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_RELEASE_DEMO_PACK_MODE,
    status: blocking.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    release_ready: blocking.length === 0,
    run_id: runId,
    contract_id: plan?.contract_id ?? null,
    contract_version: plan?.contract_version ?? null,
    projection: plan?.projection ?? null,
    primary_files: {
      strict_atlas: 'strict_atlas.png',
      runtime_padded_atlas: 'runtime_padded_atlas.png',
      ldtk_project: 'project.ldtk',
      tiled_json: 'tileset.tiled.json',
      tiled_tsx: 'tileset.tsx',
      map_preview: 'previews/map_editor_preview.png',
    },
    checks: {
      consumer_package_audit_status: packageAudit?.status ?? 'not_run',
      import_validation_status: importValidation?.status ?? 'not_run',
      workflow_release_evidence_status: workflowReleaseEvidence?.status ?? 'not_run',
      workflow_release_ready: workflowReleaseEvidence?.release_ready ?? false,
    },
    required_artifacts: requiredArtifacts,
    blocking_errors: blocking,
    warnings,
    claim_boundary: 'Self-contained 2.5D release demo package for local consumer workflow validation; external editor launch, round-trip editing, hosted generation, and full WFC productization remain outside this package.',
  }
}

export function renderTwoPointFiveDReleaseDemoReadme({ manifest, packageAudit, importValidation, workflowReleaseEvidence } = {}) {
  const requiredList = (manifest?.required_artifacts ?? [])
    .map((entry) => `- ${entry.package_path} (${entry.key})`)
    .join('\n')
  return [
    '# 2.5D Tileset Release Demo Pack',
    '',
    `Status: ${manifest?.status ?? 'unknown'}`,
    `Release ready: ${manifest?.release_ready ? 'yes' : 'no'}`,
    `Contract: ${manifest?.contract_id ?? '-'}`,
    '',
    '## Primary Files',
    '',
    '- `strict_atlas.png`: strict 1024 x 1024 atlas referenced by editor files.',
    '- `runtime_padded_atlas.png`: runtime atlas with copied edge padding.',
    '- `project.ldtk`: single-level LDtk project with TerrainMasks and tile layers.',
    '- `tileset.tiled.json` and `tileset.tsx`: Tiled tileset exports with 2.5D metadata.',
    '- `previews/map_editor_preview.png`: validated preview rendered from the rule-safe map workflow.',
    '',
    '## Validation Evidence',
    '',
    `- Consumer package audit: ${packageAudit?.status ?? 'not_run'}`,
    `- Practical import validation: ${importValidation?.status ?? 'not_run'}`,
    `- Workflow release evidence: ${workflowReleaseEvidence?.status ?? 'not_run'}; release ready: ${workflowReleaseEvidence?.release_ready ? 'yes' : 'no'}`,
    '',
    '## Included Required Artifacts',
    '',
    requiredList || '- none',
    '',
    '## Boundary',
    '',
    manifest?.claim_boundary ?? '-',
    '',
  ].join('\n')
}

export async function buildTwoPointFiveDReleaseDemoZip(entries = []) {
  const zip = new JSZip()
  for (const entry of entries) {
    if (!entryContentPresent(entry)) continue
    zip.file(normalizePackagePath(entry.packagePath), serializeContent(entry.content))
  }
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
