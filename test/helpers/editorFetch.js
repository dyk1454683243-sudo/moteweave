// Tests opt into the current local-editor transport contract. The body and
// operation identity remain unchanged; negative capability tests use native fetch.
export function editorFetch(url, options = {}) {
  return globalThis.fetch(url, { ...options,
    headers: { 'X-Editor-Storage-Version': '2', ...options.headers } })
}
