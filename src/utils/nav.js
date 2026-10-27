// Full-page navigation between tool pages. Each tool is its own static HTML
// page (see vite.config.js's multi-entry build) — there's no client-side
// router, same as the extension this was ported from. Paths look like
// "src/pages/labs/index.html"; chrome.runtime.getURL used to resolve these
// against the extension's own origin, so on the web a root-relative URL is
// the direct equivalent. BASE_URL accounts for GitHub Pages serving this
// app from a subpath (/lab-tools/) instead of the domain root.
export function pageUrl(path) {
  const relative = path.startsWith('/') ? path.slice(1) : path
  return import.meta.env.BASE_URL + relative
}
