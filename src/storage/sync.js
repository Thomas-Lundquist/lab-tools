// Cross-device sync through Canvas custom data (DECISIONS.md, 2026-11-01).
//
// localStorage stays the working copy: every store reads and writes it
// exactly as before, so the app works the same when Canvas is slow or
// unreachable. Synced keys are mirrored to documents in the teacher's own
// Canvas custom data (api/customData.js), so a second device picks them up.
//
// What syncs: `preferences`, `setup` (course/lab/term definitions and lab
// flags), and `labGrading/<labId>` (grading flags + drafts, one document per
// lab so a save never re-sends the whole year). What doesn't: the PIN and
// lockout state, the activity log, and onboarding status. Those belong to the
// device, like a phone passcode.
//
// For each synced key, sync remembers the *base*: the copy Canvas held the last
// time the two agreed. A push re-reads Canvas and three-way merges
// (storage/merge.js), so edits made on another device since the base survive,
// key by key. A pull applies Canvas's copy, merging over any edits not yet
// pushed. Sync never deletes a local key because Canvas lacks it: it uploads
// it instead, so a failed or empty read can't wipe this device's data.

import { localGet, localSet, localKeys, onKvWrite } from './kv.js'
import * as customData from '../api/customData.js'
import { AuthError } from '../api/errors.js'
import { merge3, deepEqual } from './merge.js'

export const isSyncedKey = key =>
  key === 'preferences' || key === 'setup' || key.startsWith('labGrading/') || key.startsWith('kitchens/') || key.startsWith('rollups/') ||
  key === 'rotation' || key.startsWith('rotationHistory/')

const baseKey = key => `sync:base:${key}`
const DIRTY_KEY = 'sync:dirty'

function parse(raw) {
  try { return { ok: true, value: JSON.parse(raw) } } catch { return { ok: false } }
}

// The sync logic, with storage and Canvas passed in so tests can run two
// "devices" against one fake Canvas. `store` is { get, set, keys } (set with
// undefined removes); `remote` is api/customData.js's shape.
export function createSyncEngine({ store, remote }) {
  const dirty = () => new Set(store.get(DIRTY_KEY) ?? [])
  const saveDirty = set => store.set(DIRTY_KEY, set.size ? [...set] : undefined)

  // Pulls and pushes run one at a time, never interleaved.
  let chain = Promise.resolve()
  const serial = fn => {
    const run = chain.then(fn)
    chain = run.catch(() => {})
    return run
  }

  // Called on every local write (kvSet). Synchronous, so a write is never lost
  // to a crash between writing and noting it.
  function noteWrite(key) {
    if (!isSyncedKey(key)) return
    const d = dirty()
    if (!d.has(key)) { d.add(key); saveDirty(d) }
  }

  const hasPending = () => dirty().size > 0

  // Bring Canvas's copy down. Returns the keys whose local value changed.
  function pull() {
    return serial(async () => {
      const docs = await remote.getAllDocs()
      // No awaits from here on: nothing else can write storage mid-merge.
      const remoteValues = new Map()
      const unreadable = new Set()
      for (const [key, raw] of Object.entries(docs)) {
        if (!isSyncedKey(key)) continue
        const p = parse(raw)
        if (p.ok) remoteValues.set(key, p.value)
        else unreadable.add(key)
      }
      const d = dirty()
      const changed = []
      const keys = new Set([...remoteValues.keys(), ...store.keys().filter(isSyncedKey)])
      for (const key of keys) {
        if (unreadable.has(key)) continue
        const local = store.get(key)
        const remoteValue = remoteValues.get(key)
        if (remoteValue === undefined) {
          // Canvas has no copy (never uploaded, or erased): upload this one.
          if (local !== undefined) { d.add(key); store.set(baseKey(key), undefined) }
          continue
        }
        // Merge when this device has edits Canvas hasn't seen: unpushed ones,
        // or a local copy that predates sync (no base) — e.g. two devices that
        // were both set up before sync existed. Otherwise Canvas's copy wins.
        const base = store.get(baseKey(key))
        const hasOwnEdits = d.has(key) || (base === undefined && local !== undefined)
        const next = hasOwnEdits ? merge3(base, local, remoteValue) : remoteValue
        if (!deepEqual(next, local)) { store.set(key, next); changed.push(key) }
        store.set(baseKey(key), remoteValue)
        if (deepEqual(next, remoteValue)) d.delete(key)
        else d.add(key)
      }
      saveDirty(d)
      return changed
    })
  }

  // Send local edits up. Returns the keys whose local value changed because
  // another device had edited the same document.
  function push() {
    return serial(async () => {
      const changed = []
      for (const key of dirty()) {
        const local = store.get(key)
        if (local === undefined) { const d = dirty(); d.delete(key); saveDirty(d); continue }
        const raw = await remote.getDoc(key)
        const parsed = raw === undefined ? { ok: false } : parse(raw)
        const remoteValue = parsed.ok ? parsed.value : undefined
        const merged = merge3(store.get(baseKey(key)), local, remoteValue) ?? local
        if (!parsed.ok || !deepEqual(merged, remoteValue)) {
          await remote.putDoc(key, JSON.stringify(merged))
        }
        const now = store.get(key)
        if (deepEqual(now, local)) {
          if (!deepEqual(merged, local)) { store.set(key, merged); changed.push(key) }
          const d = dirty(); d.delete(key); saveDirty(d)
        } else {
          // Edited again while this push was in flight: keep that edit on top
          // of what was just pushed, and leave the key dirty for the next push.
          store.set(key, merge3(local, now, merged))
        }
        store.set(baseKey(key), merged)
      }
      return changed
    })
  }

  // Delete every synced document from Canvas. Local copies are untouched.
  function eraseRemote() {
    return serial(() => remote.deleteAllDocs())
  }

  // Resolves once any pull/push already queued has finished.
  const idle = () => chain

  return { noteWrite, hasPending, pull, push, eraseRemote, idle }
}

// ---- the app's instance: scheduling and status ----

const engine = createSyncEngine({
  store: { get: localGet, set: localSet, keys: localKeys },
  remote: customData,
})

const PUSH_DELAY_MS = 1500
const RETRY_DELAY_MS = 30_000
const PULL_MIN_INTERVAL_MS = 10_000

// phase: 'idle' (not started) | 'syncing' | 'synced' | 'pending' (local edits
// waiting to go up) | 'error'. `remoteChanged` means a sync brought in edits
// from another device after the page had loaded, so what's on screen may be
// stale; the UI offers a refresh rather than remounting under the teacher.
let status = { phase: 'idle', error: null, lastSyncedAt: null, remoteChanged: false }
const statusListeners = new Set()
let inFlight = 0
let uiShown = false
let started = false
let pushTimer = null
let retryTimer = null
let lastPullAt = 0

function setStatus(patch) {
  status = { ...status, ...patch }
  statusListeners.forEach(l => l())
}

export function getSyncStatus() { return status }

export function subscribeSyncStatus(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function dismissRemoteChange() {
  setStatus({ remoteChanged: false })
}

async function run(task) {
  inFlight++
  setStatus({ phase: 'syncing' })
  try {
    const changed = await task()
    clearTimeout(retryTimer)
    inFlight--
    setStatus({
      phase: inFlight ? 'syncing' : engine.hasPending() ? 'pending' : 'synced',
      error: null,
      lastSyncedAt: new Date().toISOString(),
      ...(changed.length && uiShown ? { remoteChanged: true } : {}),
    })
    return changed
  } catch (err) {
    inFlight--
    setStatus({ phase: 'error', error: err.message })
    // An expired session needs the teacher to log in and relaunch; retrying
    // on a timer won't fix it.
    if (!(err instanceof AuthError)) {
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => { syncNow().catch(() => {}) }, RETRY_DELAY_MS)
    }
    throw err
  }
}

// Debug mode works on a sandbox copy of local data (storage/kv.js) and must
// not sync it anywhere. pauseSync waits for any sync already running to finish
// first, so nothing is half-written when the storage prefix switches.
let paused = false

export async function pauseSync() {
  paused = true
  clearTimeout(pushTimer)
  pushTimer = null
  await engine.idle()
}

export function resumeSync() {
  paused = false
  syncNow().catch(() => {})
}

// Pull, then push anything waiting. Resolves to the keys changed locally.
export function syncNow() {
  if (paused) return Promise.resolve([])
  clearTimeout(pushTimer)
  lastPullAt = Date.now()
  return run(async () => {
    const pulled = await engine.pull()
    const pushed = await engine.push()
    return [...new Set([...pulled, ...pushed])]
  })
}

function pushNow() {
  clearTimeout(pushTimer)
  pushTimer = null
  if (paused) return
  run(() => engine.push()).catch(() => {})
}

function schedulePush() {
  if (paused) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(pushNow, PUSH_DELAY_MS)
  if (status.phase !== 'syncing' && status.phase !== 'error') setStatus({ phase: 'pending' })
}

// Start syncing. Resolves after the first pull, or after `timeoutMs` if Canvas
// is slow — the app then renders from local data and picks up anything that
// arrives late through the refresh prompt.
export async function startSync({ timeoutMs = 5000 } = {}) {
  if (!started) {
    started = true
    onKvWrite(key => {
      if (paused || !isSyncedKey(key)) return
      engine.noteWrite(key)
      schedulePush()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // The iPad may suspend the tab: send pending edits now.
        if (pushTimer) pushNow()
      } else if (Date.now() - lastPullAt > PULL_MIN_INTERVAL_MS) {
        syncNow().catch(() => {})
      }
    })
  }
  const first = syncNow().catch(() => {})
  await Promise.race([first, new Promise(r => setTimeout(r, timeoutMs))])
  uiShown = true
}

// For Settings' "Reset": optionally erase the Canvas copy first, then wipe
// this device's keys (the caller's kvClear) and start clean.
export async function eraseSyncedCopy() {
  clearTimeout(pushTimer)
  pushTimer = null
  await run(async () => { await engine.eraseRemote(); return [] })
}

// After a local wipe: forget in-memory state, and (unless the Canvas copy was
// erased too) pull it back down so course setup survives a forgotten PIN.
// The caller remounts the app afterwards, so no refresh prompt is needed.
export async function afterLocalReset({ resync }) {
  clearTimeout(pushTimer)
  pushTimer = null
  if (resync) await syncNow().catch(() => {})
  setStatus({ remoteChanged: false })
}
