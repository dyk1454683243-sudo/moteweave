export async function routeProject({ req, res, url, handlers }) {
  if (req.method === 'POST' && url.pathname === '/api/project-pack') {
    await handlers.projectPack(req, res)
    return true
  }
  return false
}
