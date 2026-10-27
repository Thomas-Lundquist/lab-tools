import { getCanvasUrl } from '../storage/account.js'
import { getDecryptedToken } from '../storage/encryption.js'
import { AuthError, RateLimitError, NotFoundError, ApiError } from './errors.js'

let rateLimitBackoffUntil = null

async function getAuthHeaders() {
  const token = await getDecryptedToken()
  if (!token) throw new AuthError('No API token found. Please complete setup.')
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function buildUrl(path, params = {}) {
  const baseUrl = await getCanvasUrl()
  const url = new URL(`${baseUrl}${path}`)
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

async function executeRequest({ url, method, body }) {
  if (rateLimitBackoffUntil && Date.now() < rateLimitBackoffUntil) {
    await sleep(rateLimitBackoffUntil - Date.now())
  }

  const headers = await getAuthHeaders()
  const response = await fetch(url, { method, headers, body })

  if (response.status === 401) throw new AuthError('API token is invalid or expired.')
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

function extractNextPageUrl(linkHeader) {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

function extractTotalEstimate(linkHeader) {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]*)>;\s*rel="last"/)
  if (!match) return null
  try {
    const url = new URL(match[1])
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
  const url = await buildUrl(path, params)
  const response = await executeRequest({ url, method: 'GET' })
  return response.json()
}

export async function canvasGetAll(path, params = {}, onProgress) {
  let allResults = []
  let url = await buildUrl(path, params)
  let estimatedTotal = null

  while (url) {
    const response = await executeRequest({ url, method: 'GET' })
    const data = await response.json()
    allResults = allResults.concat(Array.isArray(data) ? data : [data])
    const linkHeader = response.headers.get('Link')
    if (estimatedTotal === null) estimatedTotal = extractTotalEstimate(linkHeader)
    url = extractNextPageUrl(linkHeader)
    if (onProgress) onProgress(allResults.length, estimatedTotal)
  }

  return allResults
}

export async function canvasPut(path, body = {}) {
  const url = await buildUrl(path)
  const response = await executeRequest({ url, method: 'PUT', body: JSON.stringify(body) })
  return response.json()
}

export async function canvasPost(path, body = {}) {
  const url = await buildUrl(path)
  const response = await executeRequest({ url, method: 'POST', body: JSON.stringify(body) })
  return response.json()
}

export async function canvasDelete(path) {
  const url = await buildUrl(path)
  await executeRequest({ url, method: 'DELETE' })
}
