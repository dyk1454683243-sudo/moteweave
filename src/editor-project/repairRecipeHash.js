import { createHash } from 'node:crypto'

export function hashRepairRecipe(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
