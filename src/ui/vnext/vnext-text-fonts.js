// Local-only font handles. No font bytes, machine font list or paths leave the browser.
export const TEXT_FONT_DEFAULTS = [
  { id: 'sans-serif', label: 'System sans', family: 'sans-serif' },
  { id: 'serif', label: 'System serif', family: 'serif' },
  { id: 'monospace', label: 'Monospace', family: 'monospace' },
]

export function validateFontFile(file, count, total) {
  if (!file || !/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('Choose a TTF, OTF, WOFF or WOFF2 font.')
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 8 * 1024 * 1024) throw new Error('Font files must be 8 MiB or smaller.')
  if (count >= 8 || total + file.size > 32 * 1024 * 1024) throw new Error('Font limit reached. Reload to clear this page’s imported fonts.')
}

export function localFontChoices(fonts) {
  const seen = new Set(), choices = []
  for (const item of fonts.slice(0, 2048)) {
    if (typeof item.postscriptName !== 'string' || !item.postscriptName || item.postscriptName.length > 200
      || /[\u0000-\u001f\u007f]/.test(item.postscriptName) || seen.has(item.postscriptName)) continue
    seen.add(item.postscriptName)
    choices.push({ id: `local-${choices.length}`, label: String(item.fullName || item.postscriptName).slice(0, 200), local: item.postscriptName })
  }
  return choices.sort((a, b) => a.label.localeCompare(b.label))
}

export function createTextFontLibrary(host = globalThis) {
  const imported = [], installed = host.document.fonts, loaded = new Map()
  let total = 0, serial = 0, pending = false, listing = null
  const uniqueLocalName = name => {
    const taken = new Set([...loaded.keys(), ...imported.map(entry => entry.local)])
    let stored = String(name || 'font').slice(0, 180), n = 2
    while (taken.has(stored)) stored = `${String(name || 'font').slice(0, 160)} (${n++})`.slice(0, 200)
    return stored
  }
  const install = async (stored, source, current) => {
    const existing = loaded.get(stored)
    if (existing) return existing.family
    const family = `GameToolFont${++serial}`, face = new host.FontFace(family, source)
    await face.load()
    if (!current()) return null
    installed.add(face)
    loaded.set(stored, { family, face })
    return family
  }
  const timed = async (promise, message = 'Font loading timed out. Choose a font again.') => {
    let timer
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = host.setTimeout(() => reject(new Error(message)), 8000) })]) }
    finally { host.clearTimeout(timer) }
  }
  const run = async (active, work) => {
    if (pending) throw new Error('A previous font is still loading. Wait before importing another font.')
    pending = true
    let expired = false
    // Timeout/cancel cannot abort a browser font decoder. Keep the shared slot until
    // the underlying work settles, and never install a face after its timeout.
    const job = (async () => { try { return await work(() => !expired && active()) } finally { pending = false } })()
    try { return await timed(job) }
    catch (error) { expired = true; throw error }
  }
  return {
    imported,
    supportsLocal: typeof host.queryLocalFonts === 'function',
    async list() {
      if (typeof host.queryLocalFonts !== 'function') throw new Error('System font access is unavailable. Import a font file instead.')
      // Permission is requested only by the explicit button click, never on page load.
      if (listing) throw new Error('System font access is still pending. Import a font file instead.')
      listing = Promise.resolve().then(() => host.queryLocalFonts()).finally(() => { listing = null })
      const fonts = await timed(listing, 'System font access timed out. Import a font file instead.')
      const choices = localFontChoices(fonts)
      if (!choices.length) throw new Error('No system fonts are available. Import a font file instead.')
      return { choices, limited: fonts.length > 2048 }
    },
    importFile(file, active) { return run(active, async current => {
      validateFontFile(file, imported.length, total)
      const bytes = await file.arrayBuffer()
      if (!current()) return null
      if (bytes.byteLength !== file.size) throw new Error('The font file changed. Choose it again.')
      const stored = uniqueLocalName(file.name)
      const family = await install(stored, bytes, current)
      if (!family) return null
      const entry = { id: family, family, label: file.name.slice(0, 200), local: stored }
      imported.push(entry); total += file.size
      return entry
    }) },
    familyFor(name) { return loaded.get(name)?.family || null },
    async resolve(entry, active) {
      if (!entry) throw new Error('Choose an available font.')
      if (!entry.local) return entry.family
      return run(active, async current => install(entry.local, `local(${JSON.stringify(entry.local)})`, current))
    },
  }
}
