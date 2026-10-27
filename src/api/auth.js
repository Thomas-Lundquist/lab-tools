import { AuthError, ApiError } from './errors.js'

// Routed through the same-origin proxy (api/canvas.js) rather than fetching
// Canvas directly — see the comment at the top of api/request.js for why a
// direct browser fetch to Canvas never works.
export async function verifyToken(canvasUrl, token) {
  const base = canvasUrl.replace(/\/$/, '')
  // Trim: a copy-pasted token with an incidental trailing newline/space is a
  // silent, common paste artifact — the token "looks right" but Canvas
  // rejects it as invalid, which is indistinguishable from a bad token
  // without inspecting the raw bytes.
  const response = await fetch('/api/canvas/api/v1/users/self', {
    headers: {
      'Authorization': `Bearer ${token.trim()}`,
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
