// The two launchers handed out by the install page. Both inject launch.js into
// a document on the Canvas origin; see src/launch/launch.js.

export const CANVAS_ORIGIN = 'https://graniteschools.instructure.com'

// A Canvas URL that serves Canvas's own 404 page — same origin, logged in, and
// a page nobody needs, so the userscript can take it over.
export const LAUNCH_PATH = '/labtools'

// window.open('') must run synchronously in the tap/click, before anything
// async, or Safari's pop-up blocker eats it. The new about:blank tab shares
// Canvas's origin but can't read cookies, so the Canvas origin and the current
// CSRF token are handed over on window.__LABTOOLS__ (see api/canvasContext.js).
// No `%` anywhere: a javascript: URL is percent-decoded before it runs.
export function buildBookmarklet(launchUrl) {
  const code = [
    "var m=document.cookie.match(/(?:^|;\\s*)_csrf_token=([^;]+)/);",
    "if(!m){alert('Open Canvas and log in first, then try Lab Tools again.');return}",
    "var w=window.open('');",
    "if(!w){alert('Allow pop-ups for Canvas, then try Lab Tools again.');return}",
    "w.__LABTOOLS__={canvasOrigin:location.origin,csrfToken:decodeURIComponent(m[1])};",
    "var s=w.document.createElement('script');",
    `s.src=${JSON.stringify(launchUrl)}+'?'+Date.now();`,
    "w.document.head.appendChild(s)",
  ].join('')
  return `javascript:(function(){${code}})()`
}

export function buildUserscript(launchUrl) {
  return [
    '// ==UserScript==',
    '// @name         Lab Tools',
    '// @description  Opens Culinary Canvas Tools inside Canvas',
    `// @match        ${CANVAS_ORIGIN}${LAUNCH_PATH}*`,
    '// @run-at       document-end',
    '// ==/UserScript==',
    '',
    '(function () {',
    "  var s = document.createElement('script')",
    `  s.src = ${JSON.stringify(launchUrl)} + '?' + Date.now()`,
    '  document.head.appendChild(s)',
    '})()',
  ].join('\n')
}
