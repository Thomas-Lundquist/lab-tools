export class AuthError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuthError'
    this.type = 'auth'
  }
}

export class RateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message)
    this.name = 'RateLimitError'
    this.type = 'rate_limit'
    this.retryAfterMs = retryAfterMs
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NotFoundError'
    this.type = 'not_found'
  }
}

export class ApiError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.name = 'ApiError'
    this.type = 'api_error'
    this.statusCode = statusCode
  }
}
