import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  resolveGeneratedJobArtifactFile,
  resolveManagedRevisionArtifactFile,
} from '../../src/editor-project/paths.js'

async function tempRoot(prefix = 'editor-managed-artifact-') {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function rejectsWithCode(action, code) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.code, code)
    return true
  })
}

function managedOptions(root, revision, artifactKey) {
  return {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    revision,
    artifactKey,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
  }
}

function managedArtifactPath(fileName) {
  return `workspace/projects/project_demo/assets/asset_hero/rev_001/${fileName}`
}

async function createManagedRevisionRoot(root) {
  const revisionDir = path.join(
    root,
    'workspace',
    'projects',
    'project_demo',
    'assets',
    'asset_hero',
    'rev_001',
  )
  await mkdir(revisionDir, { recursive: true })
  return revisionDir
}

test('managed resolver accepts only recorded regular files and in-root symlink targets', async () => {
  const root = await tempRoot()
  const revisionDir = await createManagedRevisionRoot(root)
  const regularPath = path.join(revisionDir, 'regular.txt')
  const nestedDir = path.join(revisionDir, 'nested')
  const targetPath = path.join(nestedDir, 'target.txt')
  const symlinkPath = path.join(revisionDir, 'alias.txt')
  await writeFile(regularPath, 'regular')
  await mkdir(nestedDir)
  await writeFile(targetPath, 'target')
  await symlink(targetPath, symlinkPath)

  const revision = {
    id: 'rev_001',
    processing_recipe_ref: managedArtifactPath('regular.txt'),
    artifacts: {
      regular: managedArtifactPath('regular.txt'),
      in_root_symlink: managedArtifactPath('alias.txt'),
    },
    source: {
      file_name: managedArtifactPath('alias.txt'),
    },
  }

  assert.equal(
    await resolveManagedRevisionArtifactFile(managedOptions(root, revision, 'regular')),
    await realpath(regularPath),
  )
  assert.equal(
    await resolveManagedRevisionArtifactFile(managedOptions(root, revision, 'in_root_symlink')),
    await realpath(targetPath),
  )
  assert.equal(
    await resolveManagedRevisionArtifactFile(managedOptions(root, revision, 'processing_recipe')),
    await realpath(regularPath),
  )
  await rejectsWithCode(
    () => resolveManagedRevisionArtifactFile(managedOptions(root, revision, 'source')),
    'unsafe_artifact_path',
  )
})

test('managed resolver rejects unknown, absolute, traversal, missing, and directory artifact records', async () => {
  const root = await tempRoot()
  const revisionDir = await createManagedRevisionRoot(root)
  const directoryPath = path.join(revisionDir, 'directory')
  const unrecordedPath = path.join(revisionDir, 'unrecorded.txt')
  await mkdir(directoryPath)
  await writeFile(unrecordedPath, 'unrecorded')

  const revision = {
    id: 'rev_001',
    artifacts: {
      absolute: path.join(root, 'outside.txt'),
      traversal: 'workspace/projects/project_demo/assets/asset_hero/rev_001/../outside.txt',
      missing: managedArtifactPath('missing.txt'),
      directory: managedArtifactPath('directory'),
    },
  }

  for (const artifactKey of ['unknown', 'absolute', 'traversal']) {
    await rejectsWithCode(
      () => resolveManagedRevisionArtifactFile(managedOptions(root, revision, artifactKey)),
      'unsafe_artifact_path',
    )
  }
  await rejectsWithCode(
    () => resolveManagedRevisionArtifactFile(managedOptions(root, revision, 'missing')),
    'artifact_not_found',
  )
  await rejectsWithCode(
    () => resolveManagedRevisionArtifactFile(managedOptions(root, revision, 'directory')),
    'unsafe_artifact_path',
  )
})

test('managed resolver rejects recorded project, asset, and revision identity mismatches', async () => {
  const root = await tempRoot()
  await createManagedRevisionRoot(root)
  const revision = {
    id: 'rev_001',
    artifacts: {
      wrong_project: 'workspace/projects/project_forged/assets/asset_hero/rev_001/file.txt',
      wrong_asset: 'workspace/projects/project_demo/assets/asset_forged/rev_001/file.txt',
      wrong_revision: 'workspace/projects/project_demo/assets/asset_hero/rev_forged/file.txt',
    },
  }

  for (const artifactKey of ['wrong_project', 'wrong_asset', 'wrong_revision']) {
    await rejectsWithCode(
      () => resolveManagedRevisionArtifactFile(managedOptions(root, revision, artifactKey)),
      'unsafe_artifact_path',
    )
  }
})

test('managed resolver rejects file symlinks and whole revision symlinks escaping the exact revision root', async () => {
  const root = await tempRoot()
  const revisionDir = await createManagedRevisionRoot(root)
  const siblingPath = path.join(root, 'workspace', 'sibling.txt')
  const escapingSymlinkPath = path.join(revisionDir, 'escape.txt')
  await writeFile(siblingPath, 'sibling')
  await symlink(siblingPath, escapingSymlinkPath)

  const revision = {
    id: 'rev_001',
    artifacts: { escape: managedArtifactPath('escape.txt') },
  }
  await rejectsWithCode(
    () => resolveManagedRevisionArtifactFile(managedOptions(root, revision, 'escape')),
    'unsafe_artifact_path',
  )

  const linkedRoot = await tempRoot('editor-managed-linked-root-')
  const externalRevisionDir = await tempRoot('editor-managed-external-revision-')
  await writeFile(path.join(externalRevisionDir, 'external.txt'), 'external')
  const linkedRevisionDir = path.join(
    linkedRoot,
    'workspace',
    'projects',
    'project_demo',
    'assets',
    'asset_hero',
    'rev_001',
  )
  await mkdir(path.dirname(linkedRevisionDir), { recursive: true })
  await symlink(externalRevisionDir, linkedRevisionDir, 'dir')
  const linkedRevision = {
    id: 'rev_001',
    artifacts: { external: managedArtifactPath('external.txt') },
  }
  await rejectsWithCode(
    () => resolveManagedRevisionArtifactFile(managedOptions(linkedRoot, linkedRevision, 'external')),
    'unsafe_artifact_path',
  )
})

test('managed and generated resolvers classify symlink loops as unsafe without leaking paths', async () => {
  const root = await tempRoot('editor-artifact-symlink-loop-')
  const revisionDir = await createManagedRevisionRoot(root)
  await symlink('loop-b.txt', path.join(revisionDir, 'loop-a.txt'))
  await symlink('loop-a.txt', path.join(revisionDir, 'loop-b.txt'))
  const revision = {
    id: 'rev_001',
    artifacts: { loop: managedArtifactPath('loop-a.txt') },
  }

  const jobDir = await createGeneratedJobRoot(root)
  await symlink('loop-b.txt', path.join(jobDir, 'loop-a.txt'))
  await symlink('loop-a.txt', path.join(jobDir, 'loop-b.txt'))

  for (const action of [
    () => resolveManagedRevisionArtifactFile(managedOptions(root, revision, 'loop')),
    () => resolveGeneratedJobArtifactFile(generatedOptions(root, {
      fileName: 'loop-a.txt',
      allowedFiles: new Set(['loop-a.txt']),
    })),
  ]) {
    await assert.rejects(action, (error) => {
      assert.equal(error?.code, 'unsafe_artifact_path')
      assert.equal(String(error?.message).includes(root), false)
      return true
    })
  }
})

test('managed and generated resolvers allow safe double-dot-prefix file names inside exact roots', async () => {
  const root = await tempRoot('editor-artifact-double-dot-prefix-')
  const revisionDir = await createManagedRevisionRoot(root)
  const managedPath = path.join(revisionDir, '..valid')
  await writeFile(managedPath, 'managed')
  const revision = {
    id: 'rev_001',
    artifacts: { double_dot_prefix: managedArtifactPath('..valid') },
  }
  assert.equal(
    await resolveManagedRevisionArtifactFile(managedOptions(root, revision, 'double_dot_prefix')),
    await realpath(managedPath),
  )

  const jobDir = await createGeneratedJobRoot(root)
  const generatedPath = path.join(jobDir, '..valid')
  await writeFile(generatedPath, 'generated')
  assert.equal(
    await resolveGeneratedJobArtifactFile(generatedOptions(root, {
      fileName: '..valid',
      allowedFiles: new Set(['..valid']),
    })),
    await realpath(generatedPath),
  )
})

function generatedOptions(root, overrides = {}) {
  return {
    jobId: 'job_demo',
    fileName: 'regular.txt',
    allowedFiles: new Set(['regular.txt']),
    generatedDir: path.join(root, 'generated'),
    ...overrides,
  }
}

async function createGeneratedJobRoot(root) {
  const jobDir = path.join(root, 'generated', 'job_demo')
  await mkdir(jobDir, { recursive: true })
  return jobDir
}

test('generated resolver accepts only allowlisted regular files and in-root symlink targets', async () => {
  const root = await tempRoot('editor-generated-artifact-')
  const jobDir = await createGeneratedJobRoot(root)
  const regularPath = path.join(jobDir, 'regular.txt')
  const targetPath = path.join(jobDir, 'target.txt')
  const symlinkPath = path.join(jobDir, 'alias.txt')
  await writeFile(regularPath, 'regular')
  await writeFile(targetPath, 'target')
  await symlink(targetPath, symlinkPath)

  assert.equal(
    await resolveGeneratedJobArtifactFile(generatedOptions(root)),
    await realpath(regularPath),
  )
  assert.equal(
    await resolveGeneratedJobArtifactFile(generatedOptions(root, {
      fileName: 'alias.txt',
      allowedFiles: new Set(['alias.txt']),
    })),
    await realpath(targetPath),
  )
})

test('generated resolver rejects unknown, absolute, traversal, missing, and directory file names', async () => {
  const root = await tempRoot('editor-generated-artifact-')
  const jobDir = await createGeneratedJobRoot(root)
  const unknownPath = path.join(jobDir, 'unknown.txt')
  await writeFile(unknownPath, 'unknown')
  await mkdir(path.join(jobDir, 'directory'))

  await rejectsWithCode(
    () => resolveGeneratedJobArtifactFile(generatedOptions(root, {
      fileName: 'unknown.txt',
      allowedFiles: new Set(['regular.txt']),
    })),
    'unsafe_artifact_path',
  )
  for (const fileName of [path.join(root, 'outside.txt'), '../outside.txt']) {
    await rejectsWithCode(
      () => resolveGeneratedJobArtifactFile(generatedOptions(root, {
        fileName,
        allowedFiles: new Set([fileName]),
      })),
      'unsafe_artifact_path',
    )
  }
  await rejectsWithCode(
    () => resolveGeneratedJobArtifactFile(generatedOptions(root, {
      fileName: 'missing.txt',
      allowedFiles: new Set(['missing.txt']),
    })),
    'artifact_not_found',
  )
  await rejectsWithCode(
    () => resolveGeneratedJobArtifactFile(generatedOptions(root, {
      fileName: 'directory',
      allowedFiles: new Set(['directory']),
    })),
    'unsafe_artifact_path',
  )
})

test('generated resolver rejects job ids that collapse the job root to the generated root', async () => {
  const root = await tempRoot('editor-generated-collapsed-job-root-')
  const generatedDir = path.join(root, 'generated')
  await mkdir(generatedDir)
  await writeFile(path.join(generatedDir, 'root.txt'), 'generated root file')

  await rejectsWithCode(
    () => resolveGeneratedJobArtifactFile({
      jobId: '.',
      fileName: 'root.txt',
      allowedFiles: new Set(['root.txt']),
      generatedDir,
    }),
    'unsafe_artifact_path',
  )
})

test('generated resolver rejects file symlinks and whole job symlinks escaping the exact job root', async () => {
  const root = await tempRoot('editor-generated-artifact-')
  const jobDir = await createGeneratedJobRoot(root)
  const siblingPath = path.join(root, 'generated', 'sibling.txt')
  const escapingSymlinkPath = path.join(jobDir, 'escape.txt')
  await writeFile(siblingPath, 'sibling')
  await symlink(siblingPath, escapingSymlinkPath)
  await rejectsWithCode(
    () => resolveGeneratedJobArtifactFile(generatedOptions(root, {
      fileName: 'escape.txt',
      allowedFiles: new Set(['escape.txt']),
    })),
    'unsafe_artifact_path',
  )

  const linkedRoot = await tempRoot('editor-generated-linked-root-')
  const externalJobDir = await tempRoot('editor-generated-external-job-')
  await writeFile(path.join(externalJobDir, 'external.txt'), 'external')
  const linkedJobDir = path.join(linkedRoot, 'generated', 'job_demo')
  await mkdir(path.dirname(linkedJobDir), { recursive: true })
  await symlink(externalJobDir, linkedJobDir, 'dir')
  await rejectsWithCode(
    () => resolveGeneratedJobArtifactFile(generatedOptions(linkedRoot, {
      fileName: 'external.txt',
      allowedFiles: new Set(['external.txt']),
    })),
    'unsafe_artifact_path',
  )
})
