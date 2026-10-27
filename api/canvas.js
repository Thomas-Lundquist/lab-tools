// Dumb pass-through proxy to Canvas's REST API.
//
// Why this exists: Instructure-hosted Canvas never sends CORS headers (no
// account-level setting changes that — see CLAUDE.md), so a plain web page's
// fetch() to Canvas is blocked by the browser's preflight check. This
// function runs server-to-server, where CORS does not apply, and relays
// the request/response byte-for-byte. It forwards whatever bearer token the
// caller sends — it never holds its own Canvas credential — and it never
// logs or persists request or response bodies.
//
// This is a single named function (not api/canvas/[...path].js) because
// Vercel's catch-all [...param] filesystem routing is a Next.js-only
// convention and silently 404s on a plain Vite project. vercel.json rewrites
// every /api/canvas/* request here instead, so the real Canvas path and
// query are recovered from the request's own URL — see
// parseProxyRequestUrl in _canvasProxyHelpers.js.
import {
  getAllowedHosts,
  isAllowedCanvasBase,
  rewriteLinkHeader,
  isAllowedOrigin,
  parseProxyRequestUrl,
} from './_canvasProxyHelpers.js'

function setCors(req, res) {
  const origin = req.headers.origin
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Canvas-Base')
}

export default async function handler(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const canvasBase = req.headers['x-canvas-base']
  if (!canvasBase || !isAllowedCanvasBase(canvasBase, getAllowedHosts())) {
    res.status(400).json({ error: 'Missing or disallowed X-Canvas-Base header.' })
    return
  }

  const authHeader = req.headers.authorization || ''
  if (!/^Bearer\s+\S+/i.test(authHeader)) {
    res.status(401).json({ error: 'Missing Authorization header.' })
    return
  }

  const { targetPath, search } = parseProxyRequestUrl(req.url)
  const targetUrl = new URL(targetPath + search, canvasBase)

  const init = {
    method: req.method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  }
  if (!['GET', 'HEAD', 'DELETE'].includes(req.method) && req.body && Object.keys(req.body).length) {
    init.body = JSON.stringify(req.body)
  }

  let upstream
  try {
    upstream = await fetch(targetUrl, init)
  } catch {
    res.status(502).json({ error: 'Upstream request to Canvas failed.' })
    return
  }

  const bodyText = await upstream.text()
  const link = upstream.headers.get('Link')
  if (link) res.setHeader('Link', rewriteLinkHeader(link, canvasBase))
  const rateRemaining = upstream.headers.get('X-Rate-Limit-Remaining')
  if (rateRemaining) res.setHeader('X-Rate-Limit-Remaining', rateRemaining)
  res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'application/json')
  res.status(upstream.status).send(bodyText)
}
