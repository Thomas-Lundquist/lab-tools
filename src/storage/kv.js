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
//
// Some keys also sync across devices through Canvas custom data (see
// storage/sync.js). kvSet tells write listeners which key changed so sync can
// push it; sync itself reads and writes through the local* functions, which
// don't notify, so applying a pulled value never looks like a fresh edit.

export const KEY_PREFIX = 'labtools:'

const writeListeners = new Set()

export function onKvWrite(listener) {
  writeListeners.add(listener)
  return () => writeListeners.delete(listener)
}

export function localGet(key) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key)
    return raw == null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function localSet(key, value) {
  if (value === undefined) localStorage.removeItem(KEY_PREFIX + key)
  else localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value))
}

// Every key this app has stored, without the prefix.
export function localKeys() {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(KEY_PREFIX)) keys.push(k.slice(KEY_PREFIX.length))
  }
  return keys
}

export async function kvGet(key) {
  return localGet(key)
}

export async function kvSet(key, value) {
  localSet(key, value)
  writeListeners.forEach(listener => listener(key))
}

// Local-only removal. Not for synced keys: sync never treats a missing value
// as a deletion (see sync.js), so removing one here would just re-download it.
export async function kvRemove(key) {
  localSet(key, undefined)
}

export async function kvClear() {
  localKeys().forEach(k => localStorage.removeItem(KEY_PREFIX + k))
}
