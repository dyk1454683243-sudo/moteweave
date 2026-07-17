import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

import { loadRgba } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import {
  FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
  QUALITY_GATE_CHARACTER_ARTIFACT_KEYS,
  createDefaultEditorProject,
  hashFrameRepairQualityGateValue,
  importCapturedCharacterRevisionForQualityGate,
  validateEditorProject,
} from '../../src/editor-project/index.js'
import {
  FRAME_REPAIR_QUALITY_GATE_CONTROL_IDS,
  buildFrameRepairQualityGateControls,
} from '../../src/editor-project/frameRepairQualityGateControls.js'

const FIXED_TIMESTAMP = '2026-07-12T00:00:00.000Z'
const CONTROL_SPECS = Object.freeze({
  control_outline_alpha: Object.freeze({
    assetId: 'asset_qg_control_outline_alpha',
    sourceJobId: 'quality_gate_control_outline_alpha_v1',
    warning: 'intentional_outline_alpha_defect',
  }),
  control_small_component: Object.freeze({
    assetId: 'asset_qg_control_small_component',
    sourceJobId: 'quality_gate_control_small_component_v1',
    warning: 'intentional_small_component_defect',
  }),
})

function artifactsByKey(captured) {
  return new Map(captured.artifacts.map((entry) => [entry.key, entry]))
}

function jsonArtifact(artifacts, key) {
  return JSON.parse(artifacts.get(key).content.toString('utf8'))
}

function controlDefaultFor(captured) {
  return FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS.find(
    (entry) => entry.assetId === captured.asset.id,
  )
}

function framePixel(image, frameIndex, x, y) {
  const frameX = (frameIndex % 8) * 96
  const frameY = Math.floor(frameIndex / 8) * 96
  const offset = ((frameY + y) * image.width + frameX + x) * 4
  return image.data.subarray(offset, offset + 4)
}

function changedFramePixels(image, targetFrameIndex, cleanFrameIndex) {
  const changed = []
  for (let y = 0; y < 96; y += 1) {
    for (let x = 0; x < 96; x += 1) {
      const target = framePixel(image, targetFrameIndex, x, y)
      const clean = framePixel(image, cleanFrameIndex, x, y)
      if (target.some((value, channel) => value !== clean[channel])) {
        changed.push({ x, y, target: [...target], clean: [...clean] })
      }
    }
  }
  return changed
}

test('exports the exact frozen control ids and builds deterministic captured bytes and digests with no inputs', async () => {
  assert.deepEqual(FRAME_REPAIR_QUALITY_GATE_CONTROL_IDS, [
    'control_outline_alpha',
    'control_small_component',
  ])
  assert.equal(Object.isFrozen(FRAME_REPAIR_QUALITY_GATE_CONTROL_IDS), true)
  assert.equal(buildFrameRepairQualityGateControls.length, 0)

  const first = await buildFrameRepairQualityGateControls()
  const second = await buildFrameRepairQualityGateControls()
  assert.equal(first.length, 2)
  assert.equal(second.length, 2)

  for (let index = 0; index < first.length; index += 1) {
    const left = first[index]
    const right = second[index]
    assert.equal(left.asset.id, CONTROL_SPECS[FRAME_REPAIR_QUALITY_GATE_CONTROL_IDS[index]].assetId)
    assert.equal(left.source_sha256, right.source_sha256)
    assert.deepEqual(left.artifacts.map(({ key, size, sha256: digest }) => ({ key, size, sha256: digest })),
      right.artifacts.map(({ key, size, sha256: digest }) => ({ key, size, sha256: digest })))
    assert.deepEqual(left.artifacts.map(({ content }) => content), right.artifacts.map(({ content }) => content))
    for (const entry of left.artifacts) {
      assert.equal(entry.size, entry.content.length)
      assert.equal(entry.sha256, createHash('sha256').update(entry.content).digest('hex'))
    }
    assert.equal(left.source_sha256, hashFrameRepairQualityGateValue(
      left.artifacts.map(({ key, size, sha256: digest }) => ({ key, size, sha256: digest })),
    ))
  }
})

test('each captured control is one fixed valid five-document TOPDOWN_RPG_V0 pack with 64 populated RGBA cells', async () => {
  const controls = await buildFrameRepairQualityGateControls()
  for (const captured of controls) {
    const control = controlDefaultFor(captured)
    assert.ok(control)
    const spec = CONTROL_SPECS[control.caseId]
    assert.deepEqual(captured.artifacts.map(({ key }) => key), QUALITY_GATE_CHARACTER_ARTIFACT_KEYS)
    assert.equal(Object.isFrozen(captured), true)
    assert.equal(Object.isFrozen(captured.asset), true)
    assert.equal(Object.isFrozen(captured.revision), true)
    assert.equal(captured.asset.profile, TOPDOWN_RPG_V0.id)
    assert.deepEqual(captured.asset.provenance, {
      source_type: 'local_procedural',
      provider: null,
      model: null,
    })
    assert.equal(captured.revision.source_job_id, spec.sourceJobId)
    assert.equal(captured.revision.quality_status, 'warning')
    assert.equal(captured.revision.production_status, 'review_required')
    assert.equal(captured.revision.has_processing_recipe, false)

    const artifacts = artifactsByKey(captured)
    const pngMetadata = await sharp(artifacts.get('sheet').content).metadata()
    assert.deepEqual({
      format: pngMetadata.format,
      width: pngMetadata.width,
      height: pngMetadata.height,
      channels: pngMetadata.channels,
      hasAlpha: pngMetadata.hasAlpha,
      pages: pngMetadata.pages ?? 1,
    }, { format: 'png', width: 768, height: 768, channels: 4, hasAlpha: true, pages: 1 })
    const image = await loadRgba(artifacts.get('sheet').content)
    for (let frameIndex = 0; frameIndex < 64; frameIndex += 1) {
      let populated = false
      for (let y = 0; y < 96 && !populated; y += 1) {
        for (let x = 0; x < 96; x += 1) {
          if (framePixel(image, frameIndex, x, y)[3] > 0) {
            populated = true
            break
          }
        }
      }
      assert.equal(populated, true, `frame ${frameIndex} must be populated`)
    }

    const animations = jsonArtifact(artifacts, 'animations')
    const metadata = jsonArtifact(artifacts, 'metadata')
    const editorMetadata = jsonArtifact(artifacts, 'editor_metadata')
    const debugReport = jsonArtifact(artifacts, 'debug_report')
    assert.equal(animations.profile, TOPDOWN_RPG_V0.id)
    assert.equal(metadata.profile, TOPDOWN_RPG_V0.id)
    assert.equal(editorMetadata.profile, TOPDOWN_RPG_V0.id)
    assert.equal(debugReport.profile, TOPDOWN_RPG_V0.id)
    assert.equal(metadata.created_at, FIXED_TIMESTAMP)
    assert.deepEqual(metadata.source, { type: 'local_procedural', input: null })
    assert.deepEqual(metadata.generation, { provider: null, model: null, prompt_file: null })
    assert.deepEqual(metadata.quality, {
      status: 'warning',
      warnings: [spec.warning],
      blocking_errors: [],
    })
    assert.equal(Object.keys(editorMetadata.frames).length, 64)
    assert.equal(debugReport.validation.status, 'warning')
    assert.deepEqual(debugReport.validation.blocking_errors, [])
    assert.equal(debugReport.validation.diagnostics.length, 1)
    assert.equal(debugReport.validation.diagnostics[0].code, spec.warning)
  }
})

test('each seeded target differs from its same-column clean frame only inside the declared rectangle and exhibits its intended defect', async () => {
  const controls = await buildFrameRepairQualityGateControls()
  for (const captured of controls) {
    const control = controlDefaultFor(captured)
    const rectangle = control.maskEdits[0]
    assert.deepEqual(rectangle, control.caseId === 'control_outline_alpha'
      ? { op: 'add_rectangle', x: 39, y: 48, width: 12, height: 18 }
      : { op: 'add_rectangle', x: 58, y: 56, width: 10, height: 12 })
    const image = await loadRgba(artifactsByKey(captured).get('sheet').content)
    const cleanFrameIndex = control.sheetFrameIndex + 8
    assert.equal(cleanFrameIndex % 8, control.sheetFrameIndex % 8)
    const changed = changedFramePixels(image, control.sheetFrameIndex, cleanFrameIndex)
    assert.ok(changed.length > 0)
    assert.ok(changed.every(({ x, y }) =>
      x >= rectangle.x && x < rectangle.x + rectangle.width &&
      y >= rectangle.y && y < rectangle.y + rectangle.height))

    if (control.caseId === 'control_outline_alpha') {
      assert.ok(changed.some(({ target, clean }) => clean[3] > 0 && target[3] < clean[3]))
    } else {
      const added = changed.filter(({ target, clean }) => target[3] > 0 && clean[3] === 0)
      assert.ok(added.length > 0 && added.length <= 16)
      assert.ok(added.every(({ x, y }) => {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if ((dx || dy) && framePixel(image, cleanFrameIndex, x + dx, y + dy)[3] > 0) return false
          }
        }
        return true
      }))
    }
  }
})

test('each capture imports directly as a valid managed rev_001 Character Pack with exact control clip and frame authority', async () => {
  const controls = await buildFrameRepairQualityGateControls()
  for (const captured of controls) {
    const control = controlDefaultFor(captured)
    const root = await mkdtemp(path.join(os.tmpdir(), `editor-qg-${control.caseId}-`))
    const workspaceRoot = path.join(root, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    const project = createDefaultEditorProject({
      id: `project_${control.caseId}`,
      name: 'Frame Repair Quality Gate Controls',
      revision: 1,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    })
    const imported = await importCapturedCharacterRevisionForQualityGate({
      project,
      targetAssetId: control.assetId,
      captured,
      projectRoot: root,
      workspaceRoot,
      now: new Date(FIXED_TIMESTAMP),
    })

    assert.equal(imported.asset.kind, 'character_pack')
    assert.equal(imported.asset.id, control.assetId)
    assert.equal(imported.asset.active_revision_id, 'rev_001')
    assert.equal(imported.revision.id, 'rev_001')
    assert.equal(imported.revision.parent_revision_id, null)
    assert.equal(validateEditorProject(imported.project).blocking_errors.length, 0)
    assert.ok(imported.asset.clips[control.clipId])
    assert.equal(imported.asset.clips[control.clipId].frames[control.clipFramePosition], control.sheetFrameIndex)
    assert.equal(imported.mapping.target.asset_id, control.assetId)
    assert.equal(imported.mapping.target.revision_id, control.expectedAssetRevisionId)
    assert.equal(imported.mapping.target.source_sha256, captured.source_sha256)
  }
})
