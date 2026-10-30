import { canvasGet } from './request.js'

// "Who am I" against the teacher's live Canvas session. There's no token to
// verify any more — if this succeeds, the session is good.
export async function getCurrentUser() {
  const user = await canvasGet('/api/v1/users/self')
  return {
    id: String(user.id),
    name: user.name,
    shortName: user.short_name,
    email: user.email,
    avatarUrl: user.avatar_url,
  }
}
