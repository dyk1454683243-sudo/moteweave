import test from 'node:test'
import assert from 'node:assert/strict'

import JSZip from 'jszip'

import {
  buildTwoPointFiveDExternalImportSmoke,
  buildTwoPointFiveDExternalRoundtripValidation,
  buildTwoPointFiveDExternalToolProbe,
  detectTwoPointFiveDExternalTools,
  renderTwoPointFiveDExternalRoundtripChecklistMarkdown,
} from '../../src/two-point-five-d/externalRoundtripValidation.js'

async function buildReleaseZip({ omitStrictAtlas = false } = {}) {
  const zip = new JSZip()
  if (!omitStrictAtlas) zip.file('strict_atlas.png', Buffer.from('png-placeholder'))
  zip.file('runtime_padded_atlas.png', Buffer.from('png-placeholder'))
  zip.file('project.ldtk', JSON.stringify({ defs: { tilesets: [{ relPath: 'strict_atlas.png' }] } }))
  zip.file('tileset.tiled.json', JSON.stringify({ type: 'tileset', image: 'strict_atlas.png' }))
  zip.file('tileset.tsx', '<tileset><image source="strict_atlas.png"/></tileset>')
  zip.file('metadata/metadata.json', JSON.stringify({ schema_version: 1 }))
  zip.file('validation/consumer_package_audit.json', JSON.stringify({ status: 'pass' }))
  zip.file('validation/import_validation.json', JSON.stringify({ status: 'pass' }))
  zip.file('release_demo_manifest.json', JSON.stringify({ release_ready: true }))
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

test('external tool probe records availability without launching tools or leaking local paths', async () => {
  const tools = await detectTwoPointFiveDExternalTools({
    env: { PATH: '/opt/example/bin', HOME: '/Users/local-user' },
    platform: 'darwin',
    exists: async (filePath) => filePath === '/opt/example/bin/ldtk' || filePath === '/Applications/Tiled.app',
  })
  const probe = await buildTwoPointFiveDExternalToolProbe({ tools, platform: 'darwin' })

  assert.equal(probe.mode, 'two_point_five_d_external_tool_probe_v1')
  assert.equal(probe.status, 'pass')
  assert.deepEqual(probe.availability.detected_tool_ids.sort(), ['ldtk', 'tiled'])
  assert.equal(probe.tools.find((tool) => tool.id === 'ldtk').command_found, true)
  assert.equal(probe.tools.find((tool) => tool.id === 'tiled').app_found, true)
  assert.equal(JSON.stringify(probe).includes('/Users/local-user'), false)
  assert.match(probe.claim_boundary, /does not install, launch, import, save, or round-trip/)
})

test('external import smoke validates packed editor references and prepares manual round-trip evidence', async () => {
  const externalToolProbe = await buildTwoPointFiveDExternalToolProbe({
    tools: [
      { id: 'ldtk', label: 'LDtk', status: 'unavailable', command_found: false, app_found: false, location_kinds: [], consumes: [] },
      { id: 'tiled', label: 'Tiled', status: 'unavailable', command_found: false, app_found: false, location_kinds: [], consumes: [] },
    ],
  })
  const smoke = await buildTwoPointFiveDExternalImportSmoke({
    releaseDemoPackZip: await buildReleaseZip(),
    externalToolProbe,
  })
  const roundtrip = buildTwoPointFiveDExternalRoundtripValidation({
    externalToolProbe,
    externalImportSmoke: smoke,
    packageAudit: { status: 'pass' },
    importValidation: { status: 'pass' },
  })
  const checklist = renderTwoPointFiveDExternalRoundtripChecklistMarkdown(roundtrip)

  assert.equal(externalToolProbe.status, 'not_run')
  assert.equal(smoke.mode, 'two_point_five_d_external_import_smoke_v1')
  assert.equal(smoke.status, 'pass')
  assert.equal(smoke.static_package.reference_checks.every((item) => item.status === 'pass'), true)
  assert.equal(smoke.external_tool_smoke.status, 'not_run')
  assert.equal(roundtrip.mode, 'two_point_five_d_external_roundtrip_validation_v1')
  assert.equal(roundtrip.status, 'not_run')
  assert.equal(roundtrip.ready_for_manual_roundtrip, true)
  assert.equal(roundtrip.release_blocking, false)
  assert.match(checklist, /Open project\.ldtk/)
})

test('external import smoke fails when required packed editor payloads are missing', async () => {
  const smoke = await buildTwoPointFiveDExternalImportSmoke({
    releaseDemoPackZip: await buildReleaseZip({ omitStrictAtlas: true }),
  })
  const roundtrip = buildTwoPointFiveDExternalRoundtripValidation({
    externalImportSmoke: smoke,
    packageAudit: { status: 'pass' },
    importValidation: { status: 'pass' },
  })

  assert.equal(smoke.status, 'fail')
  assert.ok(smoke.blocking_errors.includes('missing_release_demo_entry:strict_atlas.png'))
  assert.ok(smoke.blocking_errors.includes('tiled_json_image_reference_failed'))
  assert.equal(roundtrip.status, 'fail')
  assert.equal(roundtrip.ready_for_manual_roundtrip, false)
  assert.equal(roundtrip.release_blocking, true)
})
