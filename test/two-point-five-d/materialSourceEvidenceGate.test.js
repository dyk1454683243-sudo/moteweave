import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import {
  runMaterialSourceEvidenceGate,
  validateMaterialSourceEvidenceManifest,
} from '../../src/two-point-five-d/materialSourceEvidenceGate.js'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function writeTexturedSource(filePath) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" shape-rendering="crispEdges">',
    '<rect x="0" y="0" width="342" height="512" fill="#2f8f3f"/>',
    '<rect x="32" y="32" width="48" height="48" fill="#9edb75"/>',
    '<rect x="342" y="0" width="341" height="512" fill="#7a5435"/>',
    '<rect x="390" y="40" width="48" height="48" fill="#3f2d21"/>',
    '<rect x="683" y="0" width="341" height="512" fill="#b6d46d"/>',
    '<rect x="732" y="42" width="48" height="48" fill="#eff0a0"/>',
    '<rect x="0" y="512" width="342" height="512" fill="#67b04f"/>',
    '<rect x="36" y="560" width="48" height="48" fill="#376a30"/>',
    '<rect x="342" y="512" width="341" height="512" fill="#8f7f45"/>',
    '<rect x="390" y="560" width="48" height="48" fill="#c7d66c"/>',
    '<rect x="683" y="512" width="341" height="512" fill="#1d2119"/>',
    '<rect x="732" y="560" width="48" height="48" fill="#4c5640"/>',
    '</svg>',
  ].join('')
  await sharp(Buffer.from(svg)).png().toFile(filePath)
}

async function writeFlatSource(filePath) {
  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: '#777777ff',
    },
  })
    .png()
    .toFile(filePath)
}

async function writeManifest(dir) {
  await writeTexturedSource(path.join(dir, 'textured-source.png'))
  await writeFlatSource(path.join(dir, 'flat-source.png'))
  const manifestPath = path.join(dir, 'material-source-manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'two_point_five_d_material_source_gate_test',
      samples: [
        {
          id: 'textured_source',
          file: 'textured-source.png',
          source_rights: 'test_generated',
          expected_status: 'pass',
        },
        {
          id: 'flat_source',
          file: 'flat-source.png',
          source_rights: 'test_generated',
          expected_status: 'warning',
        },
      ],
    }, null, 2)
  )
  return manifestPath
}

test('validateMaterialSourceEvidenceManifest verifies local 2.5D material source samples', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-manifest-'))
  const manifestPath = await writeManifest(dir)
  const validation = await validateMaterialSourceEvidenceManifest({ manifestPath })

  assert.equal(validation.mode, 'two_point_five_d_material_source_manifest_v1')
  assert.equal(validation.summary.status, 'pass')
  assert.equal(validation.summary.total, 2)
  assert.equal(validation.items[0].image.width, 1024)
  assert.equal(validation.items[0].source_rights, 'test_generated')
  assert.match(validation.items[0].sha256, /^[a-f0-9]{64}$/)
})

test('runMaterialSourceEvidenceGate writes report, per-sample artifacts, and contact sheets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-evidence-'))
  const manifestPath = await writeManifest(dir)
  const outputDir = path.join(dir, 'evidence-output')
  const report = await runMaterialSourceEvidenceGate({
    manifestPath,
    outputDir,
    runId: 'evidence_gate_run',
  })

  assert.equal(report.mode, 'two_point_five_d_material_source_evidence_gate_v1')
  assert.equal(report.quality_gate.status, 'warning')
  assert.equal(report.summary.total, 2)
  assert.equal(report.summary.validation.pass, 1)
  assert.equal(report.summary.validation.warning, 1)
  assert.equal(report.summary.usable_rate, 1)
  assert.equal(report.quality_closure.mode, 'two_point_five_d_material_source_quality_closure_v1')
  assert.equal(report.quality_closure.status, 'not_ready')
  assert.equal(report.quality_closure.release_ready, false)
  assert.equal(report.quality_closure.release_readiness.deterministic_blocker_count, 0)
  assert.equal(report.quality_closure.prioritized_samples[0].id, 'flat_source')
  assert.ok(report.quality_closure.issue_groups.some((item) => item.family === 'patch_texture_detail'))
  assert.ok(report.quality_closure.top_actions.some((item) => item.id === 'improve_patch_texture_detail'))
  assert.equal(report.items.find((item) => item.id === 'textured_source').status, 'pass')
  assert.equal(report.items.find((item) => item.id === 'flat_source').status, 'warning')
  assert.equal(report.items.find((item) => item.id === 'flat_source').expectation_met, true)
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.layout_selected_id, 'six_region_material_grid_v0')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.layout_candidate_count, 3)
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.rule_map_status, 'pass')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.rule_map_edge_mismatch_count, 0)
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.constraint_solver_status, 'pass')
  assert.ok(report.items.find((item) => item.id === 'textured_source').metrics.constraint_solver_decision_count >= 0)
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.map_editor_workflow_status, 'pass')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.map_editor_changed_cell_count, 0)
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.ldtk_project_status, 'pass')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.ldtk_auto_layer_rule_count, 16)
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.ldtk_workflow_validation_status, 'pass')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.workflow_release_evidence_status, 'warning')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.workflow_release_ready, true)
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.consumer_package_audit_status, 'pass')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.import_validation_status, 'pass')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.release_demo_pack_status, 'warning')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.release_demo_ready, true)
  assert.ok(['not_run', 'pass'].includes(report.items.find((item) => item.id === 'textured_source').metrics.external_tool_probe_status))
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.external_import_smoke_status, 'pass')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.external_roundtrip_validation_status, 'not_run')
  assert.equal(report.items.find((item) => item.id === 'textured_source').metrics.external_roundtrip_ready, true)
  assert.equal(report.items.find((item) => item.id === 'textured_source').material_source.layout_selection.mode, 'semantic_material_layout_assist_v1')
  assert.equal(report.items.find((item) => item.id === 'textured_source').material_source.semantic_slot_selection.mode, 'semantic_slot_extraction_v1')
  assert.equal(report.items.find((item) => item.id === 'textured_source').material_source.semantic_slot_selection.slots.length, 7)
  assert.ok(report.items.find((item) => item.id === 'textured_source').material_source.semantic_slot_selection.candidate_count >= 6)
  assert.equal(report.items.find((item) => item.id === 'textured_source').material_source.slot_separation.status, 'pass')
  assert.equal(report.items.find((item) => item.id === 'textured_source').material_source.extraction.palette_limit.status, 'active')
  assert.equal(report.items.find((item) => item.id === 'textured_source').material_source.extraction.tileability.status, 'active')
  assert.equal(report.items.find((item) => item.id === 'flat_source').material_source.slot_separation.status, 'active')
  assert.equal(report.items.find((item) => item.id === 'flat_source').material_source.slot_separation.initial_warning_count, 15)
  assert.equal(report.items.find((item) => item.id === 'flat_source').material_source.slot_separation.remaining_warning_count, 0)
  assert.ok(report.summary.failure_taxonomy.top_categories.some((item) => item.id.includes('material_patch_low_color_variety')))

  const runDir = path.join(outputDir, 'evidence_gate_run')
  assert.equal(await exists(path.join(runDir, 'material_source_evidence_gate.json')), true)
  assert.equal(await exists(path.join(runDir, 'material_source_evidence_gate.md')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'strict_atlas.png')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'material_patches.png')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'material_layout_candidates.png')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'material_slot_candidates.png')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'rule_map_preview.png')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'map_editor_preview.png')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'map_editor_workflow.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'constraint_solver_report.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'tile_map.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'project.ldtk')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'ldtk_auto_layer_rules.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'ldtk_workflow_validation.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'workflow_release_evidence.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'workflow_release_evidence.md')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'consumer_package_audit.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'import_validation.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'release_demo_manifest.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'release_demo_README.md')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'release_demo_pack.zip')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'external_tool_probe.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'external_import_smoke.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'external_roundtrip_validation.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'external_roundtrip_checklist.md')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'textured_source', 'evidence_contact_sheet.png')), true)

  const contactMeta = await sharp(path.join(runDir, 'items', 'textured_source', 'evidence_contact_sheet.png')).metadata()
  assert.deepEqual({ width: contactMeta.width, height: contactMeta.height, format: contactMeta.format }, { width: 1008, height: 236, format: 'png' })
  const persisted = JSON.parse(await readFile(path.join(runDir, 'material_source_evidence_gate.json'), 'utf8'))
  assert.equal(persisted.items[0].artifacts.evidence_contact_sheet_png.includes('evidence_contact_sheet.png'), true)
  assert.equal(persisted.items[0].artifacts.rule_map_preview_png.includes('rule_map_preview.png'), true)
  assert.equal(persisted.items[0].artifacts.map_editor_preview_png.includes('map_editor_preview.png'), true)
  assert.equal(persisted.items[0].artifacts.map_editor_workflow_json.includes('map_editor_workflow.json'), true)
  assert.equal(persisted.items[0].artifacts.constraint_solver_report_json.includes('constraint_solver_report.json'), true)
  assert.equal(persisted.items[0].artifacts.ldtk_project.includes('project.ldtk'), true)
  assert.equal(persisted.items[0].artifacts.ldtk_auto_layer_rules_json.includes('ldtk_auto_layer_rules.json'), true)
  assert.equal(persisted.items[0].artifacts.ldtk_workflow_validation_json.includes('ldtk_workflow_validation.json'), true)
  assert.equal(persisted.items[0].artifacts.workflow_release_evidence_json.includes('workflow_release_evidence.json'), true)
  assert.equal(persisted.items[0].artifacts.consumer_package_audit_json.includes('consumer_package_audit.json'), true)
  assert.equal(persisted.items[0].artifacts.import_validation_json.includes('import_validation.json'), true)
  assert.equal(persisted.items[0].artifacts.release_demo_manifest_json.includes('release_demo_manifest.json'), true)
  assert.equal(persisted.items[0].artifacts.release_demo_pack_zip.includes('release_demo_pack.zip'), true)
  assert.equal(persisted.items[0].artifacts.external_tool_probe_json.includes('external_tool_probe.json'), true)
  assert.equal(persisted.items[0].artifacts.external_import_smoke_json.includes('external_import_smoke.json'), true)
  assert.equal(persisted.items[0].artifacts.external_roundtrip_validation_json.includes('external_roundtrip_validation.json'), true)
  assert.equal(persisted.items[0].artifacts.external_roundtrip_checklist_md.includes('external_roundtrip_checklist.md'), true)
  assert.equal(persisted.items[0].artifacts.material_slot_candidates_png.includes('material_slot_candidates.png'), true)
  assert.equal(persisted.items[0].material_source.semantic_slot_selection.mode, 'semantic_slot_extraction_v1')
  assert.equal(persisted.items[0].material_source.slot_separation.mode, 'material_slot_separation_v1')
  assert.equal(persisted.items[0].material_source.extraction.tileability.status, 'active')
  assert.match(await readFile(path.join(runDir, 'material_source_evidence_gate.md'), 'utf8'), /2\.5D Material Source Evidence Gate/)
  assert.match(await readFile(path.join(runDir, 'material_source_evidence_gate.md'), 'utf8'), /Quality Closure/)
  assert.match(await readFile(path.join(runDir, 'material_source_evidence_gate.md'), 'utf8'), /Layout/)
})
