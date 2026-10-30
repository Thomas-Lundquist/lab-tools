import { AuthError, RateLimitError, NotFoundError, ApiError } from './errors.js'
import { canvasOrigin, csrfToken } from './canvasContext.js'

// The app runs inside the Canvas origin (launched by launch.js — see
// DECISIONS.md), so every request is same-origin and authenticates with the
// teacher's own Canvas session cookie: no API token, no proxy, no CORS.
// Non-GET requests need Canvas's CSRF token. In local dev, Vite's dev server
// proxies /api/v1 to Canvas with a token from .env.local (see vite.config.js),
// so the same code path works on localhost.

let rateLimitBackoffUntil = null

function buildUrl(path, params = {}) {
  const url = new URL(path, canvasOrigin())
  url.searchParams.set('per_page', '100')
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach(v => url.searchParams.append(`${key}[]`, v))
    } else {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function buildHeaders(method) {
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' }
  if (method !== 'GET') {
    const token = csrfToken()
    if (token) headers['X-CSRF-Token'] = token
  }
  return headers
}

async function executeRequest({ url, method, body }) {
  if (rateLimitBackoffUntil && Date.now() < rateLimitBackoffUntil) {
    await sleep(rateLimitBackoffUntil - Date.now())
  }

  const response = await fetch(url, { method, headers: buildHeaders(method), body, credentials: 'same-origin' })

  if (response.status === 401) throw new AuthError('Your Canvas session has expired. Log in to Canvas again, then relaunch Lab Tools.')
  if (response.status === 404) throw new NotFoundError(`Resource not found: ${url}`)

  if (response.status === 403) {
    const remaining = response.headers.get('X-Rate-Limit-Remaining')
    const backoffMs = remaining ? parseInt(remaining) * 1000 : 10000
    rateLimitBackoffUntil = Date.now() + backoffMs
    throw new RateLimitError(`Rate limited. Retrying in ${backoffMs}ms.`, backoffMs)
  }

  if (!response.ok) {
    throw new ApiError(`Request failed: ${response.status} ${response.statusText}`, response.status)
  }

  return response
}

// Session-authenticated Canvas JSON can be prefixed with `while(1);` (a JSON
// hijacking guard). Strip it before parsing. DELETE and some PUTs return an
// empty body.
async function readJson(response) {
  const text = (await response.text()).replace(/^while\(1\);/, '')
  return text ? JSON.parse(text) : null
}

// Canvas's Link header carries absolute URLs on Canvas's own host. Re-root the
// path + query on canvasOrigin() so pagination stays on the same route as the
// first page (in dev that's the localhost proxy, not Canvas directly).
export function extractNextPageUrl(linkHeader, origin = canvasOrigin()) {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  if (!match) return null
  const next = new URL(match[1], origin)
  return new URL(next.pathname + next.search, origin).toString()
}

function extractTotalEstimate(linkHeader) {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]*)>;\s*rel="last"/)
  if (!match) return null
  try {
    const url = new URL(match[1], canvasOrigin())
    const lastPage = parseInt(url.searchParams.get('page') ?? '')
    const perPage = parseInt(url.searchParams.get('per_page') ?? '')
    if (!lastPage || !perPage) return null
    return lastPage * perPage
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function canvasGet(path, params = {}) {
  const response = await executeRequest({ url: buildUrl(path, params), method: 'GET' })
  return readJson(response)
}

export async function canvasGetAll(path, params = {}, onProgress) {
  let allResults = []
  let url = buildUrl(path, params)
  let estimatedTotal = null

  while (url) {
    const response = await executeRequest({ url, method: 'GET' })
    const data = await readJson(response)
    allResults = allResults.concat(Array.isArray(data) ? data : [data])
    const linkHeader = response.headers.get('Link')
    if (estimatedTotal === null) estimatedTotal = extractTotalEstimate(linkHeader)
    url = extractNextPageUrl(linkHeader)
    if (onProgress) onProgress(allResults.length, estimatedTotal)
  }

  return allResults
}

export async function canvasPut(path, body = {}) {
  const response = await executeRequest({ url: buildUrl(path), method: 'PUT', body: JSON.stringify(body) })
  return readJson(response)
}

export async function canvasPost(path, body = {}) {
  const response = await executeRequest({ url: buildUrl(path), method: 'POST', body: JSON.stringify(body) })
  return readJson(response)
}

export async function canvasDelete(path) {
  await executeRequest({ url: buildUrl(path), method: 'DELETE' })
}
