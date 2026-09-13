import { routeCharacter } from './character.js'
import { routeEditor } from './editor.js'
import { routeMotion } from './motion.js'
import { routeProject } from './project.js'
import { routeScene } from './scene.js'
import { routeShared } from './shared.js'

const DOMAIN_ROUTERS = Object.freeze([
  routeEditor,
  routeCharacter,
  routeMotion,
  routeShared,
  routeScene,
  routeProject,
])

export async function routeApi(context) {
  for (const routeDomain of DOMAIN_ROUTERS) {
    if (await routeDomain(context)) return true
  }
  return false
}
