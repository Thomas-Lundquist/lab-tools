import { canvasGet } from './request.js'

// "Who am I" against the teacher's live Canvas session. There's no token to
// verify any more — if this succeeds, the session is good.
//
// Cached at module scope: several unrelated screens (onboarding, Settings, the
// Lab tab's accept-Canvas-score flow) all just want "my own Canvas id" and
// otherwise redundantly re-fetch the same thing. The in-flight promise itself
// is cached, so concurrent callers in the same tick share one request; a
// failure clears the cache so a transient network blip doesn't poison it for
// the rest of the session.
let cached = null
export async function getCurrentUser() {
  if (!cached) {
    cached = canvasGet('/api/v1/users/self')
      .then(user => ({
        id: String(user.id),
        name: user.name,
        shortName: user.short_name,
        email: user.email,
        avatarUrl: user.avatar_url,
      }))
      .catch(err => { cached = null; throw err })
  }
  return cached
}
