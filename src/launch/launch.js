// Loader that puts Lab Tools into a document on the Canvas origin. Built into
// dist/launch.js by vite.config.js's `emitLauncher` plugin, which fills in the
// hashed bundle names and inlines public/theme-init.js — so the placeholders
// below never ship. Loaded two ways, both as a <script src> on a Canvas-origin
// document:
//   - the bookmarklet opens an about:blank tab (it inherits Canvas's origin),
//     sets window.__LABTOOLS__ = { canvasOrigin, csrfToken } on it, and injects
//     this script there;
//   - a userscript (Userscripts on iPad, Tampermonkey on a laptop) injects it
//     into a real Canvas page such as /labtools, which it takes over.
// Either way it wipes the document and writes the app shell. Module scripts and
// fonts load in CORS mode, so vercel.json allows the Canvas origin on /assets.
;(function () {
  if (window.__LABTOOLS_LOADED__) return
  window.__LABTOOLS_LOADED__ = true

  var base = new URL('.', document.currentScript.src).href
  var cfg = window.__LABTOOLS__ = window.__LABTOOLS__ || {}
  if (!cfg.canvasOrigin) cfg.canvasOrigin = location.origin

  var entry = '__ENTRY__'
  var css = __CSS__

  var html = document.documentElement
  Array.prototype.slice.call(html.attributes).forEach(function (a) { html.removeAttribute(a.name) })
  html.setAttribute('lang', 'en')
  var head = document.createElement('head')
  var body = document.createElement('body')
  html.replaceChildren(head, body)

  function add(parent, tag, attrs) {
    var el = document.createElement(tag)
    for (var k in attrs) el.setAttribute(k, attrs[k])
    parent.appendChild(el)
    return el
  }

  add(head, 'meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0' })
  add(head, 'link', { rel: 'icon', href: base + 'icon-source.svg', type: 'image/svg+xml' })
  document.title = 'Lab Tools'
  css.forEach(function (href) { add(head, 'link', { rel: 'stylesheet', href: base + href }) })

  /*__THEME_INIT__*/

  add(body, 'div', { id: 'root' })
  add(body, 'script', { type: 'module', src: base + entry })
})()
