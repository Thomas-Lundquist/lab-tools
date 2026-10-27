import { kvGet, kvSet } from './kv.js'

export const DEFAULTS = {
  // General
  textSize: 'medium',            // 'small' | 'medium' | 'large' | 'extra-large'
  palette: 'bauhaus',            // 'bauhaus' | 'modern' — full theme, no per-color customization
  themeMode: 'system',           // 'light' | 'dark' | 'system'
  defaultCourse: 'last_used',    // 'last_used' | 'ask'
  homepageDisplayMode: 'tiles',  // 'tiles' | 'list'

  // Popup
  popupPinnedTools: null,        // null = show all tools

  // Course selector
  hiddenCourseIds: [],           // course ids excluded from the selector entirely
  favoriteCourseIds: [],         // course ids pinned to the top of the selector, in favorited order

  // Internal
  lastUsedCourseId: null,
}

export async function getPreferences() {
  const stored = await kvGet('preferences')
  return { ...DEFAULTS, ...(stored ?? {}) }
}

export async function setPreference(key, value) {
  const current = await getPreferences()
  const updated = { ...current, [key]: value }
  await kvSet('preferences', updated)
  return updated
}

export async function setLastUsedCourse(courseId) {
  return setPreference('lastUsedCourseId', courseId)
}

// Resolves which course a tool should pre-select once its course list has
// loaded, honoring the `defaultCourse` setting:
//   - `override` (e.g. a courseId carried in a deep-link URL param) always
//     wins when it's present in the fetched list.
//   - `defaultCourse: 'ask'` leaves nothing pre-selected — pick explicitly.
//   - Otherwise (`'last_used'`, the default) falls back to
//     `prefs.lastUsedCourseId` if that course is still in the list, then the
//     first course.
export function resolveInitialCourseId(courseList, { override, prefs } = {}) {
  if (override) {
    const match = courseList.find(c => c.id === String(override))
    if (match) return match.id
  }
  if (prefs?.defaultCourse === 'ask') return null
  const lastId = prefs?.lastUsedCourseId
  if (lastId && courseList.some(c => c.id === lastId)) return lastId
  return courseList[0]?.id ?? null
}

// Applies the Settings page's "which courses appear in the selector, and
// which are favorited" preferences to a freshly-fetched course list: drops
// hidden courses entirely, then stable-sorts favorites to the top (relative
// order within each group — favorited and non-favorited — is preserved).
export function visibleCourses(courseList, prefs) {
  const hidden = new Set(prefs?.hiddenCourseIds ?? [])
  const favorites = new Set(prefs?.favoriteCourseIds ?? [])
  return courseList
    .filter(c => !hidden.has(c.id))
    .slice()
    .sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)))
}
