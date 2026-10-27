import { AuthError, ApiError } from './errors.js'

export async function verifyToken(canvasUrl, token) {
  const url = `${canvasUrl.replace(/\/$/, '')}/api/v1/users/self`
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
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
