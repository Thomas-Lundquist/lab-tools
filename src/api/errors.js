// Typed errors for every way a Canvas call can fail. Callers pattern-match on
// the class (or `code`), never on raw HTTP status. Each carries:
//   code          — short reference the teacher can read back, e.g. 'LT-422'
//   operation     — method + path with ids generalised, e.g. 'PUT /courses/:id/assignments/:id'
//   canvasMessage — Canvas's own explanation, when it gave one
//   nextStep      — what to do about it, in plain words
// `message` is the friendly sentence plus the code, so existing
// `toast(\`Could not …: ${err.message}\`)` call sites read well unchanged.

function friendly(base, canvasMessage, code) {
  return `${base}${canvasMessage ? ` — Canvas said: “${canvasMessage}”` : ''} (${code})`
}

function decorate(err, info) {
  Object.assign(err, { operation: null, canvasMessage: null, nextStep: null }, info)
}

export class AuthError extends Error {
  constructor(message, info = {}) {
    super(message)
    this.name = 'AuthError'
    this.type = 'auth'
    decorate(this, { code: 'LT-401', statusCode: 401, nextStep: 'Log in to Canvas again, then relaunch Lab Tools.', ...info })
  }
}

export class RateLimitError extends Error {
  constructor(message, retryAfterMs, info = {}) {
    super(message)
    this.name = 'RateLimitError'
    this.type = 'rate_limit'
    this.retryAfterMs = retryAfterMs
    decorate(this, { code: 'LT-403R', statusCode: 403, nextStep: 'Wait a minute, then try again.', ...info })
  }
}

export class NotFoundError extends Error {
  constructor(message, info = {}) {
    super(message)
    this.name = 'NotFoundError'
    this.type = 'not_found'
    decorate(this, { code: 'LT-404', statusCode: 404, nextStep: 'Refresh — the item may have been deleted or moved in Canvas.', ...info })
  }
}

export class ApiError extends Error {
  constructor(message, statusCode, info = {}) {
    super(message)
    this.name = 'ApiError'
    this.type = 'api_error'
    this.statusCode = statusCode
    decorate(this, { code: `LT-${statusCode >= 500 ? '5xx' : statusCode}`, ...info })
  }
}

// 403 that isn't throttling: the Canvas account isn't allowed to do this.
export class PermissionError extends ApiError {
  constructor(message, info = {}) {
    super(message, 403, { code: 'LT-403P', nextStep: 'Check that you are a teacher in this course in Canvas.', ...info })
    this.name = 'PermissionError'
    this.type = 'permission'
  }
}

// The request never reached Canvas (offline, Wi-Fi drop, DNS).
export class NetworkError extends Error {
  constructor(message, info = {}) {
    super(message)
    this.name = 'NetworkError'
    this.type = 'network'
    decorate(this, { code: 'LT-NET', statusCode: null, nextStep: 'Check the Wi-Fi connection, then try again.', ...info })
  }
}

// A safety check (debug/checks.js) refused to send a write. Nothing reached Canvas.
export class CheckError extends Error {
  constructor(checks, info = {}) {
    super(`Lab Tools stopped this before sending it: ${checks.map(c => c.message).join('; ')} (LT-CHECK)`)
    this.name = 'CheckError'
    this.type = 'check'
    this.checks = checks
    decorate(this, { code: 'LT-CHECK', statusCode: null, nextStep: 'Nothing was sent. Tell Claude the code and the check that failed.', ...info })
  }
}

// Build the right error for a failed Canvas response.
export function errorForResponse(status, statusText, { canvasMessage = null, operation = null, rateLimited = false, backoffMs = 10000 } = {}) {
  const info = { operation, canvasMessage }
  if (status === 401) {
    return new AuthError(friendly('Your Canvas session has expired — log in to Canvas again, then relaunch Lab Tools', null, 'LT-401'), info)
  }
  if (status === 403 && rateLimited) {
    return new RateLimitError(friendly('Canvas is limiting how fast requests can go — wait a minute and try again', null, 'LT-403R'), backoffMs, info)
  }
  if (status === 403) {
    return new PermissionError(friendly("Canvas says your account isn't allowed to do that", canvasMessage, 'LT-403P'), info)
  }
  if (status === 404) {
    return new NotFoundError(friendly("Canvas couldn't find that item — it may have been deleted", canvasMessage, 'LT-404'), info)
  }
  const base = {
    400: "Canvas didn't accept the request",
    409: 'Canvas reported a conflict with something already there',
    422: 'Canvas rejected the values',
  }[status] ?? (status >= 500 ? 'Canvas had a server problem — try again shortly' : `Canvas request failed (${status} ${statusText})`)
  const code = `LT-${status >= 500 ? '5xx' : status}`
  const nextStep = status >= 500 ? 'Wait a few minutes and try again; Canvas may be down.' : 'Tell Claude the code and what you were doing.'
  return new ApiError(friendly(base, canvasMessage, code), status, { ...info, nextStep })
}

export function networkError(cause, operation) {
  return new NetworkError(friendly(`Couldn't reach Canvas — check the Wi-Fi connection${cause?.message ? ` (${cause.message})` : ''}`, null, 'LT-NET'), { operation })
}
