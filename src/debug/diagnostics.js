// Diagnostics log: the last 50 failures on this device — every Canvas
// failure (logged at the request choke point, so failures a caller swallows,
// like one student in a commit loop, are still recorded), every safety-check
// block, and uncaught app errors. Shown on Settings › Testing, copyable for
// Claude through scrub.js.
//
// Stored in this device's localStorage under the real prefix (it survives a
// relaunch and debug mode alike) and never synced. Entries hold codes,
// generalised operations, and messages — no student names; ids that slip into
// a Canvas message are scrubbed when copied.

import { setFailureListener } from '../api/request.js'
import { KEY_PREFIX } from '../storage/kv.js'
import { currentRoute } from '../utils/nav.js'

const KEY = KEY_PREFIX + 'diagnostics'
const MAX = 50
const DEDUPE_MS = 60_000
const LOGGED = Symbol('labtools.logged')

const listeners = new Set()
let cache = null

function read() {
  if (cache) return cache
  try { cache = JSON.parse(localStorage.getItem(KEY) || '[]') } catch { cache = [] }
  return cache
}

function write(list) {
  cache = list
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* storage full or unavailable */ }
  listeners.forEach(l => l())
}

export const getDiagnostics = () => read()
export function subscribeDiagnostics(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function clearDiagnostics() { write([]) }

export function logError(err, { operation = null, debug = false } = {}) {
  if (err && typeof err === 'object') {
    if (err[LOGGED]) return
    try { err[LOGGED] = true } catch { /* frozen */ }
  }
  const entry = {
    at: new Date().toISOString(),
    code: err?.code ?? 'LT-APP',
    name: err?.name ?? 'Error',
    operation: operation ?? err?.operation ?? null,
    message: String(err?.message ?? err),
    canvasMessage: err?.canvasMessage ?? null,
    nextStep: err?.nextStep ?? null,
    checks: err?.checks?.map(c => `${c.level} ${c.rule}: ${c.message}`) ?? null,
    route: safeRoute(),
    debug,
    count: 1,
  }
  const list = read()
  const last = list[0]
  // A repeat of the same failure (sync retrying while offline) bumps a count
  // instead of filling the log.
  if (last && last.code === entry.code && last.operation === entry.operation && last.message === entry.message
      && Date.parse(entry.at) - Date.parse(last.at) < DEDUPE_MS) {
    write([{ ...last, at: entry.at, count: last.count + 1 }, ...list.slice(1)])
  } else {
    write([entry, ...list].slice(0, MAX))
  }
}

function safeRoute() {
  try { return currentRoute() } catch { return null }
}

// Wire up: every Canvas failure, plus anything the app throws and never catches.
export function installDiagnostics() {
  setFailureListener((err, { operation, context }) => logError(err, { operation, debug: !!context?.debug }))
  window.addEventListener('error', e => logError(e.error ?? new Error(e.message), { operation: appLocation(e.error) }))
  window.addEventListener('unhandledrejection', e => logError(e.reason, { operation: appLocation(e.reason) }))
}

// For an app bug, where in the bundle it happened (first stack frame).
function appLocation(err) {
  const frame = String(err?.stack ?? '').split('\n').find(l => /\.js/.test(l))
  return frame ? `at ${frame.trim().replace(/^at\s+/, '').replace(/^.*\/assets\//, 'assets/')}` : null
}

// The build this device is running, e.g. 'app-D-aeDGv8.js' — tells Claude which code produced a report.
export function buildId() {
  try { return new URL(import.meta.url).pathname.split('/').pop() } catch { return 'unknown' }
}
