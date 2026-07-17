import { existsSync } from 'node:fs'
import path from 'node:path'

import { getActiveAssetRevision } from './assets.js'
import { EDITOR_PROJECT_VERSION } from './constants.js'
import {
  buildEngineConsumerValidation,
  buildEngineExportReviewStatus,
  buildEngineManualImportChecklist,
  buildEngineManualImportEvidence,
} from './engineConsumerEvidence.js'
import {
  buildEngineHandoffManifest,
  buildGodotSceneHandoff,
  buildLdtkSceneHandoff,
  validateEngineHandoffManifest,
} from './engineHandoff.js'
import { projectRelativePath } from './paths.js'
import { clonePlain, isSafeRelativePath } from './safety.js'
import { validateEditorProject, validateSceneDocument } from './validation.js'

export const EDITOR_PROJECT_PACK_VERSION = 'editor_project_pack_v1'
export const EDITOR_PROJECT_PACK_VALIDATION_VERSION = 'editor_project_pack_validation_v1'

const PACK_FILES = Object.freeze({
  manifest: 'editor_project_pack_manifest.json',
  project: 'project.json',
  validation: 'editor_project_validation.json',
  assetReferences: 'asset_references.json',
  sceneIndex: 'scenes/index.json',
  enginePayloads: 'engine_payloads.json',
  engineHandoffManifest: 'engine_handoff_manifest.json',
  godotSceneHandoff: 'engines/godot/scene_handoff.json',
  ldtkSceneHandoff: 'engines/ldtk/scene_handoff.json',
  engineConsumerValidation: 'consumer_evidence/engine_consumer_validation.json',
  manualImportEvidence: 'consumer_evidence/manual_import_evidence.json',
  manualImportChecklist: 'consumer_evidence/manual_import_checklist.md',
  zip: 'editor_project_pack.zip',
})

const ENGINE_ARTIFACTS = Object.freeze([
  {
    kind: 'character_pack',
    artifact_key: 'godot_npc_zip',
    engine: 'godot',
    payload_type: 'character_import_zip',
    pack_path: (assetId, revisionId) => `engines/godot/${assetId}_${revisionId}.zip`,
  },
  {
    kind: 'character_pack',
    artifact_key: 'rpgmaker_zip',
    engine: 'rpgmaker',
    payload_type: 'character_import_zip',
    pack_path: (assetId, revisionId) => `engines/rpgmaker/${assetId}_${revisionId}.zip`,
  },
  {
    kind: 'character_pack',
    artifact_key: 'ocad_zip',
    engine: 'ocad',
    payload_type: 'character_import_zip',
    pack_path: (assetId, revisionId) => `engines/ocad/${assetId}_${revisionId}.zip`,
  },
  {
    kind: 'scene_pack',
    artifact_key: 'ldtk_project',
    engine: 'ldtk',
    payload_type: 'scene_project',
    pack_path: (assetId, revisionId) => `engines/ldtk/${assetId}_${revisionId}.ldtk`,
  },
])

function timestamp(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function sceneFile(sceneId) {
  return `scenes/${sceneId}.json`
}

function artifactFileName(value, fallback) {
  const normalized = String(value ?? '').replaceAll('\\', '/')
  const name = normalized.split('/').filter(Boolean).pop()
  return name || fallback
}

function artifactPackPath({ projectId, assetId, revisionId, artifactKey, sourcePath }) {
  const normalized = String(sourcePath ?? '').replaceAll('\\', '/')
  const prefix = `workspace/projects/${projectId}/assets/${assetId}/${revisionId}/`
  const tail = normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : artifactFileName(normalized, `${artifactKey}.bin`)
  return `assets/${assetId}/${revisionId}/${tail}`
}

function sourceFileStatus(sourcePath, { projectRoot, workspaceRoot, projectId, assetId, revisionId }) {
  const normalized = String(sourcePath ?? '').replaceAll('\\', '/')
  if (!isSafeRelativePath(sourcePath)) {
    return { exists: false, safe: false, absolute_path: null }
  }
  const managedPrefix = `workspace/projects/${projectId}/assets/${assetId}/${revisionId}/`
  if (!normalized.startsWith(managedPrefix)) {
    return { exists: false, safe: false, absolute_path: null }
  }
  if (!projectRoot) return { exists: null, safe: true, absolute_path: null }
  const absolute = path.resolve(projectRoot, normalized)
  const relative = path.relative(path.resolve(projectRoot), absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { exists: false, safe: false, absolute_path: null }
  }
  const workspace = path.resolve(workspaceRoot ?? path.join(projectRoot, 'workspace'))
  const workspaceRelative = path.relative(workspace, absolute)
  if (workspaceRelative.startsWith('..') || path.isAbsolute(workspaceRelative)) {
    return { exists: false, safe: false, absolute_path: null }
  }
  return {
    exists: existsSync(absolute),
    safe: true,
    absolute_path: absolute,
  }
}

function summarizeArtifact({
  projectId,
  assetId,
  revisionId,
  artifactKey,
  sourcePath,
  projectRoot,
  workspaceRoot,
  packPath,
}) {
  const fileStatus = sourceFileStatus(sourcePath, { projectRoot, workspaceRoot, projectId, assetId, revisionId })
  return {
    key: artifactKey,
    source_path: sourcePath,
    pack_path: packPath ?? artifactPackPath({ projectId, assetId, revisionId, artifactKey, sourcePath }),
    included: fileStatus.safe && fileStatus.exists !== false,
    exists: fileStatus.exists,
    safe: fileStatus.safe,
  }
}

function buildAssetReferences(project, { projectRoot, workspaceRoot } = {}) {
  const assets = {}
  const missing = []
  const unsafe = []
  const blocked = []
  for (const [assetId, asset] of Object.entries(project.assets ?? {})) {
    const revision = getActiveAssetRevision(asset)
    const artifacts = {}
    for (const [artifactKey, sourcePath] of Object.entries(revision?.artifacts ?? {})) {
      const artifact = summarizeArtifact({
        projectId: project.id,
        assetId,
        revisionId: revision.id,
        artifactKey,
        sourcePath,
        projectRoot,
        workspaceRoot,
      })
      artifacts[artifactKey] = artifact
      if (!artifact.safe) unsafe.push(`${assetId}:${revision.id}:${artifactKey}`)
      if (artifact.exists === false) missing.push(`${assetId}:${revision.id}:${artifactKey}`)
    }
    if (revision?.production_status === 'blocked') blocked.push(assetId)
    assets[assetId] = {
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      profile: asset.profile ?? null,
      active_revision_id: asset.active_revision_id,
      revision_ids: Object.keys(asset.revisions ?? {}),
      active_revision: revision
        ? {
            id: revision.id,
            source_job_id: revision.source_job_id,
            parent_revision_id: revision.parent_revision_id,
            created_at: revision.created_at,
            quality_status: revision.quality_status,
            production_status: revision.production_status,
            processing_recipe_ref: revision.processing_recipe_ref,
            artifacts,
          }
        : null,
      provenance: clonePlain(asset.provenance ?? {}),
      clip_count: Object.keys(asset.clips ?? {}).length,
      tags: [...(asset.tags ?? [])],
    }
  }
  return {
    document: {
      mode: 'editor_asset_references_v1',
      project_id: project.id,
      assets,
    },
    diagnostics: {
      missing_artifacts: missing,
      unsafe_artifacts: unsafe,
      blocked_assets: blocked,
      artifact_count: Object.values(assets).reduce((sum, asset) => sum + Object.keys(asset.active_revision?.artifacts ?? {}).length, 0),
    },
  }
}

function buildSceneDocuments(project) {
  const scenes = {}
  const index = []
  for (const [sceneId, scene] of Object.entries(project.scenes ?? {})) {
    const validation = validateSceneDocument(scene, {
      assets: project.assets,
      scenes: project.scenes,
    })
    scenes[sceneId] = clonePlain(scene)
    index.push({
      id: sceneId,
      name: scene.name,
      file: sceneFile(sceneId),
      validation_status: validation.status,
      blocking_errors: validation.blocking_errors,
      warnings: validation.warnings,
      layer_count: scene.layers?.length ?? 0,
      entity_count: scene.entities?.length ?? 0,
    })
  }
  return {
    index: {
      mode: 'editor_scene_documents_v1',
      project_id: project.id,
      scenes: index,
    },
    scenes,
  }
}

function buildEnginePayloads(project, assetReferences) {
  const payloads = []
  const unsupported_assets = []
  for (const asset of Object.values(assetReferences.assets ?? {})) {
    const engineSpecs = ENGINE_ARTIFACTS.filter((spec) => spec.kind === asset.kind)
    const revision = asset.active_revision
    let supportedForAsset = 0
    for (const spec of engineSpecs) {
      const sourceArtifact = revision?.artifacts?.[spec.artifact_key]
      if (!sourceArtifact) continue
      supportedForAsset += 1
      const packPath = spec.pack_path(asset.id, revision.id)
      payloads.push({
        engine: spec.engine,
        payload_type: spec.payload_type,
        asset_id: asset.id,
        asset_kind: asset.kind,
        revision_id: revision.id,
        artifact_key: spec.artifact_key,
        source_path: sourceArtifact.source_path,
        pack_path: packPath,
        included: sourceArtifact.included,
      })
    }
    if (engineSpecs.length && !supportedForAsset) {
      unsupported_assets.push({
        asset_id: asset.id,
        asset_kind: asset.kind,
        reason: 'no_supported_engine_artifacts_registered',
      })
    }
  }
  return {
    mode: 'editor_engine_payloads_v1',
    project_id: project.id,
    policy: 'reference_existing_supported_payloads_only',
    supported_engines: [...new Set(payloads.map((payload) => payload.engine))].sort(),
    payloads,
    unsupported_assets,
  }
}

function buildValidationReport(project, {
  projectValidation,
  assetDiagnostics,
  enginePayloads,
  engineHandoffValidation,
  engineConsumerValidation,
  createdAt,
} = {}) {
  const blocking = [...(projectValidation.blocking_errors ?? [])]
  const warnings = [...(projectValidation.warnings ?? [])]
  if (assetDiagnostics.unsafe_artifacts.length) blocking.push('unsafe_asset_artifact_path')
  if (assetDiagnostics.missing_artifacts.length) blocking.push('asset_artifact_file_missing')
  if (assetDiagnostics.blocked_assets.length) warnings.push('blocked_asset_in_pack')
  if (!enginePayloads.payloads.length) warnings.push('no_engine_payloads_available')
  for (const error of engineHandoffValidation?.blocking_errors ?? []) blocking.push(error)
  for (const warning of engineHandoffValidation?.warnings ?? []) warnings.push(warning)
  for (const error of engineConsumerValidation?.blocking_errors ?? []) blocking.push(error)
  for (const warning of engineConsumerValidation?.warnings ?? []) warnings.push(warning)
  return {
    version: EDITOR_PROJECT_PACK_VALIDATION_VERSION,
    project_id: project.id,
    project_revision: project.revision,
    created_at: createdAt,
    status: blocking.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    blocking_errors: [...new Set(blocking)],
    warnings: [...new Set(warnings)],
    project: projectValidation,
    diagnostics: {
      missing_artifacts: assetDiagnostics.missing_artifacts,
      unsafe_artifacts: assetDiagnostics.unsafe_artifacts,
      blocked_assets: assetDiagnostics.blocked_assets,
      unsupported_engine_assets: enginePayloads.unsupported_assets,
      unsupported_engine_handoff_items: engineHandoffValidation?.metrics?.unsupported_item_count ?? 0,
      engine_consumer_validation_status: engineConsumerValidation?.status ?? 'unknown',
    },
    metrics: {
      asset_count: Object.keys(project.assets ?? {}).length,
      scene_count: Object.keys(project.scenes ?? {}).length,
      active_artifact_count: assetDiagnostics.artifact_count,
      engine_payload_count: enginePayloads.payloads.length,
      engine_handoff_unsupported_item_count: engineHandoffValidation?.metrics?.unsupported_item_count ?? 0,
      engine_consumer_validation_warning_count: engineConsumerValidation?.warnings?.length ?? 0,
    },
  }
}

export function buildEditorProjectPack(project, {
  projectRoot = null,
  workspaceRoot = null,
  createdAt = new Date(),
} = {}) {
  const created = timestamp(createdAt)
  const projectValidation = validateEditorProject(project)
  const assetReferences = buildAssetReferences(project, { projectRoot, workspaceRoot })
  const sceneDocuments = buildSceneDocuments(project)
  const enginePayloads = buildEnginePayloads(project, assetReferences.document)
  const engineHandoffManifest = buildEngineHandoffManifest(project, { createdAt: created })
  const engineHandoffValidation = validateEngineHandoffManifest(engineHandoffManifest)
  const godotSceneHandoff = buildGodotSceneHandoff(engineHandoffManifest)
  const ldtkSceneHandoff = buildLdtkSceneHandoff(engineHandoffManifest)
  const engineConsumerValidation = buildEngineConsumerValidation({
    manifest: engineHandoffManifest,
    godotSceneHandoff,
    ldtkSceneHandoff,
    enginePayloads,
    createdAt: created,
  })
  const validationReport = buildValidationReport(project, {
    projectValidation,
    assetDiagnostics: assetReferences.diagnostics,
    enginePayloads,
    engineHandoffValidation,
    engineConsumerValidation,
    createdAt: created,
  })
  const reviewStatus = buildEngineExportReviewStatus({
    validationStatus: validationReport.status,
    consumerValidation: engineConsumerValidation,
    unsupportedItemCount: engineHandoffValidation.metrics.unsupported_item_count,
  })
  const manualImportEvidence = buildEngineManualImportEvidence({
    manifest: engineHandoffManifest,
    godotSceneHandoff,
    ldtkSceneHandoff,
    enginePayloads,
    consumerValidation: engineConsumerValidation,
    reviewStatus,
    files: PACK_FILES,
    createdAt: created,
  })
  const manualImportChecklist = buildEngineManualImportChecklist(manualImportEvidence)
  const manifest = {
    version: EDITOR_PROJECT_PACK_VERSION,
    source_project_version: project.version ?? EDITOR_PROJECT_VERSION,
    project_id: project.id,
    project_name: project.name,
    project_revision: project.revision,
    created_at: created,
    status: validationReport.status,
    files: {
      manifest: PACK_FILES.manifest,
      project: PACK_FILES.project,
      validation: PACK_FILES.validation,
      asset_references: PACK_FILES.assetReferences,
      scene_index: PACK_FILES.sceneIndex,
      engine_payloads: PACK_FILES.enginePayloads,
      engine_handoff_manifest: PACK_FILES.engineHandoffManifest,
      godot_scene_handoff: PACK_FILES.godotSceneHandoff,
      ldtk_scene_handoff: PACK_FILES.ldtkSceneHandoff,
      engine_consumer_validation: PACK_FILES.engineConsumerValidation,
      manual_import_evidence: PACK_FILES.manualImportEvidence,
      manual_import_checklist: PACK_FILES.manualImportChecklist,
      zip: PACK_FILES.zip,
    },
    review_status: reviewStatus,
    counts: {
      assets: Object.keys(project.assets ?? {}).length,
      scenes: Object.keys(project.scenes ?? {}).length,
      active_artifacts: assetReferences.diagnostics.artifact_count,
      engine_payloads: enginePayloads.payloads.length,
      engine_handoff_unsupported_items: engineHandoffValidation.metrics.unsupported_item_count,
      engine_consumer_validation_warnings: engineConsumerValidation.warnings.length,
    },
  }
  return {
    version: EDITOR_PROJECT_PACK_VERSION,
    status: validationReport.status,
    manifest,
    projectJson: clonePlain(project),
    validationReport,
    assetReferences: assetReferences.document,
    sceneDocuments,
    enginePayloads,
    engineHandoffManifest,
    godotSceneHandoff,
    ldtkSceneHandoff,
    engineConsumerValidation,
    reviewStatus,
    manualImportEvidence,
    manualImportChecklist,
    files: { ...PACK_FILES },
  }
}

export function editorProjectPackFiles(pack) {
  const files = [
    { name: PACK_FILES.manifest, content: pack.manifest },
    { name: PACK_FILES.project, content: pack.projectJson },
    { name: PACK_FILES.validation, content: pack.validationReport },
    { name: PACK_FILES.assetReferences, content: pack.assetReferences },
    { name: PACK_FILES.sceneIndex, content: pack.sceneDocuments.index },
    { name: PACK_FILES.enginePayloads, content: pack.enginePayloads },
    { name: PACK_FILES.engineHandoffManifest, content: pack.engineHandoffManifest },
    { name: PACK_FILES.godotSceneHandoff, content: pack.godotSceneHandoff },
    { name: PACK_FILES.ldtkSceneHandoff, content: pack.ldtkSceneHandoff },
    { name: PACK_FILES.engineConsumerValidation, content: pack.engineConsumerValidation },
    { name: PACK_FILES.manualImportEvidence, content: pack.manualImportEvidence },
    { name: PACK_FILES.manualImportChecklist, content: pack.manualImportChecklist, format: 'text' },
    ...Object.entries(pack.sceneDocuments.scenes ?? {}).map(([sceneId, scene]) => ({
      name: sceneFile(sceneId),
      content: scene,
    })),
  ]
  return files
}

export function editorProjectPackArtifactFiles(pack, { projectRoot }) {
  const files = []
  for (const asset of Object.values(pack.assetReferences.assets ?? {})) {
    for (const artifact of Object.values(asset.active_revision?.artifacts ?? {})) {
      if (!artifact.safe || artifact.exists === false || !artifact.source_path) continue
      files.push({
        name: artifact.pack_path,
        source_path: artifact.source_path,
        absolute_path: projectRoot ? path.resolve(projectRoot, artifact.source_path) : null,
      })
    }
  }
  for (const payload of pack.enginePayloads.payloads ?? []) {
    if (!payload.included || !payload.source_path) continue
    files.push({
      name: payload.pack_path,
      source_path: payload.source_path,
      absolute_path: projectRoot ? path.resolve(projectRoot, payload.source_path) : null,
    })
  }
  const seen = new Set()
  return files.filter((file) => {
    if (seen.has(file.name)) return false
    seen.add(file.name)
    return true
  })
}

export function exportedEditorProjectArtifactPaths({ exportDir, projectRoot }) {
  const responseKeys = {
    assetReferences: 'asset_references',
    sceneIndex: 'scene_index',
    enginePayloads: 'engine_payloads',
    engineHandoffManifest: 'engine_handoff_manifest',
    godotSceneHandoff: 'godot_scene_handoff',
    ldtkSceneHandoff: 'ldtk_scene_handoff',
    engineConsumerValidation: 'engine_consumer_validation',
    manualImportEvidence: 'manual_import_evidence',
    manualImportChecklist: 'manual_import_checklist',
  }
  const paths = {}
  for (const [key, file] of Object.entries(PACK_FILES)) {
    paths[responseKeys[key] ?? key] = projectRelativePath(path.join(exportDir, file), { projectRoot })
  }
  return paths
}
