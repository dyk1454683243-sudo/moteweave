import { access } from 'node:fs/promises'
import path from 'node:path'

import JSZip from 'jszip'

export const TWO_POINT_FIVE_D_EXTERNAL_TOOL_PROBE_MODE = 'two_point_five_d_external_tool_probe_v1'
export const TWO_POINT_FIVE_D_EXTERNAL_IMPORT_SMOKE_MODE = 'two_point_five_d_external_import_smoke_v1'
export const TWO_POINT_FIVE_D_EXTERNAL_ROUNDTRIP_VALIDATION_MODE = 'two_point_five_d_external_roundtrip_validation_v1'

const SUPPORTED_EXTERNAL_TOOLS = Object.freeze([
  {
    id: 'ldtk',
    label: 'LDtk',
    commands: Object.freeze(['ldtk']),
    mac_apps: Object.freeze(['LDtk.app']),
    consumes: Object.freeze(['project.ldtk', 'strict_atlas.png']),
  },
  {
    id: 'tiled',
    label: 'Tiled',
    commands: Object.freeze(['tiled']),
    mac_apps: Object.freeze(['Tiled.app']),
    consumes: Object.freeze(['tileset.tiled.json', 'tileset.tsx', 'strict_atlas.png']),
  },
])

const REQUIRED_RELEASE_DEMO_ENTRIES = Object.freeze([
  'strict_atlas.png',
  'runtime_padded_atlas.png',
  'project.ldtk',
  'tileset.tiled.json',
  'tileset.tsx',
  'metadata/metadata.json',
  'validation/consumer_package_audit.json',
  'validation/import_validation.json',
  'release_demo_manifest.json',
])

const JSON_RELEASE_DEMO_ENTRIES = Object.freeze([
  'project.ldtk',
  'tileset.tiled.json',
  'metadata/metadata.json',
  'validation/consumer_package_audit.json',
  'validation/import_validation.json',
  'release_demo_manifest.json',
])

async function defaultExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function pathEntries(env = {}) {
  return String(env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function executableNames(command, platform, env = {}) {
  if (platform !== 'win32') return [command]
  const pathExt = String(env.PATHEXT ?? '.EXE;.CMD;.BAT')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
  const names = new Set([command])
  for (const extension of pathExt) names.add(`${command}${extension}`)
  return [...names]
}

function commandCandidates(command, { env = {}, platform = process.platform } = {}) {
  const names = executableNames(command, platform, env)
  return pathEntries(env).flatMap((entry) => names.map((name) => path.join(entry, name)))
}

function appCandidates(appName, { env = {}, platform = process.platform } = {}) {
  if (platform !== 'darwin') return []
  const home = env.HOME ? String(env.HOME) : null
  return [
    path.join('/Applications', appName),
    home ? path.join(home, 'Applications', appName) : null,
  ].filter(Boolean)
}

async function anyExists(paths, exists) {
  for (const filePath of paths) {
    if (await exists(filePath)) return true
  }
  return false
}

export async function detectTwoPointFiveDExternalTools({
  env = process.env,
  platform = process.platform,
  exists = defaultExists,
  toolDefinitions = SUPPORTED_EXTERNAL_TOOLS,
} = {}) {
  const tools = []
  for (const definition of toolDefinitions) {
    const commandFound = await anyExists(
      definition.commands.flatMap((command) => commandCandidates(command, { env, platform })),
      exists,
    )
    const appFound = await anyExists(
      definition.mac_apps.flatMap((appName) => appCandidates(appName, { env, platform })),
      exists,
    )
    tools.push({
      id: definition.id,
      label: definition.label,
      status: commandFound || appFound ? 'detected' : 'unavailable',
      command_found: commandFound,
      app_found: appFound,
      location_kinds: [
        commandFound ? 'path_command' : null,
        appFound ? 'application_bundle' : null,
      ].filter(Boolean),
      consumes: [...definition.consumes],
      launch_policy: 'manual_or_explicit_opt_in_only',
    })
  }
  return tools
}

export async function buildTwoPointFiveDExternalToolProbe(options = {}) {
  const platform = options.platform ?? process.platform
  const tools = options.tools ?? (await detectTwoPointFiveDExternalTools({ ...options, platform }))
  const detectedTools = tools.filter((tool) => tool.status === 'detected')
  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_EXTERNAL_TOOL_PROBE_MODE,
    status: detectedTools.length ? 'pass' : 'not_run',
    availability: {
      supported_tool_count: tools.length,
      detected_count: detectedTools.length,
      detected_tool_ids: detectedTools.map((tool) => tool.id),
      detection_scope: [
        'PATH command presence',
        platform === 'darwin' ? 'macOS Applications folders' : null,
      ].filter(Boolean),
    },
    tools,
    blocking_errors: [],
    warnings: detectedTools.length ? [] : ['no_supported_external_editor_detected'],
    claim_boundary: 'Local external editor availability probe only; it records detection signals and does not install, launch, import, save, or round-trip editor files.',
  }
}

function zipEntryNames(zip) {
  return new Set(Object.keys(zip.files).filter((name) => !zip.files[name].dir))
}

async function parseZipJson(zip, entryName, blockingErrors) {
  const file = zip.file(entryName)
  if (!file) return null
  try {
    return JSON.parse(await file.async('string'))
  } catch {
    blockingErrors.push(`invalid_json:${entryName}`)
    return null
  }
}

function referenceCheck({ source, ref, entries, code }) {
  if (!ref || ref.startsWith('/') || ref.startsWith('file:') || ref.includes('..')) {
    return { code, source, ref: ref ?? null, target: null, status: 'fail' }
  }
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), ref))
  return { code, source, ref, target, status: entries.has(target) ? 'pass' : 'fail' }
}

export async function buildTwoPointFiveDExternalImportSmoke({
  releaseDemoPackZip,
  externalToolProbe = null,
} = {}) {
  const blockingErrors = []
  const warnings = []
  if (!releaseDemoPackZip) blockingErrors.push('release_demo_pack_zip_missing')
  const zip = releaseDemoPackZip ? await JSZip.loadAsync(releaseDemoPackZip) : new JSZip()
  const entries = zipEntryNames(zip)
  const requiredEntries = REQUIRED_RELEASE_DEMO_ENTRIES.map((entry) => ({
    package_path: entry,
    status: entries.has(entry) ? 'pass' : 'fail',
  }))
  for (const entry of requiredEntries) {
    if (entry.status !== 'pass') blockingErrors.push(`missing_release_demo_entry:${entry.package_path}`)
  }

  const parsedJson = {}
  for (const entry of JSON_RELEASE_DEMO_ENTRIES) {
    parsedJson[entry] = await parseZipJson(zip, entry, blockingErrors)
  }

  const tiledJson = parsedJson['tileset.tiled.json']
  const ldtkProject = parsedJson['project.ldtk']
  const tiledTsx = zip.file('tileset.tsx') ? await zip.file('tileset.tsx').async('string') : ''
  const tsxImage = tiledTsx.match(/<image\s+source="([^"]+)"/u)?.[1] ?? null
  const ldtkTilesetRelPath = ldtkProject?.defs?.tilesets?.[0]?.relPath ?? null
  const referenceChecks = [
    referenceCheck({
      source: 'tileset.tiled.json',
      ref: tiledJson?.image,
      entries,
      code: 'tiled_json_image_reference',
    }),
    referenceCheck({
      source: 'tileset.tsx',
      ref: tsxImage,
      entries,
      code: 'tiled_tsx_image_reference',
    }),
    referenceCheck({
      source: 'project.ldtk',
      ref: ldtkTilesetRelPath,
      entries,
      code: 'ldtk_tileset_rel_path',
    }),
  ]
  for (const check of referenceChecks) {
    if (check.status !== 'pass') blockingErrors.push(`${check.code}_failed`)
  }

  const toolProbe = externalToolProbe ?? {
    status: 'not_run',
    availability: { detected_count: 0, detected_tool_ids: [] },
    tools: [],
  }
  const detectedCount = toolProbe.availability?.detected_count ?? 0
  const staticStatus = blockingErrors.length ? 'fail' : 'pass'

  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_EXTERNAL_IMPORT_SMOKE_MODE,
    status: staticStatus,
    release_blocking: blockingErrors.length > 0,
    blocking_errors: [...new Set(blockingErrors)],
    warnings,
    static_package: {
      status: staticStatus,
      checked_entry_count: REQUIRED_RELEASE_DEMO_ENTRIES.length,
      present_entry_count: requiredEntries.filter((entry) => entry.status === 'pass').length,
      required_entries: requiredEntries,
      json_entries_checked: JSON_RELEASE_DEMO_ENTRIES.length,
      reference_checks: referenceChecks,
    },
    external_tool_smoke: {
      status: 'not_run',
      detected_tool_count: detectedCount,
      detected_tool_ids: toolProbe.availability?.detected_tool_ids ?? [],
      reason: detectedCount
        ? 'external_editor_launch_requires_explicit_manual_or_future_automation_run'
        : 'no_supported_external_editor_detected',
    },
    claim_boundary: 'Static external import smoke for the portable release package. It parses packed editor files and validates references, but does not launch an editor or claim a saved round-trip.',
  }
}

export function buildTwoPointFiveDExternalRoundtripValidation({
  externalToolProbe = null,
  externalImportSmoke = null,
  packageAudit = null,
  importValidation = null,
} = {}) {
  const blockingErrors = []
  if (externalImportSmoke?.status === 'fail') blockingErrors.push('external_import_smoke_failed')
  if (packageAudit?.status === 'fail') blockingErrors.push('consumer_package_audit_failed')
  if (importValidation?.status === 'fail') blockingErrors.push('import_validation_failed')

  const detectedCount = externalToolProbe?.availability?.detected_count ?? 0
  const readyForManualRoundtrip = blockingErrors.length === 0 && externalImportSmoke?.status === 'pass'
  const reason = blockingErrors.length
    ? 'blocking_static_validation_failed'
    : detectedCount
      ? 'supported_external_editor_detected_but_roundtrip_launch_not_run'
      : 'no_supported_external_editor_detected'

  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_EXTERNAL_ROUNDTRIP_VALIDATION_MODE,
    status: blockingErrors.length ? 'fail' : 'not_run',
    release_blocking: blockingErrors.length > 0,
    ready_for_manual_roundtrip: readyForManualRoundtrip,
    blocking_errors: [...new Set(blockingErrors)],
    warnings: readyForManualRoundtrip && !detectedCount ? ['manual_roundtrip_waiting_for_supported_external_editor'] : [],
    prerequisite_statuses: {
      external_tool_probe: externalToolProbe?.status ?? 'not_run',
      external_import_smoke: externalImportSmoke?.status ?? 'not_run',
      consumer_package_audit: packageAudit?.status ?? 'not_run',
      import_validation: importValidation?.status ?? 'not_run',
    },
    automated_roundtrip: {
      status: 'not_run',
      reason,
      supported_tool_count: externalToolProbe?.availability?.supported_tool_count ?? 0,
      detected_tool_count: detectedCount,
      detected_tool_ids: externalToolProbe?.availability?.detected_tool_ids ?? [],
    },
    manual_checklist: [
      'Unzip release_demo_pack.zip into a temporary folder.',
      'Open project.ldtk in a supported LDtk editor and confirm strict_atlas.png renders without missing references.',
      'Open tileset.tiled.json or tileset.tsx in a supported Tiled editor and confirm tile dimensions, tile count, and image reference.',
      'Save a copy of the editor project without changing referenced atlas filenames.',
      'Re-run package audit/import validation against the saved copy before claiming external editor round-trip support.',
    ],
    claim_boundary: 'Round-trip evidence slot for generated 2.5D editor payloads. A not_run status is expected until an external editor is detected and an explicit manual or automated save/import cycle is performed.',
  }
}

export function renderTwoPointFiveDExternalRoundtripChecklistMarkdown(roundtripValidation = {}) {
  const checklist = (roundtripValidation.manual_checklist ?? [])
    .map((item) => `- [ ] ${item}`)
    .join('\n')
  return [
    '# External Editor Round-trip Checklist',
    '',
    `Status: ${roundtripValidation.status ?? 'unknown'}`,
    `Ready for manual round-trip: ${roundtripValidation.ready_for_manual_roundtrip ? 'yes' : 'no'}`,
    `Reason: ${roundtripValidation.automated_roundtrip?.reason ?? '-'}`,
    '',
    '## Checklist',
    '',
    checklist || '- [ ] No checklist entries recorded.',
    '',
    '## Boundary',
    '',
    roundtripValidation.claim_boundary ?? '-',
    '',
  ].join('\n')
}
