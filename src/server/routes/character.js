export async function routeCharacter({ req, res, url, handlers }) {
  if (req.method === 'GET' && url.pathname === '/api/gemini-state') {
    await handlers.geminiState(req, res)
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/benchmark-gallery') {
    await handlers.benchmarkGallery(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/provider-config') {
    await handlers.providerConfig(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/repair-character-action') {
    await handlers.repairCharacterAction(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/process-sheet') {
    await handlers.processSheet(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/generate-character') {
    await handlers.generateCharacter(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/generate-character/review') {
    await handlers.generateCharacterReview(req, res)
    return true
  }
  const manualAcceptanceMatch = url.pathname.match(
    /^\/api\/generate-character\/([A-Za-z0-9._-]{1,120})\/accept$/,
  )
  if (req.method === 'POST' && manualAcceptanceMatch && !manualAcceptanceMatch[1].includes('..')) {
    await handlers.acceptGeneratedCharacter(req, res, manualAcceptanceMatch[1])
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/build-frame-gif') {
    await handlers.buildFrameGif(req, res)
    return true
  }
  return false
}
