import {
  ID_PATTERN,
  JOB_ID_PATTERN,
  KEY_CODE_PATTERN,
  STATE_KEY_PATTERN,
} from './constants.js'

const SECRET_KEY_PATTERN = /(^|_)(api[_-]?key|provider[_-]?key|token|secret|password|credential|authorization|bearer)($|_)/i
const BASE64_DATA_PATTERN = /^data:[^;]+;base64,/i
const SECRET_VALUE_PATTERN = /\b(Bearer\s+[A-Za-z0-9._~+/-]+|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function clonePlain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export function isObjectMap(value) {
  return isPlainObject(value)
}

export function isValidId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function isValidJobId(value) {
  return value == null || (typeof value === 'string' && JOB_ID_PATTERN.test(value))
}

export function isValidKeyCode(value) {
  return typeof value === 'string' && KEY_CODE_PATTERN.test(value)
}

export function isValidStateKey(value) {
  return typeof value === 'string' && STATE_KEY_PATTERN.test(value) && !SECRET_KEY_PATTERN.test(value)
}

export function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isPositiveFiniteNumber(value) {
  return isFiniteNumber(value) && value > 0
}

export function isNonNegativeFiniteNumber(value) {
  return isFiniteNumber(value) && value >= 0
}

export function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

export function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || normalized.startsWith('~')) return false
  if (WINDOWS_ABSOLUTE_PATTERN.test(value)) return false
  if (URL_SCHEME_PATTERN.test(value)) return false
  return !normalized.split('/').some((part) => part === '..')
}

export function isBase64Payload(value) {
  return typeof value === 'string' && BASE64_DATA_PATTERN.test(value.trim())
}

export function isSecretLikeKey(key) {
  return SECRET_KEY_PATTERN.test(String(key || ''))
}

export function isSecretLikeValue(value) {
  return typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)
}

function visitJson(value, visitor, path = []) {
  visitor(value, path)
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitJson(item, visitor, [...path, String(index)]))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    visitJson(child, visitor, [...path, key])
  }
}

export function findBase64PayloadPaths(value) {
  const paths = []
  visitJson(value, (item, path) => {
    if (isBase64Payload(item)) paths.push(path.join('.'))
  })
  return paths
}

export function findSecretLikePaths(value) {
  const paths = []
  visitJson(value, (item, path) => {
    const key = path.at(-1)
    if (key && isSecretLikeKey(key) && item != null && item !== '') paths.push(path.join('.'))
    if (isSecretLikeValue(item)) paths.push(path.join('.'))
  })
  return paths
}
