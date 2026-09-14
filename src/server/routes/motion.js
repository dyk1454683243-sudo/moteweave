export async function routeMotion({ req, res, url, handlers }) {
  if (req.method === 'GET' && url.pathname === '/api/motion-source-tool-status') {
    await handlers.motionSourceToolStatus(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/motion-source/uploads') {
    await handlers.motionSourceUpload(req, res, url)
    return true
  }
  if (
    req.method === 'DELETE'
    && /^\/api\/motion-source\/upload-operations\/[^/]+$/.test(url.pathname)
  ) {
    await handlers.releaseMotionSourceUploadOperation(
      req,
      res,
      url.pathname.split('/').pop(),
    )
    return true
  }
  if (
    req.method === 'DELETE'
    && /^\/api\/motion-source\/uploads\/[^/]+$/.test(url.pathname)
  ) {
    await handlers.releaseMotionSourceUpload(req, res, url.pathname.split('/').pop())
    return true
  }
  if (
    req.method === 'POST'
    && /^\/api\/motion-source\/jobs\/[^/]+\/cancel$/.test(url.pathname)
  ) {
    await handlers.cancelMotionSourceJob(req, res, url.pathname.split('/').at(-2))
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/analyze-motion-source') {
    await handlers.analyzeMotionSource(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/preview-motion-frames') {
    await handlers.previewMotionFrames(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/build-motion-strip') {
    await handlers.buildMotionStrip(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/apply-motion-strip') {
    await handlers.applyMotionStrip(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/analyze-motion-source-set') {
    await handlers.analyzeMotionSourceSet(req, res)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/apply-motion-source-set') {
    await handlers.applyMotionSourceSet(req, res)
    return true
  }
  return false
}
