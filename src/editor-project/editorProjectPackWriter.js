import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildEditorProjectPack,
  editorProjectPackFiles,
  exportedEditorProjectArtifactPaths,
} from './editorProjectPack.js'
import { buildEditorProjectPackZip } from './editorProjectPackZip.js'
import { resolveEditorProjectPaths, sanitizeEditorId } from './paths.js'

function timestamp(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function defaultExportId(project, now = new Date()) {
  const compact = timestamp(now).replace(/[-:.]/g, '').replace('T', '_').replace('Z', 'z')
  return `export_rev_${project.revision}_${compact}`
}

async function writeJson(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(content, null, 2))
}

async function writePackFile(filePath, file) {
  if (file.format === 'text') {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, file.content)
    return
  }
  await writeJson(filePath, file.content)
}

export async function writeEditorProjectPackArtifacts({
  project,
  projectRoot = process.cwd(),
  workspaceRoot,
  exportId,
  now = new Date(),
} = {}) {
  if (!project) throw new Error('project is required')
  const paths = resolveEditorProjectPaths({ projectId: project.id, projectRoot, workspaceRoot })
  const resolvedExportId = sanitizeEditorId(exportId ?? defaultExportId(project, now), 'export')
  if (exportId && resolvedExportId !== exportId) throw new Error(`export id is unsafe: ${exportId}`)
  const exportDir = path.join(paths.exportsDir, resolvedExportId)
  await mkdir(exportDir, { recursive: true })

  const pack = buildEditorProjectPack(project, {
    projectRoot,
    workspaceRoot: paths.workspaceRoot,
    createdAt: now,
  })
  for (const file of editorProjectPackFiles(pack)) {
    await writePackFile(path.join(exportDir, file.name), file)
  }
  const zipBuffer = await buildEditorProjectPackZip(pack, { projectRoot })
  await writeFile(path.join(exportDir, pack.files.zip), zipBuffer)

  return {
    export_id: resolvedExportId,
    export_dir: exportDir,
    status: pack.status,
    pack,
    artifacts: exportedEditorProjectArtifactPaths({ exportDir, projectRoot }),
  }
}
