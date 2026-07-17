function slugifyPreviewFileBase(value, fallback) {
  return (
    String(value ?? fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback
  )
}

function previewFileName(animationName, metadata = {}) {
  const base = metadata.preview_file_base ? slugifyPreviewFileBase(metadata.preview_file_base, animationName) : animationName
  return `${base}.gif`
}

function animationFrameIndexes(profile, animation, preview = {}) {
  const baseFrame = animation.row * profile.grid.columns + animation.startCol
  if (Number.isInteger(preview.frame_offset)) {
    const offset = Math.max(0, Math.min(animation.count - 1, preview.frame_offset))
    return Array.from({ length: animation.count }, () => baseFrame + offset)
  }
  if (Array.isArray(preview.frame_offsets) && preview.frame_offsets.length) {
    return preview.frame_offsets.map((offset) => baseFrame + Math.max(0, Math.min(animation.count - 1, Number(offset) || 0)))
  }
  return Array.from({ length: animation.count }, (_, i) => baseFrame + i)
}

export function buildRowPreviewIndex(profile, animationMetadata = {}) {
  const previews = []
  for (const animation of profile.animations) {
    const metadata = animationMetadata[animation.name] ?? {}
    if (metadata.preview_hidden) continue
    const basePreview = {
      name: animation.name,
      fileName: previewFileName(animation.name, metadata),
      label: metadata.display_label ?? animation.name,
      frames: animationFrameIndexes(profile, animation, metadata),
      fps: animation.fps,
      mode: animation.mode,
    }
    previews.push(basePreview)
    for (const alias of metadata.preview_aliases ?? []) {
      const fileName = previewFileName(animation.name, alias)
      if (fileName === basePreview.fileName) continue
      previews.push({
        ...basePreview,
        fileName,
        label: alias.display_label ?? alias.label ?? basePreview.label,
        frames: animationFrameIndexes(profile, animation, alias),
        fps: alias.fps ?? basePreview.fps,
        mode: alias.mode ?? basePreview.mode,
      })
    }
  }
  return previews
}
