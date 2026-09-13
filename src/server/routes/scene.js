export async function routeScene({ req, res, url, handlers }) {
  if (req.method === 'POST' && url.pathname === '/api/process-scene-tiles') {
    await handlers.processSceneTiles(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/generate-scene-tiles') {
    await handlers.generateSceneTiles(req, res)
    return true
  }
  if (
    req.method === 'POST'
    && url.pathname === '/api/build-two-point-five-d-tileset'
  ) {
    await handlers.buildTwoPointFiveDTileset(req, res)
    return true
  }
  if (
    req.method === 'POST'
    && url.pathname === '/api/two-point-five-d-material-source-benchmark'
  ) {
    await handlers.twoPointFiveDMaterialSourceBenchmark(req, res)
    return true
  }
  return false
}
