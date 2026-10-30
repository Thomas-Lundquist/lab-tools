// Thin async wrapper around localStorage. Mirrors the old chrome.storage
// read/write shape (get a key, set a key) so every caller in storage/ and
// security/ ported over unchanged. Kept async for drop-in compatibility even
// though localStorage itself is synchronous.
//
// The app runs inside the Canvas origin (see DECISIONS.md, "running the app
// inside Canvas"), so this localStorage is *Canvas's own*. Every key this app
// writes carries KEY_PREFIX, and kvClear removes only prefixed keys — a bare
// localStorage.clear() would wipe Canvas's data too. Code that touches
// localStorage directly (utils/color.js, public/theme-init.js, labs/App.jsx)
// must use the same prefix.

export const KEY_PREFIX = 'labtools:'

export async function kvGet(key) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key)
    return raw == null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

export async function kvSet(key, value) {
  localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value))
}

export async function kvClear() {
  const ours = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(KEY_PREFIX)) ours.push(k)
  }
  ours.forEach(k => localStorage.removeItem(k))
}
