// Kitchen Rotation storage. Two kinds of synced key (storage/sync.js):
//   rotation                    the whole board: classes, seats (Canvas student
//                               ids), duties, job titles, today's absences
//   rotationHistory/<blockId>   one class's participation records, capped
// Ids only, no names — the same posture as labGrading and kitchens. Separate
// from the Labs tool's kitchens on purpose (DECISIONS.md, 2026-11-04).
import { kvGet, kvSet } from './kv.js'
import { normalizeState, todayStamp } from '../pages/rotation/model.js'
import { normalizeHistory } from '../pages/rotation/history.js'

const STATE_KEY = 'rotation'
const historyKey = blockId => `rotationHistory/${blockId}`

export async function getRotation() {
  return normalizeState(await kvGet(STATE_KEY), todayStamp())
}

export async function saveRotation(state) {
  await kvSet(STATE_KEY, state)
  return state
}

// Applies `fn` to a fresh clone of the stored state and saves the result, so
// every change starts from what's stored now (including anything sync pulled
// in since the page loaded), never from a stale copy held by a component.
//
// Updates run one at a time: two started together (a field's blur and the
// checkbox click that caused it) would otherwise both read the same state and
// the second save would drop the first one's change.
let queue = Promise.resolve()
export function updateRotation(fn) {
  const run = queue.then(async () => {
    const state = structuredClone(await getRotation())
    const result = fn(state)
    await saveRotation(state)
    return { state, result }
  })
  queue = run.catch(() => {})
  return run
}

export async function getHistory(blockId) {
  return normalizeHistory(await kvGet(historyKey(blockId)))
}

export async function saveHistory(blockId, history) {
  await kvSet(historyKey(blockId), history)
}

// Synced keys are never deleted (sync re-downloads a missing one), so a
// removed class's history is emptied instead.
export async function clearHistory(blockId) {
  await kvSet(historyKey(blockId), { records: [] })
}
