import test from 'node:test'
import assert from 'node:assert/strict'

import * as editorProject from '../../src/editor-project/index.js'
import {
  buildCanonicalFrameRepairMask,
  createCanonicalFrameRepairPlan,
  hashFrameRepairReferenceContext,
  hashFrameRepairPlan,
  serializeFrameRepairPlan,
} from '../../src/editor-project/frameRepairPlan.js'

function planInput() {
  return {
    request: {
      expectedRevision: 4,
      expectedAssetRevisionId: 'rev_003',
      clipId: 'walk_down',
      clipFramePosition: 2,
      sheetFrameIndex: 17,
      instruction: 'repair hand',
      maskEdits: [],
      providerPresetId: 'gemini-default',
      imageConfig: { image_size: '1K' },
    },
    authority: {
      projectId: 'project_demo',
      projectRevision: 4,
      assetId: 'asset_hero',
      parentRevisionId: 'rev_003',
      profileId: 'topdown_rpg_v0',
      frameSize: { w: 96, h: 96 },
      clipFrames: [16, 17, 17, 18],
      parentSheetSha256: '1'.repeat(64),
      targetFrameSha256: '2'.repeat(64),
      contextFrames: [
        { position: 1, sheet_frame_index: 17, sha256: '3'.repeat(64) },
        { position: 3, sheet_frame_index: 18, sha256: '4'.repeat(64) },
      ],
      referenceContextSha256: '0'.repeat(64),
      referenceImages: [
        { role: 'target_enlarged', name: 'target.png', sha256: '7'.repeat(64) },
        { role: 'mask_visualization', name: 'mask.png', sha256: '8'.repeat(64) },
        { role: 'clip_context', name: 'clip_context.png', sha256: '9'.repeat(64) },
        { role: 'full_sheet', name: 'normalized_sheet.png', sha256: 'a'.repeat(64) },
      ],
    },
    mask: {
      width: 96,
      height: 96,
      source: 'user_scoped',
      confidence: 'user_confirmed',
      runs: [{ start: 0, length: 1 }],
      activePixelCount: 1,
      sha256: '2aa6265ea57f140f3c0588bbd03c2ef453ef2a366c8cccb7501ef3f3dbb51aea',
    },
    provider: {
      id: 'gemini-default',
      provider: 'gemini',
      label: 'Gemini default',
      model: 'model-a',
      available: true,
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
    },
    implementationRevision: 'package-0.4.0',
  }
}

function capturePlanError(fn) {
  let captured
  assert.throws(fn, (error) => {
    assert.equal(error?.code, 'invalid_frame_repair_plan')
    captured = error
    return true
  })
  return captured
}

test('plan binds an exact repeated clip position and produces stable key-sorted bytes', () => {
  const input = planInput()
  const first = createCanonicalFrameRepairPlan(input)
  const reorderedAuthority = Object.fromEntries(Object.entries(input.authority).reverse())
  const second = createCanonicalFrameRepairPlan({ ...input, authority: reorderedAuthority })

  assert.deepEqual(serializeFrameRepairPlan(first.plan), serializeFrameRepairPlan(second.plan))
  assert.equal(hashFrameRepairPlan(first.plan), first.plan_hash)
  assert.equal(first.plan.clip.position, 2)
  assert.equal(first.can_run, true)
  assert.equal(createCanonicalFrameRepairPlan({
    ...input,
    request: { ...input.request, clipFramePosition: 1 },
  }).plan.clip.position, 1)
  assert.throws(
    () => createCanonicalFrameRepairPlan({
      ...input,
      request: { ...input.request, clipFramePosition: 3 },
    }),
    (error) => error?.code === 'frame_identity_mismatch',
  )
})

test('Plan APIs are public exports and serialization has stable UTF-8 bytes and a lowercase SHA-256 golden vector', () => {
  assert.equal(editorProject.buildCanonicalFrameRepairMask, buildCanonicalFrameRepairMask)
  assert.equal(editorProject.createCanonicalFrameRepairPlan, createCanonicalFrameRepairPlan)
  assert.equal(editorProject.hashFrameRepairReferenceContext, hashFrameRepairReferenceContext)
  assert.equal(editorProject.hashFrameRepairPlan, hashFrameRepairPlan)
  assert.equal(editorProject.serializeFrameRepairPlan, serializeFrameRepairPlan)

  const value = { z: 1, a: { z: '\u00e9', a: [{ b: 2, a: 1 }] } }
  const bytes = serializeFrameRepairPlan(value)
  assert.equal(Buffer.isBuffer(bytes), true)
  assert.equal(bytes.toString('utf8'), '{"a":{"a":[{"a":1,"b":2}],"z":"\u00e9"},"z":1}')
  assert.equal(hashFrameRepairPlan(value), 'bbdef025c85882f3b1169ea85175be7968ef28641c46e4f95729140340cd0f09')
})

test('server canonical mask builder applies labels exactly and hashes width, height, and canonical runs', () => {
  const needsScope = {
    mode: 'needs_scope',
    bits: new Uint8Array(6),
    activePixelCount: 0,
    suggestedRectangle: { x: 0, y: 0, width: 3, height: 2 },
  }
  const userScoped = buildCanonicalFrameRepairMask({
    baseMask: needsScope,
    width: 3,
    height: 2,
    edits: [{ op: 'add_rectangle', x: 0, y: 0, width: 2, height: 1 }],
  })
  assert.deepEqual(userScoped, {
    width: 3,
    height: 2,
    source: 'user_scoped',
    confidence: 'user_confirmed',
    runs: [{ start: 0, length: 2 }],
    activePixelCount: 2,
    sha256: '3559bfab1429904e7fbc0d65a45ae61dfdf51c82c06c1f1b24c60103fb2f000f',
  })
  assert.deepEqual([...needsScope.bits], [0, 0, 0, 0, 0, 0])

  const diagnosticBase = {
    mode: 'localized_diagnostic',
    bits: Uint8Array.of(0, 1, 0, 0, 0, 0),
    activePixelCount: 1,
    suggestedRectangle: null,
  }
  assert.deepEqual(
    buildCanonicalFrameRepairMask({ baseMask: diagnosticBase, width: 3, height: 2, edits: [] }),
    {
      width: 3,
      height: 2,
      source: 'localized_diagnostic',
      confidence: 'high',
      runs: [{ start: 1, length: 1 }],
      activePixelCount: 1,
      sha256: hashFrameRepairPlan({ width: 3, height: 2, runs: [{ start: 1, length: 1 }] }),
    },
  )
  const editedDiagnostic = buildCanonicalFrameRepairMask({
    baseMask: diagnosticBase,
    width: 3,
    height: 2,
    edits: [
      { op: 'remove_rectangle', x: 1, y: 0, width: 1, height: 1 },
      { op: 'add_rectangle', x: 2, y: 1, width: 1, height: 1 },
    ],
  })
  assert.equal(editedDiagnostic.source, 'localized_plus_user_edits')
  assert.equal(editedDiagnostic.confidence, 'user_confirmed')
  assert.deepEqual(editedDiagnostic.runs, [{ start: 5, length: 1 }])

  const empty = buildCanonicalFrameRepairMask({ baseMask: needsScope, width: 3, height: 2, edits: [] })
  assert.equal(empty.source, 'user_scoped')
  assert.equal(empty.confidence, 'needs_scope')
  assert.equal(empty.activePixelCount, 0)
  assert.deepEqual(empty.runs, [])
})

test('canonical Plan rejects adjacent mask runs instead of accepting a second identity for the same pixels', () => {
  const input = planInput()
  input.mask = {
    ...input.mask,
    runs: [
      { start: 0, length: 1 },
      { start: 1, length: 1 },
    ],
    activePixelCount: 2,
  }

  capturePlanError(() => createCanonicalFrameRepairPlan(input))
})

test('canonical Plan preserves non-adjacent runs and gives the merged run a stable mask hash', () => {
  const mergedInput = planInput()
  mergedInput.mask = {
    ...mergedInput.mask,
    runs: [{ start: 0, length: 2 }],
    activePixelCount: 2,
  }
  const merged = createCanonicalFrameRepairPlan(mergedInput)
  assert.deepEqual(merged.plan.mask.runs, [{ start: 0, length: 2 }])
  assert.equal(
    merged.plan.mask.sha256,
    '3d04e0d652f46db31f5f83185ae11014b30b3d4dcf40ea34efb557b28f4cc638',
  )

  const separatedInput = planInput()
  separatedInput.mask = {
    ...separatedInput.mask,
    runs: [
      { start: 0, length: 1 },
      { start: 2, length: 1 },
    ],
    activePixelCount: 2,
  }
  const separated = createCanonicalFrameRepairPlan(separatedInput)
  assert.deepEqual(separated.plan.mask.runs, [
    { start: 0, length: 1 },
    { start: 2, length: 1 },
  ])
  assert.equal(hashFrameRepairPlan(separated.plan), separated.plan_hash)
})

test('reference-context digest uses ordered safe role, name, and image-digest records', () => {
  const records = [
    {
      role: 'target_enlarged',
      name: 'target.png',
      sha256: '7'.repeat(64),
      bytes: Buffer.from('private target'),
      privatePath: '/private/target.png',
    },
    {
      role: 'mask_visualization',
      name: 'mask.png',
      sha256: '8'.repeat(64),
      bytes: Buffer.from('private mask'),
    },
  ]

  assert.equal(
    hashFrameRepairReferenceContext(records),
    '63399798e435bc9ebd1f0b7d6c9087ea63705739810e977ac53e877a58d6ca32',
  )
  assert.notEqual(
    hashFrameRepairReferenceContext([...records].reverse()),
    hashFrameRepairReferenceContext(records),
  )
})

test('canonical Plan contains only approved facts, recomputes reference context, and detaches every nested mutable input', () => {
  const input = planInput()
  const before = structuredClone(input)
  const result = createCanonicalFrameRepairPlan(input)

  assert.deepEqual(input, before)
  assert.deepEqual(Object.keys(result.plan).sort(), [
    'asset',
    'clip',
    'estimated_provider_calls',
    'implementation_revision',
    'instruction',
    'mask',
    'max_provider_calls',
    'parent_sheet_sha256',
    'profile',
    'project',
    'provider',
    'references',
    'target_frame_sha256',
    'version',
  ])
  assert.deepEqual(Object.keys(result.plan.mask).sort(), [
    'activePixelCount', 'confidence', 'height', 'runs', 'sha256', 'source', 'width',
  ])
  assert.equal(
    result.plan.references.context_sha256,
    hashFrameRepairReferenceContext(input.authority.referenceImages),
  )
  assert.notEqual(result.plan.references.context_sha256, input.authority.referenceContextSha256)

  const bytesBeforeMutation = Buffer.from(serializeFrameRepairPlan(result.plan))
  input.authority.frameSize.w = 1
  input.authority.clipFrames[0] = 999
  input.authority.contextFrames[0].sha256 = 'f'.repeat(64)
  input.authority.referenceImages[0].name = 'changed.png'
  input.mask.runs[0].length = 99
  input.provider.image_config.image_size = '2K'
  input.request.instruction = 'changed'
  assert.deepEqual(serializeFrameRepairPlan(result.plan), bytesBeforeMutation)

  result.plan.clip.frames[0] = 7
  result.plan.mask.runs[0].length = 7
  result.plan.provider.image_config.image_size = '2K'
  assert.equal(input.authority.clipFrames[0], 999)
  assert.equal(input.mask.runs[0].length, 99)
  assert.equal(input.provider.image_config.image_size, '2K')
})

test('public Plan never leaks image bytes, base64, provider secrets, endpoints, or private paths', () => {
  const input = planInput()
  input.authority.privateSheetPath = '/Users/private/normalized_sheet.png'
  input.authority.referenceImages[0].bytes = Buffer.from('raw image bytes')
  input.authority.referenceImages[0].path = '/Users/private/target.png'
  input.authority.referenceImages[0].source_base64 = 'data:image/png;base64,AAAA'
  input.authority.referenceImages[0].secret = 'reference-secret'
  input.mask.bits = Uint8Array.of(1)
  input.mask.private_path = '/Users/private/mask.bin'
  input.provider.apiKey = 'sk-abcdefghijklmnop'
  input.provider.endpoint = 'https://private.invalid/provider'

  const serialized = serializeFrameRepairPlan(createCanonicalFrameRepairPlan(input).plan).toString('utf8')

  for (const forbidden of [
    'raw image bytes',
    'data:image/png;base64,AAAA',
    'reference-secret',
    '/Users/private',
    'sk-abcdefghijklmnop',
    'https://private.invalid/provider',
    'private_path',
    'privateSheetPath',
    'source_base64',
    'apiKey',
    'endpoint',
    'bits',
    'bytes',
  ]) assert.equal(serialized.includes(forbidden), false)
})

test('can_run and diagnostics are stable for empty masks and unavailable providers', () => {
  const both = planInput()
  both.mask = buildCanonicalFrameRepairMask({
    baseMask: { mode: 'needs_scope', bits: new Uint8Array(96 * 96), activePixelCount: 0 },
    width: 96,
    height: 96,
    edits: [],
  })
  both.provider.available = false
  const blocked = createCanonicalFrameRepairPlan(both)
  assert.equal(blocked.can_run, false)
  assert.deepEqual(blocked.diagnostics, ['invalid_mask', 'provider_unavailable'])

  const unavailable = planInput()
  unavailable.provider.available = false
  assert.deepEqual(createCanonicalFrameRepairPlan(unavailable).diagnostics, ['provider_unavailable'])

  const empty = planInput()
  empty.mask = both.mask
  assert.deepEqual(createCanonicalFrameRepairPlan(empty).diagnostics, ['invalid_mask'])

  const nonBooleanAvailability = planInput()
  nonBooleanAvailability.provider.available = 1
  assert.equal(createCanonicalFrameRepairPlan(nonBooleanAvailability).can_run, false)
  assert.deepEqual(createCanonicalFrameRepairPlan(nonBooleanAvailability).diagnostics, ['provider_unavailable'])
})

test('canonical Plan rejects a request preset that differs from the resolved provider without echoing private input', () => {
  const input = planInput()
  input.request.providerPresetId = 'client-preset-a'
  input.provider.id = 'resolved-preset-b'
  input.provider.apiKey = 'sk-abcdefghijklmnop'

  const error = capturePlanError(() => createCanonicalFrameRepairPlan(input))
  const publicError = JSON.stringify({
    name: error.name,
    code: error.code,
    message: error.message,
    details: error.details,
  })

  assert.equal(publicError.includes(input.request.providerPresetId), false)
  assert.equal(publicError.includes(input.provider.id), false)
  assert.equal(publicError.includes(input.provider.apiKey), false)
  assert.equal(publicError.includes(JSON.stringify(input.request)), false)
})

test('canonical Plan rejects client image size drift and invalid resolved image sizes', () => {
  const mismatch = planInput()
  mismatch.provider.image_config.image_size = '2K'
  capturePlanError(() => createCanonicalFrameRepairPlan(mismatch))

  for (const imageConfig of [
    {},
    { image_size: '4K', aspect_ratio: '1:1' },
    { image_size: null, aspect_ratio: '1:1' },
  ]) {
    const input = planInput()
    input.provider.image_config = imageConfig
    capturePlanError(() => createCanonicalFrameRepairPlan(input))
  }
})

test('canonical Plan requires a non-empty control-free string aspect ratio from the resolved provider', () => {
  for (const imageConfig of [
    { image_size: '1K' },
    { image_size: '1K', aspect_ratio: '   ' },
    { image_size: '1K', aspect_ratio: '1:\n1' },
    { image_size: '1K', aspect_ratio: 1 },
    { image_size: '1K', aspect_ratio: null },
  ]) {
    const input = planInput()
    input.provider.image_config = imageConfig
    capturePlanError(() => createCanonicalFrameRepairPlan(input))
  }
})

test('canonical Plan binds the resolved aspect ratio into its hash and detaches it from provider input', () => {
  const input = planInput()
  input.provider.image_config.aspect_ratio = '4:3'
  const result = createCanonicalFrameRepairPlan(input)
  const originalBytes = Buffer.from(serializeFrameRepairPlan(result.plan))

  const differentAspect = planInput()
  differentAspect.provider.image_config.aspect_ratio = '16:9'
  const different = createCanonicalFrameRepairPlan(differentAspect)

  assert.equal(result.plan.provider.image_config.aspect_ratio, '4:3')
  assert.notEqual(result.plan_hash, different.plan_hash)
  input.provider.image_config.aspect_ratio = '1:1'
  assert.deepEqual(serializeFrameRepairPlan(result.plan), originalBytes)
  assert.equal(hashFrameRepairPlan(result.plan), result.plan_hash)
})

test('canonical Plan snapshots approved explicit image config only from the resolved provider preset', () => {
  const input = planInput()
  input.request.imageConfig.image_size = '2K'
  input.provider = {
    id: 'gemini-default',
    provider: 'gemini',
    label: 'Resolved Gemini preset',
    model: 'resolved-model-v2',
    available: true,
    image_config: {
      image_size: '2K',
      aspect_ratio: '4:3',
      endpoint: 'https://private.invalid/provider',
      apiKey: 'sk-abcdefghijklmnop',
    },
  }

  const result = createCanonicalFrameRepairPlan(input)

  assert.deepEqual(result.plan.provider, {
    id: 'gemini-default',
    provider: 'gemini',
    label: 'Resolved Gemini preset',
    model: 'resolved-model-v2',
    image_config: { image_size: '2K', aspect_ratio: '4:3' },
  })
  const bytesBeforeMutation = Buffer.from(serializeFrameRepairPlan(result.plan))
  input.provider.id = 'changed-provider'
  input.provider.provider = 'changed-family'
  input.provider.label = 'Changed label'
  input.provider.model = 'changed-model'
  input.provider.image_config.image_size = '1K'
  input.provider.image_config.aspect_ratio = '1:1'
  input.request.imageConfig.image_size = '1K'
  assert.deepEqual(serializeFrameRepairPlan(result.plan), bytesBeforeMutation)

  const serialized = bytesBeforeMutation.toString('utf8')
  assert.equal(serialized.includes('https://private.invalid/provider'), false)
  assert.equal(serialized.includes('sk-abcdefghijklmnop'), false)
  assert.equal(serialized.includes('endpoint'), false)
  assert.equal(serialized.includes('apiKey'), false)
})
