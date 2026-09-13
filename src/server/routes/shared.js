export async function routeShared({ req, res, url, handlers }) {
  if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
    await handlers.job(req, res, url.pathname.split('/').pop())
    return true
  }
  return false
}
