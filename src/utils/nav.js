import { useSyncExternalStore } from 'react'

// In-app routing. The app is one page because it runs in a document on the
// Canvas origin (see launch.js) and can't navigate to other pages without
// leaving that origin. Routes: 'home', 'labs', 'settings', 'onboarding'.
//
// The route is mirrored to location.hash when the document has a real URL
// (local dev, a userscript-launched Canvas URL), so reload and back/forward
// work there. A bookmarklet-opened about:blank tab has no URL to route on;
// the route lives only in memory and a reload blanks the tab (relaunch).
//
// `epoch` bumps on navigate(..., { remount: true }); main.jsx keys the whole
// tree on it, standing in for the full page load the multi-page app used to
// do after a reset, so no provider or overlay state survives one.

const ROUTES = ['home', 'labs', 'settings', 'onboarding']
const hasRealUrl = () => /^https?:$/.test(window.location.protocol)

function parseHash() {
  const [route, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  return {
    route: ROUTES.includes(route) ? route : 'home',
    params: Object.fromEntries(new URLSearchParams(query)),
  }
}

function toHash({ route, params }) {
  const query = new URLSearchParams(params).toString()
  return `#/${route}${query ? `?${query}` : ''}`
}

let current = { route: 'home', params: {}, ...(hasRealUrl() ? parseHash() : {}), epoch: 0 }
const listeners = new Set()

function setCurrent(next) {
  current = next
  listeners.forEach(l => l())
}

if (hasRealUrl()) {
  window.addEventListener('hashchange', () => setCurrent({ ...parseHash(), epoch: current.epoch }))
}

export function navigate(route, params = {}, { replace = false, remount = false } = {}) {
  if (hasRealUrl()) {
    const hash = toHash({ route, params })
    if (replace) history.replaceState(null, '', hash)
    else history.pushState(null, '', hash)
  }
  setCurrent({ route, params, epoch: current.epoch + (remount ? 1 : 0) })
  window.scrollTo(0, 0)
}

export function useRoute() {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
  )
}
