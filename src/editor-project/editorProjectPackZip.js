import { readFile } from 'node:fs/promises'

import JSZip from 'jszip'

import {
  editorProjectPackArtifactFiles,
  editorProjectPackFiles,
} from './editorProjectPack.js'

function addJson(zip, name, content) {
  zip.file(name, JSON.stringify(content, null, 2))
}

function addPackFile(zip, file) {
  if (file.format === 'text') {
    zip.file(file.name, file.content)
    return
  }
  addJson(zip, file.name, file.content)
}

export async function buildEditorProjectPackZip(pack, { projectRoot } = {}) {
  const zip = new JSZip()
  for (const file of editorProjectPackFiles(pack)) addPackFile(zip, file)

  for (const file of editorProjectPackArtifactFiles(pack, { projectRoot })) {
    if (!file.absolute_path) continue
    zip.file(file.name, await readFile(file.absolute_path))
  }

  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
