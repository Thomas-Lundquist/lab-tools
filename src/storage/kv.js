// Thin async wrapper around localStorage. Mirrors the old chrome.storage
// read/write shape (get a key, set a key) so every caller in storage/ and
// security/ ported over unchanged — just swap chrome.storage.local/sync for
// this. There's no sync tier here: the web app has no chrome.storage.sync
// equivalent, so each browser/device keeps its own independent copy (see
// CLAUDE.md). Kept async for drop-in compatibility even though localStorage
// itself is synchronous.

export async function kvGet(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

export async function kvSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export async function kvClear() {
  localStorage.clear()
}
