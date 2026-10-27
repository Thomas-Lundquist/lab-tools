import { AuthError, ApiError } from './errors.js'

// Routed through the same-origin proxy (api/canvas/[...path].js) rather than
// fetching Canvas directly — see the comment at the top of api/request.js
// for why a direct browser fetch to Canvas never works.
export async function verifyToken(canvasUrl, token) {
  const base = canvasUrl.replace(/\/$/, '')
  const response = await fetch('/api/canvas/api/v1/users/self', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Canvas-Base': base,
    },
  })

  if (response.status === 401) throw new AuthError('Token is invalid or expired.')
  if (!response.ok) throw new ApiError(`Verification failed: ${response.status}`, response.status)

  const user = await response.json()
  return {
    id: String(user.id),
    name: user.name,
    shortName: user.short_name,
    email: user.email,
    avatarUrl: user.avatar_url,
  }
}
