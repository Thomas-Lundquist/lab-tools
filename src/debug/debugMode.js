// Debug (dry-run) mode: nothing is written to Canvas; every write is recorded
// for a report instead (see DebugReport.jsx). DECISIONS.md, 2026-11-01.
//
// - The switch lives in memory only, so every relaunch starts in live mode —
//   the teacher can't forget it's on and wonder why grades never arrived.
// - On entry, this device's data is copied to a sandbox (storage/kv.js
//   SANDBOX_PREFIX) and every store works there; sync is paused. On exit the
//   sandbox is thrown away, so test edits and fake ids never reach real data.
// - Reads still go to real Canvas, so tests run against real courses. A read
//   of something only created in this session (a `debug-N` id) is answered
//   with an empty reply instead of a Canvas 404.
// - Safety checks run exactly as in live mode: a blocked write throws the same
//   CheckError and is shown red in the report.

import { setWriteInterceptor } from '../api/request.js'
import { KEY_PREFIX, SANDBOX_PREFIX, setKeyPrefix, copyKeys, removeKeysWithPrefix } from '../storage/kv.js'
import { pauseSync, resumeSync } from '../storage/sync.js'
import { getPreferences } from '../storage/preferences.js'
import { applyPalette, applyDarkMode, applyTextSize } from '../utils/color.js'
import { describeWrite } from './describe.js'

let state = { active: false, entries: [] }
const listeners = new Set()
let seq = 0
let currentAction = null

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

export const isDebug = () => state.active
export const getDebugState = () => state
export function subscribeDebug(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Groups the writes an action makes under its name in the report. The PIN
// gate wraps every gated action in this (security/usePinGate.jsx).
export async function withAction(label, fn) {
  const prev = currentAction
  currentAction = label ?? null
  try { return await fn() } finally { currentAction = prev }
}

export async function enterDebug() {
  if (state.active) return
  await pauseSync()
  removeKeysWithPrefix(SANDBOX_PREFIX)
  // Sync's own bookkeeping stays behind: the sandbox never syncs.
  copyKeys(KEY_PREFIX, SANDBOX_PREFIX, key => !key.startsWith('sync:') && key !== 'diagnostics')
  setKeyPrefix(SANDBOX_PREFIX)
  seq = 0
  setState({ active: true, entries: [] })
}

export async function exitDebug() {
  if (!state.active) return
  setKeyPrefix(KEY_PREFIX)
  removeKeysWithPrefix(SANDBOX_PREFIX)
  setState({ active: false, entries: [] })
  const p = await getPreferences()
  applyPalette(p.palette)
  applyDarkMode(p.themeMode ?? 'system')
  applyTextSize(p.textSize ?? 'medium')
  resumeSync()
}

// A tab closed while in debug mode leaves its sandbox behind; clear it at boot.
export function clearLeftoverSandbox() {
  removeKeysWithPrefix(SANDBOX_PREFIX)
}

export function clearReport() {
  setState({ entries: [] })
}

// ---- the interceptor request.js calls before every write ----

// What Canvas would roughly have replied, so multi-step flows keep going:
// a create gets a fake `debug-N` id the next step can use.
export function fakeReply(method, path, body, n) {
  if (method === 'DELETE') return null
  if (method === 'GET') return /\/debug-\d+$/.test(path) ? { id: path.split('/').pop() } : []
  const courseId = path.match(/\/courses\/(\d+)/)?.[1]
  if (/\/custom_data/.test(path)) return { data: body?.data }
  const values = body && typeof body === 'object' ? Object.values(body) : []
  const inner = values.length === 1 && values[0] && typeof values[0] === 'object' && !Array.isArray(values[0]) ? values[0] : body
  const id = method === 'POST' ? `debug-${n}` : path.match(/\/(\d+|debug-\d+)$/)?.[1] ?? `debug-${n}`
  return { ...inner, id, ...(courseId ? { course_id: courseId } : {}) }
}

setWriteInterceptor(({ method, url, body, context, operation }) => {
  if (!state.active) return undefined
  const path = new URL(url).pathname
  if (method === 'GET') return { value: fakeReply('GET', path) }
  context.debug = true
  const n = ++seq
  const checks = context.checks ?? []
  const { text, categories } = describeWrite({ method, path, body, context })
  const entry = {
    n,
    at: new Date().toISOString(),
    action: currentAction,
    method,
    path,
    operation,
    body: body ?? null,
    context: {
      studentName: context.studentName ?? null,
      assignmentLabel: context.assignmentLabel ?? null,
      kind: context.kind ?? null,
      absent: !!context.absent,
    },
    checks,
    blocked: checks.some(c => c.level === 'block'),
    text,
    categories,
  }
  setState({ entries: [...state.entries, entry] })
  return { value: fakeReply(method, path, body, n) }
})
