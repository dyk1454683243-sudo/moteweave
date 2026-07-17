import { isFiniteNumber, isPositiveFiniteNumber } from './safety.js'

export function worldToScreen(point, { camera = { x: 0, y: 0, zoom: 1 }, parallax = 1 } = {}) {
  const zoom = camera.zoom ?? 1
  return {
    x: (point.x - (camera.x ?? 0) * parallax) * zoom,
    y: (point.y - (camera.y ?? 0) * parallax) * zoom,
  }
}

export function screenToWorld(point, { camera = { x: 0, y: 0, zoom: 1 }, parallax = 1 } = {}) {
  const zoom = camera.zoom ?? 1
  return {
    x: point.x / zoom + (camera.x ?? 0) * parallax,
    y: point.y / zoom + (camera.y ?? 0) * parallax,
  }
}

export function layerPositionToScreen(layer, scene) {
  const position = layer?.transform?.position ?? { x: 0, y: 0 }
  if (layer?.transform?.coordinate_space === 'viewport') return { ...position }
  return worldToScreen(position, {
    camera: scene?.camera,
    parallax: layer?.render?.parallax ?? 1,
  })
}

export function resolvePivotOffset({ frameSize, pivot }) {
  if (!frameSize) return { x: 0, y: 0 }
  if (pivot?.mode === 'top_left') return { x: 0, y: 0 }
  if (pivot?.mode === 'center') return { x: frameSize.w / 2, y: frameSize.h / 2 }
  if (pivot?.mode === 'explicit') return { x: pivot.x ?? 0, y: pivot.y ?? 0 }
  return {
    x: pivot?.x ?? 0,
    y: pivot?.y ?? 0,
  }
}

export function layerPivotToTopLeft(position, { frameSize, pivot, scale = { x: 1, y: 1 }, flipX = false, flipY = false } = {}) {
  const offset = resolvePivotOffset({ frameSize, pivot })
  const size = frameSize ?? { w: 0, h: 0 }
  const scaleX = scale.x ?? 1
  const scaleY = scale.y ?? 1
  return {
    x: position.x - (flipX ? size.w - offset.x : offset.x) * scaleX,
    y: position.y - (flipY ? size.h - offset.y : offset.y) * scaleY,
  }
}

export function isValidTransform(transform) {
  return (
    isFiniteNumber(transform?.position?.x) &&
    isFiniteNumber(transform?.position?.y) &&
    isPositiveFiniteNumber(transform?.scale?.x) &&
    isPositiveFiniteNumber(transform?.scale?.y) &&
    isFiniteNumber(transform?.rotation_deg)
  )
}
