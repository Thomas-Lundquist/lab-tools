// Pure helpers for the Canvas pass-through proxy, split out so they're
// testable with plain `node --test` (the serverless handler itself needs a
// real request/response and can't run in that harness).

export const PROXY_PREFIX = '/api/canvas'

// Instructure cloud Canvas never sends CORS headers (confirmed: there's no
// account-level setting for it — see the GitHub Pages CORS failure this
// proxy was added to fix). This allowlist is the only thing standing
// between this endpoint and becoming an open relay that forwards whatever
// bearer token a caller hands it to an arbitrary host, so it defaults to
// the one Canvas instance this personal tool actually talks to.
export function getAllowedHosts(env = process.env) {
  const raw = env.ALLOWED_CANVAS_HOSTS || 'graniteschools.instructure.com'
  return raw.split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
}

export function isAllowedCanvasBase(canvasBase, allowedHosts) {
  let parsed
  try {
    parsed = new URL(canvasBase)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && allowedHosts.includes(parsed.hostname.toLowerCase())
}

// Canvas's Link header points back at Canvas's own absolute URL
// (https://school.instructure.com/api/v1/...?page=2). Pagination
// (canvasGetAll in src/api/request.js) follows that URL directly, so if we
// don't rewrite it here, the second page's request would bypass the proxy
// entirely and hit the same CORS wall this proxy exists to avoid.
export function rewriteLinkHeader(linkHeader, canvasBase) {
  if (!linkHeader) return linkHeader
  return linkHeader.replace(/<([^>]+)>/g, (match, url) => {
    try {
      const parsed = new URL(url, canvasBase)
      return `<${PROXY_PREFIX}${parsed.pathname}${parsed.search}>`
    } catch {
      return match
    }
  })
}

const ALLOWED_DEV_ORIGINS = new Set(['http://localhost:5175'])

export function isAllowedOrigin(origin) {
  if (!origin) return false
  if (ALLOWED_DEV_ORIGINS.has(origin)) return true
  try {
    return new URL(origin).hostname.endsWith('.vercel.app')
  } catch {
    return false
  }
}

// Vercel's filesystem API routing only honors Next.js-style [...catchAll]
// segments inside a Next.js app; in a plain Vite project a file named
// api/canvas/[...path].js is never deployed as a route at all (confirmed:
// it 404s at the platform level, before the function even runs). The
// workaround is a single named function (api/canvas.js) reached via an
// explicit vercel.json rewrite for /api/canvas/:path* — which means this
// function has to recover the real Canvas path and query itself from the
// request's own URL rather than from a Vercel-provided route param.
export function parseProxyRequestUrl(reqUrl) {
  const { pathname, search } = new URL(reqUrl, 'http://internal')
  const rest = pathname.startsWith(PROXY_PREFIX) ? pathname.slice(PROXY_PREFIX.length) : pathname
  const targetPath = rest.startsWith('/') ? rest : `/${rest}`
  return { targetPath, search }
}
