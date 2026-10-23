// This marker is emitted only by the native blank-document route. It is not
// inferred from an asset's provenance or from the absence of source_ref.
export function isBlankSpriteDocument(manifest) {
  const origin = manifest?.origin
  return origin?.type === 'blank' && Object.keys(origin).length === 1 && manifest.source_ref === null
}

export function isGeneralSequenceSpriteDocument(manifest, project = null) {
  const sourceRef = manifest?.source_ref
  if (!sourceRef || sourceRef.artifact !== 'image' || typeof sourceRef.asset_id !== 'string' || !sourceRef.asset_id || typeof sourceRef.revision_id !== 'string' || !sourceRef.revision_id) {
    return false
  }
  const sequence = project?.assets?.[sourceRef.asset_id]?.revisions?.[sourceRef.revision_id]?.artifacts?.sequence
  return typeof sequence === 'string' && sequence.length > 0
}

export function isEditablePixelDocument(manifest, project = null) {
  return Boolean(manifest?.derived_from) || isBlankSpriteDocument(manifest) || isGeneralSequenceSpriteDocument(manifest, project)
}
