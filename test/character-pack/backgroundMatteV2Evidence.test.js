import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  applyDeterministicPixelMatteV2,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES,
  buildBackgroundMatteV2ArtifactBundle,
} from '../../src/character-pack/backgroundMatteV2.js'
import {
  parseBackgroundMatteV2Evidence,
  validateBackgroundMatteV2EvidenceBuffers,
} from '../../src/character-pack/backgroundMatteV2Evidence.js'
import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'

function fixture() {
  const width = 24
  const height = 24
  const data = new Uint8ClampedArray(width * height * 4)
  const setPixel = (x, y, rgba) => data.set(rgba, (y * width + x) * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set([255, 255, 255, 255], offset)
  for (let y = 3; y <= 20; y += 1) {
    for (let x = 3; x <= 20; x += 1) setPixel(x, y, [30, 70, 150, 255])
  }
  let edgeIndex = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= 2 && y >= 2 && x < width - 2 && y < height - 2) continue
      if (edgeIndex % 10 === 0) setPixel(x, y, [254, 254, 254, 255])
      edgeIndex++
    }
  }
  for (let x = 3; x <= 10; x += 1) setPixel(x, 12, [245, 245, 245, 255])
  for (let x = 12; x <= 20; x += 1) setPixel(x, 12, [245, 245, 245, 255])
  setPixel(11, 12, [238, 238, 238, 255])
  return { width, height, data }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function evidenceFixture() {
  const rawProviderBuffer = await encodeRgbaPng(fixture())
  const source = await loadRgba(rawProviderBuffer)
  const matte = applyDeterministicPixelMatteV2(source, { decode: source.decode })
  const bundle = await buildBackgroundMatteV2ArtifactBundle(matte, {
    rawSource: source,
    artifactUrlPrefix: '/generated/evidence_fixture',
  })
  const outputEntry = bundle.artifacts[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT]
  const backgroundRemovedProviderOutput = {
    ...outputEntry,
    width: source.width,
    height: source.height,
    processing: 'background_removal_only',
  }
  const generation = {
    background_matte_v2: bundle.metadata,
    background_removed_provider_output: backgroundRemovedProviderOutput,
  }
  return {
    bundle,
    generation,
    rawProviderBuffer,
    backgroundRemovedProviderOutput,
  }
}

test('Background Matte V2 evidence validates exact saved bytes and decoded source/output hashes', async () => {
  const fixtureData = await evidenceFixture()
  const evidence = parseBackgroundMatteV2Evidence(fixtureData.generation, {
    backgroundRemovedProviderOutput: fixtureData.backgroundRemovedProviderOutput,
  })
  const validated = await validateBackgroundMatteV2EvidenceBuffers({
    evidence,
    buffers: fixtureData.bundle.files,
    rawProviderBuffer: fixtureData.rawProviderBuffer,
    backgroundRemovedProviderBuffer:
      fixtureData.bundle.files[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT],
    expectedArtifactUrlPrefix: '/generated/evidence_fixture',
  })

  assert.equal(validated.quality.scope_integrity.status, 'pass')
  assert.equal(validated.quality.unknown_pixels.background_supported_cleared > 0, true)
  assert.equal(
    validated.contractMasks.derived_masks.exterior_fringe_hard_clear.pixel_count,
    1,
  )
  assert.equal(
    validated.quality.unknown_pixels.background_supported_cleared_breakdown
      .exterior_fringe_hard_clear,
    1,
  )
  assert.equal(
    validated.review.confidence.exterior_fringe_hard_clear_cleared_pixel_count,
    1,
  )
  assert.equal(validated.quality.background_residue.visible_pixel_count, 0)
  assert.deepEqual(Object.keys(validated.review).sort(), [
    'affected_regions',
    'algorithm',
    'artifacts',
    'confidence',
    'hashes',
    'reasons',
    'review_recommendation',
    'schema_version',
    'spill_overlay_legend',
    'urls',
  ])
})

test('Background Matte V2 evidence rejects extra manifest entries and changed Artifact bytes', async () => {
  const fixtureData = await evidenceFixture()
  const malformed = structuredClone(fixtureData.generation)
  malformed.background_matte_v2.artifacts['extra.png'] = {
    file: 'extra.png',
    byte_length: 1,
    sha256: '0'.repeat(64),
    mime_type: 'image/png',
  }
  assert.throws(
    () => parseBackgroundMatteV2Evidence(malformed, {
      backgroundRemovedProviderOutput: fixtureData.backgroundRemovedProviderOutput,
    }),
    /generation evidence is malformed/,
  )

  const evidence = parseBackgroundMatteV2Evidence(fixtureData.generation, {
    backgroundRemovedProviderOutput: fixtureData.backgroundRemovedProviderOutput,
  })
  const changed = { ...fixtureData.bundle.files }
  changed[BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW] = Buffer.from('changed')
  await assert.rejects(
    validateBackgroundMatteV2EvidenceBuffers({
      evidence,
      buffers: changed,
      rawProviderBuffer: fixtureData.rawProviderBuffer,
      backgroundRemovedProviderBuffer:
        fixtureData.bundle.files[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT],
      expectedArtifactUrlPrefix: '/generated/evidence_fixture',
    }),
    /Artifact bytes changed/,
  )
})

test('Background Matte V2 evidence binds every review URL to the expected Artifact directory', async () => {
  const fixtureData = await evidenceFixture()
  const evidence = parseBackgroundMatteV2Evidence(fixtureData.generation, {
    backgroundRemovedProviderOutput: fixtureData.backgroundRemovedProviderOutput,
  })
  for (const expectedArtifactUrlPrefix of [
    '/generated/other_job',
    'file:///tmp/unrelated_preview',
  ]) {
    await assert.rejects(
      validateBackgroundMatteV2EvidenceBuffers({
        evidence,
        buffers: fixtureData.bundle.files,
        rawProviderBuffer: fixtureData.rawProviderBuffer,
        backgroundRemovedProviderBuffer:
          fixtureData.bundle.files[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT],
        expectedArtifactUrlPrefix,
      }),
      /review evidence changed/,
    )
  }

  const changedGeneration = structuredClone(fixtureData.generation)
  const changedBuffers = { ...fixtureData.bundle.files }
  const review = JSON.parse(
    changedBuffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW].toString('utf8'),
  )
  review.urls.background_preview_url =
    '/generated/evidence_fixture/background_spill_overlay.png'
  const reviewBuffer = Buffer.from(`${JSON.stringify(review, null, 2)}\n`, 'utf8')
  changedBuffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW] = reviewBuffer
  const reviewArtifact = {
    ...changedGeneration.background_matte_v2.artifacts[
      BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW
    ],
    byte_length: reviewBuffer.length,
    sha256: sha256(reviewBuffer),
  }
  changedGeneration.background_matte_v2.artifacts[
    BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW
  ] = reviewArtifact

  const quality = JSON.parse(
    changedBuffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY].toString('utf8'),
  )
  quality.review_artifact = reviewArtifact
  const qualityBuffer = Buffer.from(`${JSON.stringify(quality, null, 2)}\n`, 'utf8')
  changedBuffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY] = qualityBuffer
  changedGeneration.background_matte_v2.artifacts[
    BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY
  ] = {
    ...changedGeneration.background_matte_v2.artifacts[
      BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY
    ],
    byte_length: qualityBuffer.length,
    sha256: sha256(qualityBuffer),
  }
  const changedEvidence = parseBackgroundMatteV2Evidence(changedGeneration, {
    backgroundRemovedProviderOutput: fixtureData.backgroundRemovedProviderOutput,
  })
  await assert.rejects(
    validateBackgroundMatteV2EvidenceBuffers({
      evidence: changedEvidence,
      buffers: changedBuffers,
      rawProviderBuffer: fixtureData.rawProviderBuffer,
      backgroundRemovedProviderBuffer:
        changedBuffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT],
      expectedArtifactUrlPrefix: '/generated/evidence_fixture',
    }),
    /review evidence changed/,
  )
})

test('Background Matte V2 evidence rejects a coordinated forged Mask and report set', async () => {
  const fixtureData = await evidenceFixture()
  const changedGeneration = structuredClone(fixtureData.generation)
  const changedBuffers = { ...fixtureData.bundle.files }
  const artifactEntries = changedGeneration.background_matte_v2.artifacts
  const replaceArtifact = (file, buffer) => {
    changedBuffers[file] = buffer
    artifactEntries[file] = {
      ...artifactEntries[file],
      byte_length: buffer.length,
      sha256: sha256(buffer),
    }
    return artifactEntries[file]
  }

  const sureBackgroundFile = BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_BACKGROUND_MASK
  const sureForegroundFile = BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_FOREGROUND_MASK
  const forgedSureBackgroundArtifact = replaceArtifact(
    sureBackgroundFile,
    changedBuffers[sureForegroundFile],
  )

  const contractMasks = JSON.parse(
    changedBuffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS].toString('utf8'),
  )
  contractMasks.masks.sure_background = structuredClone(
    contractMasks.masks.sure_foreground,
  )
  contractMasks.diagnostic_mask_artifacts.sure_background = forgedSureBackgroundArtifact
  const contractMasksForHash = { ...contractMasks }
  delete contractMasksForHash.diagnostic_mask_artifacts
  const forgedContractHash = sha256(
    Buffer.from(JSON.stringify(contractMasksForHash), 'utf8'),
  )
  const contractMasksBuffer = Buffer.from(
    `${JSON.stringify(contractMasks, null, 2)}\n`,
    'utf8',
  )
  const contractMasksArtifact = replaceArtifact(
    BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS,
    contractMasksBuffer,
  )

  const review = JSON.parse(
    changedBuffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW].toString('utf8'),
  )
  review.hashes.background_contract_masks_sha256 = forgedContractHash
  review.artifacts.contract_masks = contractMasksArtifact
  const reviewBuffer = Buffer.from(`${JSON.stringify(review, null, 2)}\n`, 'utf8')
  const reviewArtifact = replaceArtifact(
    BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW,
    reviewBuffer,
  )

  const quality = JSON.parse(
    changedBuffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY].toString('utf8'),
  )
  quality.contract_masks_sha256 = forgedContractHash
  quality.contract_masks_artifact = contractMasksArtifact
  quality.review_artifact = reviewArtifact
  const qualityBuffer = Buffer.from(`${JSON.stringify(quality, null, 2)}\n`, 'utf8')
  replaceArtifact(BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY, qualityBuffer)

  const forgedEvidence = parseBackgroundMatteV2Evidence(changedGeneration, {
    backgroundRemovedProviderOutput: fixtureData.backgroundRemovedProviderOutput,
  })
  await assert.rejects(
    validateBackgroundMatteV2EvidenceBuffers({
      evidence: forgedEvidence,
      buffers: changedBuffers,
      rawProviderBuffer: fixtureData.rawProviderBuffer,
      backgroundRemovedProviderBuffer:
        changedBuffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT],
      expectedArtifactUrlPrefix: '/generated/evidence_fixture',
    }),
    /does not match deterministic replay/,
  )
})
