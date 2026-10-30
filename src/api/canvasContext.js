// Where the app is running, and the CSRF token for writes.
//
// launch.js puts the app in one of two documents on the Canvas origin:
//   - a bookmarklet-opened about:blank tab. It shares Canvas's origin, but its
//     location.origin is "null" and, being an about: URL, it is cookie-averse —
//     document.cookie reads "". So the bookmarklet records the Canvas origin and
//     the current _csrf_token on window.__LABTOOLS__ before injecting launch.js.
//   - a real Canvas URL taken over by a userscript (or local dev). There,
//     location.origin and document.cookie work directly.
// Canvas's _csrf_token cookie is a masked form of the session's token; any
// masked copy validates for the whole session, so the one captured at launch
// keeps working until the session ends (which forces a relaunch anyway).

function launchConfig() {
  return (typeof window !== 'undefined' && window.__LABTOOLS__) || {}
}

export function canvasOrigin() {
  return launchConfig().canvasOrigin || window.location.origin
}

export function readCsrfCookie(cookieString) {
  const match = cookieString.match(/(?:^|;\s*)_csrf_token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export function csrfToken() {
  let fromCookie = null
  try { fromCookie = readCsrfCookie(document.cookie) } catch { /* cookie-averse document */ }
  return fromCookie || launchConfig().csrfToken || null
}
