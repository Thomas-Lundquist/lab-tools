// Full-page navigation between tool pages. Each tool is its own static HTML
// page (see vite.config.js's multi-entry build) — there's no client-side
// router, same as the extension this was ported from. Paths look like
// "src/pages/labs/index.html"; chrome.runtime.getURL used to resolve these
// against the extension's own origin, so on the web a root-relative URL is
// the direct equivalent.
export function pageUrl(path) {
  return path.startsWith('/') ? path : `/${path}`
}
