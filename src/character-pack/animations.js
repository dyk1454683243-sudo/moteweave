import { TOPDOWN_RPG_V0, getAnimationFrameIndexes } from './profile.js'

export function buildAnimations(profile = TOPDOWN_RPG_V0) {
  return Object.fromEntries(
    profile.animations.map((animation) => [
      animation.name,
      {
        fps: animation.fps,
        loop: animation.loop,
        mode: animation.mode,
        frames: getAnimationFrameIndexes(animation.name, profile),
        flip_h: false,
      },
    ])
  )
}
