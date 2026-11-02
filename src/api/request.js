import { NotFoundError, CheckError, errorForResponse, networkError } from './errors.js'
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

// ---- hooks: debug mode and diagnostics plug in here (src/debug/) ----
// Kept as setters rather than imports so this module stays free of UI and
// storage dependencies.
//
// writeInterceptor({ method, url, body, context, operation }) is called for
// every non-GET before it is sent, and for a GET of a fake `debug-N` id.
// Returning { value } means "handled — don't send; reply with this JSON"
// (debug mode). Returning nothing sends it live.
// failureListener(err, { method, url, context, operation }) sees every failure.
let writeInterceptor = null
let failureListener = null
export function setWriteInterceptor(fn) { writeInterceptor = fn }
export function setFailureListener(fn) { failureListener = fn }

// Method + path with ids generalised — safe to show and to copy into a report.
export function describeOperation(method, url) {
  let path
  try { path = new URL(url, 'x:/').pathname } catch { path = String(url).split('?')[0] }
  return `${method} ${path.replace(/^\/api\/v1/, '').replace(/\/(\d+|debug-\d+|self)(?=\/|$)/g, '/:id')}`
}

const FAKE_ID_IN_PATH = /\/debug-\d+(?=\/|$)/

async function executeRequest({ url, method, body, json, context }) {
  context = context ?? {}
  const operation = describeOperation(method, url)
  try {
    // In debug mode, a read of something only created this session (a fake
    // `debug-N` id) is answered locally instead of 404ing against Canvas.
    if (method === 'GET' && FAKE_ID_IN_PATH.test(new URL(url).pathname)) {
      const handled = writeInterceptor?.({ method, url, context, operation })
      if (handled) return fakeResponse(handled.value)
    }
    if (method !== 'GET') {
      const blocked = (context.checks ?? []).filter(c => c.level === 'block')
      const handled = writeInterceptor?.({ method, url, body: json, context, operation })
      if (blocked.length) throw new CheckError(blocked, { operation })
      if (handled) return fakeResponse(handled.value)
      // A fake id from a debug-mode session must never reach live Canvas.
      if (FAKE_ID_IN_PATH.test(new URL(url).pathname)) {
        throw new CheckError([{ level: 'block', rule: 'debug-id', message: 'a test id from debug mode was about to be sent to Canvas' }], { operation })
      }
    }
    return await send({ url, method, body, operation })
  } catch (err) {
    const expectedMissing = context.expectMissing && (err instanceof NotFoundError || err?.statusCode === 400)
    if (!expectedMissing) failureListener?.(err, { method, url, context, operation })
    throw err
  }
}

async function send({ url, method, body, operation }) {
  if (rateLimitBackoffUntil && Date.now() < rateLimitBackoffUntil) {
    await sleep(rateLimitBackoffUntil - Date.now())
  }

  let response
  try {
    response = await fetch(url, { method, headers: buildHeaders(method), body, credentials: 'same-origin' })
  } catch (cause) {
    throw networkError(cause, operation)
  }
  if (response.ok) return response

  const text = await response.text().catch(() => '')
  const canvasMessage = canvasErrorMessage(text)
  // Canvas throttling is a 403 whose body says so; any other 403 is a permission problem.
  const rateLimited = response.status === 403 && /rate limit/i.test(text)
  const backoffMs = 10000
  if (rateLimited) rateLimitBackoffUntil = Date.now() + backoffMs
  throw errorForResponse(response.status, response.statusText, { canvasMessage, operation, rateLimited, backoffMs })
}

function fakeResponse(value) {
  return value == null
    ? new Response(null, { status: 204 })
    : new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// Canvas explains most failures in the body: { message } or { errors: [{ message }] }.
export function canvasErrorMessage(text) {
  try {
    const body = JSON.parse(String(text).replace(/^while\(1\);/, ''))
    return body?.message ?? body?.errors?.[0]?.message ?? (typeof body?.errors === 'string' ? body.errors : null)
  } catch {
    return null
  }
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

// `context` (optional, every verb) travels with the request to the hooks:
//   checks         — safety-check results; any 'block' stops the write (CheckError)
//   expectMissing  — a 400/404 here means "not there yet", so don't log it
//   studentName, assignmentLabel, kind — labels for the debug report
export async function canvasGet(path, params = {}, context) {
  const response = await executeRequest({ url: buildUrl(path, params), method: 'GET', context })
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

export async function canvasPut(path, body = {}, context) {
  const response = await executeRequest({ url: buildUrl(path), method: 'PUT', body: JSON.stringify(body), json: body, context })
  return readJson(response)
}

export async function canvasPost(path, body = {}, context) {
  const response = await executeRequest({ url: buildUrl(path), method: 'POST', body: JSON.stringify(body), json: body, context })
  return readJson(response)
}

export async function canvasDelete(path, context) {
  await executeRequest({ url: buildUrl(path), method: 'DELETE', context })
}
