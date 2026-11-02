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

// Debug mode (src/debug/debugMode.js) points every store at a throwaway copy
// under SANDBOX_PREFIX, so a test session never touches the real data. Code
// that touches localStorage directly uses keyPrefix(), not KEY_PREFIX, so it
// follows the switch. ('labtools-debug:' doesn't start with 'labtools:', so
// the two never overlap.)
export const SANDBOX_PREFIX = 'labtools-debug:'
let prefix = KEY_PREFIX
export const keyPrefix = () => prefix
export function setKeyPrefix(p) { prefix = p }

// Raw helpers for the sandbox: copy or drop every key under a prefix.
export function rawKeysWithPrefix(p) {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(p)) keys.push(k.slice(p.length))
  }
  return keys
}
export function removeKeysWithPrefix(p) {
  rawKeysWithPrefix(p).forEach(k => localStorage.removeItem(p + k))
}
export function copyKeys(fromPrefix, toPrefix, keep = () => true) {
  for (const k of rawKeysWithPrefix(fromPrefix)) {
    if (keep(k)) localStorage.setItem(toPrefix + k, localStorage.getItem(fromPrefix + k))
  }
}

const writeListeners = new Set()

export function onKvWrite(listener) {
  writeListeners.add(listener)
  return () => writeListeners.delete(listener)
}

export function localGet(key) {
  try {
    const raw = localStorage.getItem(prefix + key)
    return raw == null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function localSet(key, value) {
  if (value === undefined) localStorage.removeItem(prefix + key)
  else localStorage.setItem(prefix + key, JSON.stringify(value))
}

// Every key this app has stored, without the prefix.
export function localKeys() {
  return rawKeysWithPrefix(prefix)
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
  removeKeysWithPrefix(prefix)
}
