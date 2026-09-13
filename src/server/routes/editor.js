export async function routeEditor({ req, res, url, handlers }) {
  if (!url.pathname.startsWith('/api/editor/')) return false
  await handlers.editor(req, res)
  return true
}
