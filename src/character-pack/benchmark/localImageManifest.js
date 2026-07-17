import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'

import sharp from 'sharp'

import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from '../sourceLayoutIds.js'

export const DEFAULT_LOCAL_IMAGE_MANIFEST = 'test/fixtures/character-pack/local-image-golden/manifest.json'

const VALID_KINDS = new Set(['single_character', 'topdown_sheet', 'ocad_sheet', 'bad_case'])
const VALID_PROFILES = new Set([
  'quality_character_v0',
  'single_character',
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
])
const FORMAT_EXTENSIONS = Object.freeze({
  jpeg: 'jpg',
  jpg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
})
const DEFAULT_DIRECTORIES = Object.freeze({
  single_character: 'single-character',
  topdown_sheet: 'topdown-sheet',
  ocad_sheet: 'ocad-sheet',
  bad_case: 'bad-cases',
})
const REPOSITORY_SAFE_SOURCE_RIGHTS = new Set([
  'cc0',
  'generated_by_ai_from_template',
  'original',
  'public_domain',
  'test_generated',
  'user_provided_for_repository_test_use',
  'user_provided_with_repository_test_rights',
])

function normalizeKind(kind = '') {
  return String(kind || '').trim().replace(/-/g, '_')
}

function normalizeProfile(profile = '') {
  return String(profile || '').trim()
}

function normalizeSampleId(id = '') {
  return String(id || '').trim()
}

function normalizeSourceRights(sourceRights = '') {
  return String(sourceRights || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function pathInside(baseDir, filePath) {
  const base = path.resolve(baseDir)
  const resolved = path.resolve(filePath)
  return resolved === base || resolved.startsWith(`${base}${path.sep}`)
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

function extensionForFormat(format) {
  return FORMAT_EXTENSIONS[String(format || '').toLowerCase()] ?? null
}

function extensionForPath(filePath) {
  return path.extname(String(filePath || '')).replace(/^\./, '').toLowerCase()
}

function extensionMatchesFormat(filePath, format) {
  const expected = extensionForFormat(format)
  const actual = extensionForPath(filePath)
  if (!expected) return false
  if (expected === 'jpg') return actual === 'jpg' || actual === 'jpeg'
  return actual === expected
}

async function imageInfo(buffer) {
  const metadata = await sharp(buffer).metadata()
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error('image metadata is incomplete')
  }
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function summarizeIssues(issues) {
  const errors = issues.filter((item) => item.severity === 'error').length
  const warnings = issues.filter((item) => item.severity === 'warning').length
  return {
    status: errors ? 'fail' : warnings ? 'warning' : 'pass',
    errors,
    warnings,
    total_issues: issues.length,
  }
}

export function isRepositorySafeSourceRights(sourceRights) {
  return REPOSITORY_SAFE_SOURCE_RIGHTS.has(normalizeSourceRights(sourceRights))
}

export function repositorySafeSourceRightsValues() {
  return [...REPOSITORY_SAFE_SOURCE_RIGHTS].sort()
}

function manifestDirectory(manifestPath) {
  return path.dirname(path.resolve(manifestPath))
}

export async function readLocalImageManifest(manifestPath = DEFAULT_LOCAL_IMAGE_MANIFEST) {
  const resolvedManifest = path.resolve(manifestPath)
  return {
    path: resolvedManifest,
    baseDir: manifestDirectory(resolvedManifest),
    manifest: JSON.parse(await readFile(resolvedManifest, 'utf8')),
  }
}

export async function validateLocalImageManifest({
  manifestPath = DEFAULT_LOCAL_IMAGE_MANIFEST,
} = {}) {
  const { path: resolvedManifest, baseDir, manifest } = await readLocalImageManifest(manifestPath)
  const issues = []
  const samples = Array.isArray(manifest.samples) ? manifest.samples : []
  if (!Number.isInteger(manifest.schema_version)) {
    issues.push(issue(null, 'error', 'manifest.schema_version_missing', 'manifest.schema_version must be an integer'))
  }
  if (!Array.isArray(manifest.samples)) {
    issues.push(issue(null, 'error', 'manifest.samples_missing', 'manifest.samples must be an array'))
  }

  const seenIds = new Set()
  const items = []
  for (const sample of samples) {
    const id = normalizeSampleId(sample.id)
    const kind = normalizeKind(sample.kind)
    const profile = normalizeProfile(sample.profile)
    const sampleIssues = []
    if (!id) sampleIssues.push(issue(null, 'error', 'sample.id_missing', 'sample id is required'))
    if (id && !/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
      sampleIssues.push(issue(id, 'error', 'sample.id_invalid', 'sample id must be lowercase letters, numbers, underscores, or hyphens'))
    }
    if (id && seenIds.has(id)) sampleIssues.push(issue(id, 'error', 'sample.id_duplicate', `duplicate sample id: ${id}`))
    if (id) seenIds.add(id)
    if (!VALID_KINDS.has(kind)) sampleIssues.push(issue(id, 'error', 'sample.kind_invalid', `unsupported sample kind: ${sample.kind ?? ''}`))
    if (!VALID_PROFILES.has(profile)) sampleIssues.push(issue(id, 'error', 'sample.profile_invalid', `unsupported sample profile: ${sample.profile ?? ''}`))
    if (!sample.source_rights) {
      sampleIssues.push(issue(id, 'error', 'sample.source_rights_missing', 'sample source_rights is required'))
    } else if (!isRepositorySafeSourceRights(sample.source_rights)) {
      sampleIssues.push(issue(
        id,
        'error',
        'sample.source_rights_not_repository_safe',
        'sample source_rights must be repository-safe and publishable',
        { source_rights: sample.source_rights }
      ))
    }
    if (!Array.isArray(sample.expected_checks)) sampleIssues.push(issue(id, 'warning', 'sample.expected_checks_missing', 'sample expected_checks should be an array'))
    if (!sample.file) {
      sampleIssues.push(issue(id, 'error', 'sample.file_missing', 'sample file is required'))
    } else {
      const filePath = path.resolve(baseDir, sample.file)
      if (!pathInside(baseDir, filePath)) {
        sampleIssues.push(issue(id, 'error', 'sample.file_outside_manifest_dir', 'sample file must stay inside the manifest directory', { file: sample.file }))
      } else {
        try {
          const buffer = await readFile(filePath)
          const info = await imageInfo(buffer)
          const hash = sha256(buffer)
          if (!extensionMatchesFormat(filePath, info.format)) {
            sampleIssues.push(issue(id, 'error', 'sample.file_extension_mismatch', 'sample file extension does not match encoded image format', {
              file: sample.file,
              format: info.format,
              expected_extension: extensionForFormat(info.format),
            }))
          }
          if (!sample.sha256) sampleIssues.push(issue(id, 'warning', 'sample.sha256_missing', 'sample sha256 should be recorded'))
          if (sample.sha256 && sample.sha256 !== hash) {
            sampleIssues.push(issue(id, 'error', 'sample.sha256_mismatch', 'sample sha256 does not match file content'))
          }
          if (!sample.image) sampleIssues.push(issue(id, 'warning', 'sample.image_metadata_missing', 'sample image metadata should be recorded'))
          if (sample.image?.width && Number(sample.image.width) !== info.width) sampleIssues.push(issue(id, 'error', 'sample.image_width_mismatch', 'sample image.width does not match file content'))
          if (sample.image?.height && Number(sample.image.height) !== info.height) sampleIssues.push(issue(id, 'error', 'sample.image_height_mismatch', 'sample image.height does not match file content'))
          if (sample.image?.format && sample.image.format !== info.format) sampleIssues.push(issue(id, 'error', 'sample.image_format_mismatch', 'sample image.format does not match file content'))
          items.push({
            id,
            file: sample.file,
            kind,
            profile,
            status: sampleIssues.some((item) => item.severity === 'error') ? 'fail' : sampleIssues.some((item) => item.severity === 'warning') ? 'warning' : 'pass',
            image: info,
            sha256: hash,
            issues: sampleIssues,
          })
        } catch (error) {
          sampleIssues.push(issue(id, 'error', 'sample.file_unreadable', error.message ?? 'sample file cannot be read', { file: sample.file }))
          items.push({
            id,
            file: sample.file,
            kind,
            profile,
            status: 'fail',
            image: null,
            sha256: null,
            issues: sampleIssues,
          })
        }
      }
    }
    issues.push(...sampleIssues)
    if (!items.some((item) => item.id === id)) {
      items.push({
        id,
        file: sample.file ?? null,
        kind,
        profile,
        status: sampleIssues.some((item) => item.severity === 'error') ? 'fail' : sampleIssues.some((item) => item.severity === 'warning') ? 'warning' : 'pass',
        image: null,
        sha256: null,
        issues: sampleIssues,
      })
    }
  }

  return {
    schema_version: 1,
    mode: 'provider_free_manifest_validation',
    manifest: {
      path: resolvedManifest,
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

function directoryForKind(manifest, kind) {
  return manifest.directories?.[kind] ?? DEFAULT_DIRECTORIES[kind]
}

function sampleRelativeFile({ manifest, kind, id, format }) {
  const directory = directoryForKind(manifest, kind)
  const extension = extensionForFormat(format)
  if (!directory) throw new Error(`Unsupported local image kind: ${kind}`)
  if (!extension) throw new Error(`Unsupported local image format: ${format}`)
  return path.posix.join(directory, `${id}.${extension}`)
}

export async function addLocalImageSample({
  manifestPath = DEFAULT_LOCAL_IMAGE_MANIFEST,
  input,
  id,
  kind,
  profile,
  sourceRights,
  expectedChecks = [],
  expectedStatus,
  notes = '',
} = {}) {
  if (!input) throw new Error('local image add requires --input')
  const normalizedId = normalizeSampleId(id)
  const normalizedKind = normalizeKind(kind)
  const normalizedProfile = normalizeProfile(profile)
  if (!normalizedId) throw new Error('local image add requires --id')
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalizedId)) throw new Error('--id must be lowercase letters, numbers, underscores, or hyphens')
  if (!VALID_KINDS.has(normalizedKind)) throw new Error(`Unsupported --kind: ${kind}`)
  if (!VALID_PROFILES.has(normalizedProfile)) throw new Error(`Unsupported --profile: ${profile}`)
  if (!sourceRights) throw new Error('local image add requires --source-rights')
  if (!isRepositorySafeSourceRights(sourceRights)) {
    throw new Error(`--source-rights must be repository-safe; expected one of: ${repositorySafeSourceRightsValues().join(', ')}`)
  }

  const { path: resolvedManifest, baseDir, manifest } = await readLocalImageManifest(manifestPath)
  const samples = Array.isArray(manifest.samples) ? manifest.samples : []
  if (samples.some((sample) => sample.id === normalizedId)) throw new Error(`local image sample already exists: ${normalizedId}`)

  const inputBuffer = await readFile(String(input))
  const info = await imageInfo(inputBuffer)
  const hash = sha256(inputBuffer)
  const relativeFile = sampleRelativeFile({ manifest, kind: normalizedKind, id: normalizedId, format: info.format })
  const destination = path.resolve(baseDir, relativeFile)
  if (!pathInside(baseDir, destination)) throw new Error('local image destination must stay inside the manifest directory')

  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(String(input), destination, constants.COPYFILE_EXCL)

  const sample = {
    id: normalizedId,
    file: relativeFile,
    kind: normalizedKind,
    profile: normalizedProfile,
    source_rights: String(sourceRights),
    sha256: hash,
    image: info,
    expected_checks: expectedChecks.map(String),
    ...(expectedStatus ? { expected_status: String(expectedStatus) } : {}),
    ...(notes ? { notes: String(notes) } : {}),
  }
  const nextManifest = {
    ...manifest,
    samples: [...samples, sample],
  }
  await writeFile(resolvedManifest, `${JSON.stringify(nextManifest, null, 2)}\n`)
  const validation = await validateLocalImageManifest({ manifestPath: resolvedManifest })
  return {
    schema_version: 1,
    mode: 'local_image_sample_added',
    manifest: resolvedManifest,
    sample,
    destination,
    validation: validation.summary,
  }
}
