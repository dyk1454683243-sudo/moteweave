#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import crypto from 'node:crypto'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const RELEASE_CONFIG_PATH = 'configs/public-release.json'
const SNAPSHOT_MANIFEST_PATH = 'configs/public-snapshot-manifest.json'
const ASSET_PROVENANCE_PATH = 'configs/public-asset-provenance.json'
const SNAPSHOT_LEDGER_PATH = 'PUBLIC_SNAPSHOT.json'
const BINARY_EXTENSION = /\.(?:gif|jpe?g|otf|pdf|png|ttf|webp|woff2?|zip)$/i
const TEXT_EXTENSION = /\.(?:css|csv|gd|html|js|json|md|mjs|svg|toml|ts|tsx|txt|xml|yaml|yml)$/i
const TEXT_ROOT_FILES = new Set([
  '.env.example',
  '.gitignore',
  'AGENTS.md',
  'ATTRIBUTIONS.md',
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
])
const ACTIVE_BRAND_FILES = Object.freeze([
  '.env.example',
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'index.html',
  'src/character-pack/providers/openRouterAdapter.js',
  'src/character-pack/providers/providerConfig.js',
  'website/README.md',
  'website/index.html',
])
const PROVIDER_ENV_NAMES = Object.freeze([
  'CHARACTER_IMAGE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENROUTER_API_KEY',
])
const EPHEMERAL_SNAPSHOT_DIRS = new Set(['.git', '.npm-cache', 'node_modules'])
const FORBIDDEN_PATH_COMPONENTS = new Set(['generated', 'node_modules', 'output', 'workspace'])

function issue(code, message, details = {}) {
  return { code, message, ...details }
}

function pathMatchesRule(filePath, rule) {
  return rule.endsWith('/') ? filePath.startsWith(rule) : filePath === rule
}

function isInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function safeRelativePath(filePath) {
  return Boolean(
    filePath
    && !path.isAbsolute(filePath)
    && !filePath.split(/[\\/]/).includes('..')
    && !filePath.includes('\\')
  )
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function modeString(mode) {
  return (mode & 0o777).toString(8).padStart(3, '0')
}

function hasForbiddenComponent(filePath) {
  const parts = filePath.split('/')
  return parts.some((part) => FORBIDDEN_PATH_COMPONENTS.has(part))
    || parts.some((part) => part === '.env')
    || filePath.startsWith('.superpowers/')
    || /(^|\/)[^/]+ 2\.[^/]+$/.test(filePath)
}

async function readJsonWithBuffer(rootDir, relativePath) {
  const buffer = await readFile(path.join(rootDir, relativePath))
  return {
    buffer,
    value: JSON.parse(buffer.toString('utf8')),
  }
}

async function gitText(rootDir, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout
}

async function gitBuffer(rootDir, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: rootDir,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

async function isGitWorktree(rootDir) {
  try {
    return (await gitText(rootDir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

export async function listTrackedFiles(rootDir = process.cwd()) {
  return (await gitText(rootDir, ['ls-files', '-z']))
    .split('\0')
    .filter(Boolean)
    .sort()
}

async function listIgnoredTrackedFiles(rootDir) {
  return (await gitText(rootDir, ['ls-files', '-ci', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean)
    .sort()
}

async function listGitModes(rootDir) {
  const modes = new Map()
  for (const record of (await gitText(rootDir, ['ls-files', '-s', '-z'])).split('\0').filter(Boolean)) {
    const match = record.match(/^(\d{6})\s+[0-9a-f]+\s+\d+\t(.+)$/s)
    if (!match) continue
    modes.set(match[2], match[1] === '100755' ? '755' : '644')
  }
  return modes
}

function isIncluded(filePath, manifest) {
  return manifest.include_paths.some((rule) => pathMatchesRule(filePath, rule))
    && !manifest.exclude_paths.some((rule) => pathMatchesRule(filePath, rule))
}

function syntheticHomePathAllowed(filePath, userName, releaseConfig) {
  const allowlist = releaseConfig.privacy?.synthetic_home_path_allowlist ?? []
  return allowlist.some((entry) => {
    const pathAllowed = entry.path
      ? filePath === entry.path
      : entry.path_prefix
        ? filePath.startsWith(entry.path_prefix)
        : false
    return pathAllowed && Array.isArray(entry.users) && entry.users.includes(userName)
  })
}

function scanText(filePath, text, releaseConfig) {
  const issues = []
  const homePatterns = [
    { platform: 'macos', regex: /\/Users\/([A-Za-z0-9._-]+)/g },
    { platform: 'linux', regex: /\/home\/([A-Za-z0-9._-]+)/g },
    { platform: 'windows', regex: /[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)/g },
  ]
  for (const { platform, regex } of homePatterns) {
    for (const match of text.matchAll(regex)) {
      if (syntheticHomePathAllowed(filePath, match[1], releaseConfig)) continue
      issues.push(issue('privacy.real_home_path', `real or unapproved ${platform} home path`, {
        file: filePath,
        user: match[1],
      }))
    }
  }
  const legacyNamedIpToken = ['wit', 'cher'].join('')
  const legacyNamedIpPattern = new RegExp(`(^|[^A-Za-z])${legacyNamedIpToken}([^A-Za-z]|$)`, 'i')
  if (legacyNamedIpPattern.test(text)) {
    issues.push(issue('naming.named_ip_token', 'legacy named-IP sample token remains', { file: filePath }))
  }
  const secretPatterns = [
    /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9_-]{32,}\b/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
  ]
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    issues.push(issue('secret.high_confidence_pattern', 'high-confidence secret pattern found', { file: filePath }))
  }
  return issues
}

function packageRepositoryUrl(packageJson) {
  if (typeof packageJson.repository === 'string') return packageJson.repository
  return packageJson.repository?.url ?? ''
}

function packageBugsUrl(packageJson) {
  if (typeof packageJson.bugs === 'string') return packageJson.bugs
  return packageJson.bugs?.url ?? ''
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function walkSnapshotFiles(rootDir, relativeDir = '') {
  const files = []
  const entries = await readdir(path.join(rootDir, relativeDir), { withFileTypes: true })
  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    if (relativeDir === '' && EPHEMERAL_SNAPSHOT_DIRS.has(entry.name)) continue
    if (entry.isSymbolicLink()) {
      files.push({ path: relativePath, type: 'symlink' })
      continue
    }
    if (entry.isDirectory()) {
      if (hasForbiddenComponent(relativePath)) {
        files.push({ path: `${relativePath}/`, type: 'forbidden_directory' })
        continue
      }
      files.push(...await walkSnapshotFiles(rootDir, relativePath))
      continue
    }
    if (entry.isFile()) files.push({ path: relativePath, type: 'file' })
  }
  return files
}

async function verifySnapshotLedger(rootDir, releaseConfigBuffer, snapshotManifestBuffer) {
  const issues = []
  let ledger
  try {
    ledger = JSON.parse(await readFile(path.join(rootDir, SNAPSHOT_LEDGER_PATH), 'utf8'))
  } catch {
    return {
      issues: [issue('snapshot.ledger_missing', 'PUBLIC_SNAPSHOT.json is missing or unreadable')],
      files: [],
      ledger: null,
    }
  }
  if (ledger.release_config_sha256 !== sha256(releaseConfigBuffer)) {
    issues.push(issue('snapshot.release_config_binding', 'snapshot ledger release config hash is invalid'))
  }
  if (ledger.manifest_sha256 !== sha256(snapshotManifestBuffer)) {
    issues.push(issue('snapshot.manifest_binding', 'snapshot ledger manifest hash is invalid'))
  }
  const records = Array.isArray(ledger.files) ? ledger.files : []
  const seen = new Set()
  for (const record of records) {
    if (!safeRelativePath(record.path) || seen.has(record.path)) {
      issues.push(issue('snapshot.ledger_path_invalid', 'snapshot ledger contains an unsafe or duplicate path', { file: record.path ?? null }))
      continue
    }
    seen.add(record.path)
    try {
      const filePath = path.join(rootDir, record.path)
      const metadata = await lstat(filePath)
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        issues.push(issue('snapshot.ledger_file_type', 'snapshot ledger path is not a regular file', { file: record.path }))
        continue
      }
      const buffer = await readFile(filePath)
      if (record.sha256 !== sha256(buffer)) issues.push(issue('snapshot.ledger_sha256', 'snapshot file hash differs from ledger', { file: record.path }))
      if (record.size !== buffer.length) issues.push(issue('snapshot.ledger_size', 'snapshot file size differs from ledger', { file: record.path }))
      if (record.mode !== modeString(metadata.mode)) issues.push(issue('snapshot.ledger_mode', 'snapshot file mode differs from ledger', { file: record.path }))
    } catch {
      issues.push(issue('snapshot.ledger_file_missing', 'snapshot ledger file is missing', { file: record.path }))
    }
  }
  const actualEntries = await walkSnapshotFiles(rootDir)
  const expected = new Set([...seen, SNAPSHOT_LEDGER_PATH])
  for (const entry of actualEntries) {
    if (entry.type !== 'file') {
      issues.push(issue('snapshot.unexpected_file_type', 'snapshot contains a symlink or forbidden directory', { file: entry.path }))
      continue
    }
    if (!expected.has(entry.path)) issues.push(issue('snapshot.unexpected_file', 'snapshot contains a file outside the ledger', { file: entry.path }))
  }
  for (const expectedPath of expected) {
    if (!actualEntries.some((entry) => entry.type === 'file' && entry.path === expectedPath)) {
      issues.push(issue('snapshot.expected_file_missing', 'snapshot ledger expects a missing file', { file: expectedPath }))
    }
  }
  return { issues, files: [...seen, SNAPSHOT_LEDGER_PATH].sort(), ledger }
}

async function inventoryForCheck(rootDir, trackedFiles, releaseConfigBuffer, snapshotManifestBuffer) {
  if (trackedFiles) return { mode: 'injected', files: [...trackedFiles].sort(), issues: [] }
  if (await isGitWorktree(rootDir)) {
    const issues = []
    const dirty = await gitText(rootDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    if (dirty) issues.push(issue('source.dirty_worktree', 'release worktree has staged, unstaged, or untracked changes'))
    let committedSnapshotLedger = false
    try {
      await gitText(rootDir, ['cat-file', '-e', `HEAD:${SNAPSHOT_LEDGER_PATH}`])
      committedSnapshotLedger = true
    } catch {
      // A ledger must be committed in HEAD before it can identify a Git worktree as a public snapshot mirror.
    }
    if (committedSnapshotLedger) {
      const snapshot = await verifySnapshotLedger(rootDir, releaseConfigBuffer, snapshotManifestBuffer)
      return {
        mode: 'snapshot',
        files: snapshot.files,
        issues: [...issues, ...snapshot.issues],
        ledger: snapshot.ledger,
      }
    }
    return { mode: 'source', files: await listTrackedFiles(rootDir), issues }
  }
  const snapshot = await verifySnapshotLedger(rootDir, releaseConfigBuffer, snapshotManifestBuffer)
  return { mode: 'snapshot', files: snapshot.files, issues: snapshot.issues, ledger: snapshot.ledger }
}

export async function checkPublicRelease({
  rootDir = process.cwd(),
  trackedFiles,
} = {}) {
  const root = path.resolve(rootDir)
  const releaseConfigFile = await readJsonWithBuffer(root, RELEASE_CONFIG_PATH)
  const snapshotManifestFile = await readJsonWithBuffer(root, SNAPSHOT_MANIFEST_PATH)
  const assetProvenanceFile = await readJsonWithBuffer(root, ASSET_PROVENANCE_PATH)
  const releaseConfig = releaseConfigFile.value
  const snapshotManifest = snapshotManifestFile.value
  const assetProvenance = assetProvenanceFile.value
  const inventory = await inventoryForCheck(
    root,
    trackedFiles,
    releaseConfigFile.buffer,
    snapshotManifestFile.buffer,
  )
  const files = inventory.files
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  const readme = await readFile(path.join(root, 'README.md'), 'utf8')
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')
  const attributions = await readFile(path.join(root, 'ATTRIBUTIONS.md'), 'utf8')
  const issues = [...inventory.issues]

  for (const environmentName of PROVIDER_ENV_NAMES) {
    if (String(process.env[environmentName] ?? '').trim()) {
      issues.push(issue('provider.environment_configured', 'Provider credential must be absent during release verification', {
        environment: environmentName,
      }))
    }
  }

  for (const filePath of files) {
    if (!safeRelativePath(filePath)) {
      issues.push(issue('snapshot.unsafe_path', 'release path is not a safe repository-relative path', { file: filePath }))
      continue
    }
    const classified = snapshotManifest.include_paths.some((rule) => pathMatchesRule(filePath, rule))
      || snapshotManifest.exclude_paths.some((rule) => pathMatchesRule(filePath, rule))
    if (!classified) issues.push(issue('snapshot.unclassified_path', 'release path is not classified by the snapshot manifest', { file: filePath }))
    if (snapshotManifest.forbidden_paths.some((rule) => pathMatchesRule(filePath, rule)) || hasForbiddenComponent(filePath)) {
      issues.push(issue('snapshot.forbidden_path', 'forbidden release path is present', { file: filePath }))
    }
  }

  if (inventory.mode === 'source') {
    for (const filePath of await listIgnoredTrackedFiles(root)) {
      issues.push(issue('snapshot.ignored_tracked_path', 'gitignored path is still tracked', { file: filePath }))
    }
    for (const ancestor of releaseConfig.required_ancestors ?? []) {
      try {
        await gitText(root, ['merge-base', '--is-ancestor', ancestor, 'HEAD'])
      } catch {
        issues.push(issue('source.required_ancestor_missing', 'required release baseline ancestor is missing', { commit: ancestor }))
      }
    }
  }

  if (releaseConfig.release_version !== packageJson.version) {
    issues.push(issue('metadata.package_version', 'package.json version does not match release config'))
  }
  if (packageLock.version !== releaseConfig.release_version || packageLock.packages?.['']?.version !== releaseConfig.release_version) {
    issues.push(issue('metadata.lock_version', 'package-lock.json version does not match release config'))
  }
  if (packageLock.name !== packageJson.name || packageLock.packages?.['']?.name !== packageJson.name) {
    issues.push(issue('metadata.lock_name', 'package-lock.json package name does not match package.json'))
  }
  if (!readme.includes(releaseConfig.release_version)) {
    issues.push(issue('metadata.readme_version', 'README does not name the release version'))
  }
  if (!changelog.includes(`## [${releaseConfig.release_version}]`)) {
    issues.push(issue('metadata.changelog_version', 'CHANGELOG does not contain the release version heading'))
  }
  if (packageJson.private !== true || packageJson.bin || packageJson.publishConfig || releaseConfig.source_only !== true || releaseConfig.npm_publish !== false) {
    issues.push(issue('distribution.source_only', 'Preview must remain private and source-only'))
  }
  if (packageJson.license !== 'MIT') issues.push(issue('metadata.license', 'package license must remain MIT'))
  if (packageJson.engines?.node !== '>=22 <25') {
    issues.push(issue('metadata.node_engines', 'package.json must declare Node >=22 <25'))
  }

  const brand = releaseConfig.brand ?? {}
  if (brand.status !== 'approved' || !brand.display_name || !brand.slug) {
    issues.push(issue('brand.not_approved', 'final public brand and slug are not approved'))
  } else {
    const expectedRepository = `https://github.com/${brand.github_owner}/${brand.slug}.git`
    const expectedHomepage = `https://${brand.pages_project}.pages.dev/`
    if (brand.repository_url !== expectedRepository) issues.push(issue('brand.config_repository', 'brand repository URL does not match owner and slug'))
    if (brand.homepage_url !== expectedHomepage) issues.push(issue('brand.config_homepage', 'brand homepage does not match Pages project'))
    if (brand.pages_project !== brand.slug) issues.push(issue('brand.pages_slug', 'Pages project must match the approved public slug'))
    try {
      const decision = await readFile(path.join(root, brand.decision_file), 'utf8')
      const requiredDecisionLines = [
        `Status: Accepted`,
        `Display name: ${brand.display_name}`,
        `Slug: ${brand.slug}`,
        `Repository: ${brand.repository_url}`,
        `Pages project: ${brand.pages_project}`,
        `Homepage: ${brand.homepage_url}`,
      ]
      for (const line of requiredDecisionLines) {
        if (!new RegExp(`^${regexEscape(line)}$`, 'm').test(decision)) {
          issues.push(issue('brand.decision_mismatch', 'brand decision does not match release config', {
            file: brand.decision_file,
            field: line.split(':')[0],
          }))
        }
      }
    } catch {
      issues.push(issue('brand.decision_missing', 'brand decision file is missing', { file: brand.decision_file }))
    }
    if (packageJson.name !== brand.slug) issues.push(issue('brand.package_slug', 'package name does not match approved slug'))
    if (packageRepositoryUrl(packageJson) !== brand.repository_url) issues.push(issue('brand.repository_url', 'package repository URL does not match approved brand config'))
    if (packageJson.homepage !== brand.homepage_url) issues.push(issue('brand.homepage_url', 'package homepage does not match approved brand config'))
    if (packageBugsUrl(packageJson) !== `${brand.repository_url.replace(/\.git$/, '')}/issues`) {
      issues.push(issue('brand.bugs_url', 'package bugs URL does not match approved repository'))
    }
    if (!readme.includes(brand.repository_url.replace(/\.git$/, ''))) {
      issues.push(issue('brand.readme_repository', 'README does not link the approved public repository'))
    }
    for (const filePath of ACTIVE_BRAND_FILES) {
      const text = await readFile(path.join(root, filePath), 'utf8')
      if (!text.includes(brand.display_name)) {
        issues.push(issue('brand.display_name_missing', 'active public brand file does not use the approved name', { file: filePath }))
      }
      if (/AI Character Pack Tool|GameTool|ai-character-pack-tool/.test(text)) {
        issues.push(issue('brand.temporary_name', 'temporary product name remains in an active public brand file', { file: filePath }))
      }
    }
    const website = await readFile(path.join(root, 'website/index.html'), 'utf8')
    if (!website.includes(releaseConfig.release_version)) issues.push(issue('brand.website_version', 'website does not name the release version'))
    if (!website.includes(brand.homepage_url)) issues.push(issue('brand.website_canonical', 'website does not use the approved canonical URL'))
  }

  const includedFiles = files.filter((filePath) => filePath !== SNAPSHOT_LEDGER_PATH && isIncluded(filePath, snapshotManifest))
  for (const filePath of includedFiles) {
    const buffer = await readFile(path.join(root, filePath))
    if (!BINARY_EXTENSION.test(filePath) && buffer.includes(0)) {
      issues.push(issue('asset.unknown_binary', 'NUL-containing file is not classified as a known binary asset', { file: filePath }))
      continue
    }
    if (!TEXT_ROOT_FILES.has(filePath) && !TEXT_EXTENSION.test(filePath)) continue
    issues.push(...scanText(filePath, buffer.toString('utf8'), releaseConfig))
  }

  const ledger = new Map()
  for (const asset of assetProvenance.assets ?? []) {
    if (ledger.has(asset.path)) issues.push(issue('asset.duplicate_provenance', 'asset provenance contains a duplicate path', { file: asset.path }))
    ledger.set(asset.path, asset)
  }
  const binaryFiles = includedFiles.filter((filePath) => BINARY_EXTENSION.test(filePath))
  for (const filePath of binaryFiles) {
    const asset = ledger.get(filePath)
    if (!asset) {
      issues.push(issue('asset.provenance_missing', 'binary asset has no provenance entry', { file: filePath }))
      continue
    }
    const buffer = await readFile(path.join(root, filePath))
    if (asset.sha256 !== sha256(buffer)) issues.push(issue('asset.sha256_mismatch', 'binary asset hash does not match provenance', { file: filePath }))
    if (asset.release_status !== 'approved' || asset.source_rights !== 'repository_owned' || !asset.generator) {
      issues.push(issue('asset.not_release_approved', 'binary asset is not approved for the public snapshot', { file: filePath }))
    }
    if (asset.generator && (!files.includes(asset.generator) || !isIncluded(asset.generator, snapshotManifest))) {
      issues.push(issue('asset.generator_missing', 'asset generator is not an included tracked file', { file: filePath, generator: asset.generator }))
    }
    if (!attributions.includes(filePath) || (asset.generator && !attributions.includes(asset.generator))) {
      issues.push(issue('asset.attribution_missing', 'ATTRIBUTIONS does not name the asset and generator', { file: filePath }))
    }
  }
  for (const asset of assetProvenance.assets ?? []) {
    if (!files.includes(asset.path)) issues.push(issue('asset.ledger_path_missing', 'provenance asset is not tracked', { file: asset.path }))
  }

  const localManifest = JSON.parse(await readFile(
    path.join(root, 'test/fixtures/character-pack/local-image-golden/manifest.json'),
    'utf8',
  ))
  for (const sample of localManifest.samples ?? []) {
    const filePath = `test/fixtures/character-pack/local-image-golden/${sample.file}`
    const asset = ledger.get(filePath)
    if (!asset || sample.sha256 !== asset.sha256 || !['original', 'test_generated'].includes(sample.source_rights)) {
      issues.push(issue('asset.fixture_manifest_mismatch', 'local golden manifest does not match approved provenance', { file: filePath }))
    }
  }

  return {
    schema_version: 1,
    mode: inventory.mode === 'snapshot'
      ? 'provider_free_public_snapshot_check'
      : 'provider_free_public_release_check',
    status: issues.length ? 'fail' : 'pass',
    release_version: releaseConfig.release_version,
    brand_status: brand.status ?? 'missing',
    source_mode: inventory.mode,
    tracked_files: files.length,
    exported_files: includedFiles.length,
    issues,
  }
}

async function canonicalPathIfExists(filePath) {
  try {
    return await realpath(filePath)
  } catch {
    return path.resolve(filePath)
  }
}

export async function validateExportDestination({ rootDir, destination, worktreePaths = [] }) {
  if (!destination) throw new Error('release export destination is required')
  const root = await canonicalPathIfExists(rootDir)
  const target = path.resolve(destination)
  const parent = path.dirname(target)
  const parentMetadata = await lstat(parent)
  if (!parentMetadata.isDirectory()) throw new Error('release export parent must be an existing directory')
  const canonicalParent = await realpath(parent)
  const canonicalTarget = path.join(canonicalParent, path.basename(target))
  const canonicalWorktrees = await Promise.all(worktreePaths.map(canonicalPathIfExists))
  if (isInside(root, canonicalTarget)) throw new Error('release export destination must stay outside the private repository')
  for (const worktreePath of canonicalWorktrees) {
    if (isInside(worktreePath, canonicalTarget) || isInside(canonicalTarget, worktreePath)) {
      throw new Error('release export destination cannot contain or be inside a registered worktree')
    }
  }
  try {
    const metadata = await lstat(canonicalTarget)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('release export destination must be a real directory')
    }
    if ((await readdir(canonicalTarget)).length > 0) throw new Error('release export destination must be empty')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await mkdir(canonicalTarget)
  }
  return canonicalTarget
}

async function registeredWorktrees(rootDir) {
  const output = await gitText(rootDir, ['worktree', 'list', '--porcelain'])
  return output
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
}

export async function exportPublicSnapshot({
  rootDir = process.cwd(),
  destination,
  trackedFiles,
  skipReleaseCheck = false,
  sourceCommit,
} = {}) {
  const root = path.resolve(rootDir)
  const sourceMode = trackedFiles === undefined
  const files = sourceMode ? await listTrackedFiles(root) : [...trackedFiles].sort()
  if (!skipReleaseCheck) {
    const report = await checkPublicRelease({ rootDir: root, trackedFiles })
    if (report.status !== 'pass') {
      const error = new Error(`public release check failed with ${report.issues.length} issue(s)`)
      error.report = report
      throw error
    }
  }
  const manifestFile = await readJsonWithBuffer(root, SNAPSHOT_MANIFEST_PATH)
  const releaseConfigFile = await readJsonWithBuffer(root, RELEASE_CONFIG_PATH)
  const target = await validateExportDestination({
    rootDir: root,
    destination,
    worktreePaths: sourceMode ? await registeredWorktrees(root) : [],
  })
  const exportedFiles = files.filter((filePath) => isIncluded(filePath, manifestFile.value))
  const gitModes = sourceMode ? await listGitModes(root) : null
  const ledgerFiles = []
  for (const filePath of exportedFiles) {
    if (!safeRelativePath(filePath)) throw new Error(`unsafe release path: ${filePath}`)
    const targetPath = path.join(target, filePath)
    await mkdir(path.dirname(targetPath), { recursive: true })
    let buffer
    let mode
    if (sourceMode) {
      buffer = await gitBuffer(root, ['show', `HEAD:${filePath}`])
      mode = gitModes.get(filePath) ?? '644'
      await writeFile(targetPath, buffer, { flag: 'wx', mode: Number.parseInt(mode, 8) })
    } else {
      const sourcePath = path.join(root, filePath)
      const metadata = await lstat(sourcePath)
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`release export supports regular files only: ${filePath}`)
      }
      await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL)
      buffer = await readFile(targetPath)
      mode = modeString(metadata.mode)
      await chmod(targetPath, Number.parseInt(mode, 8))
    }
    ledgerFiles.push({
      path: filePath,
      sha256: sha256(buffer),
      size: buffer.length,
      mode,
    })
  }
  const resolvedCommit = sourceCommit ?? (await gitText(root, ['rev-parse', 'HEAD'])).trim()
  const snapshot = {
    schema_version: 1,
    release_version: releaseConfigFile.value.release_version,
    source_commit: resolvedCommit,
    release_config_sha256: sha256(releaseConfigFile.buffer),
    manifest_sha256: sha256(manifestFile.buffer),
    files: ledgerFiles,
  }
  await writeFile(
    path.join(target, SNAPSHOT_LEDGER_PATH),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    { flag: 'wx', mode: 0o644 },
  )
  if (!skipReleaseCheck) {
    const exportedReport = await checkPublicRelease({ rootDir: target })
    if (exportedReport.status !== 'pass') {
      const error = new Error(`exported snapshot check failed with ${exportedReport.issues.length} issue(s)`)
      error.report = exportedReport
      throw error
    }
  }
  return {
    destination: target,
    release_version: releaseConfigFile.value.release_version,
    source_commit: resolvedCommit,
    files: ledgerFiles.length,
  }
}

async function main() {
  const command = process.argv[2]
  if (command === 'check') {
    const report = await checkPublicRelease()
    console.log(JSON.stringify(report, null, 2))
    if (report.status !== 'pass') process.exitCode = 1
    return
  }
  if (command === 'export') {
    try {
      console.log(JSON.stringify(await exportPublicSnapshot({ destination: process.argv[3] }), null, 2))
    } catch (error) {
      if (error.report) console.error(JSON.stringify(error.report, null, 2))
      throw error
    }
    return
  }
  throw new Error('Usage: node scripts/public-release.mjs <check|export> [destination]')
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  await main()
}
