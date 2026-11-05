// Rotating seats, the saved original, and one-step undo. Ported from
// ../kitchen-rotator/js/rotation.js. Every function mutates the state it's
// given; callers pass a clone (storage/rotation.js's updateRotation).
import { activeKitchenIdxs, staffedKitchenIdxs, clearAbsences, seatedIds, MAX_KITCHEN } from './model.js'
import { advanceCursors } from './duties.js'
import { buildRotationRecord } from './history.js'

// One rotation of one block: everyone moves to the next job (the last seat
// wraps to the top), today's attendance lapses, and the duty and sink cursors
// move on if anybody was in. Uses active, not staffed: a kitchen whose whole
// crew is out still turns, or they'd come back to the wrong jobs.
export function advanceBlock(state, blockId) {
  const block = state.blocks[blockId]
  if (!block) return
  // Read BEFORE the marks are cleared: afterwards an all-absent class looks full.
  const hadStaff = staffedKitchenIdxs(block).length > 0
  for (const ki of activeKitchenIdxs(block)) {
    const s = block.kitchens[ki].students.slice()
    if (s.length > 1) s.unshift(s.pop())
    block.kitchens[ki].students = s
  }
  clearAbsences(block)
  advanceCursors(state, blockId, hadStaff)
}

// Rotates a set of blocks (one day, or one card's Advance) and returns the
// history records of what they just finished. Every record is built before any
// block advances: the day-wide duty assignment reads every block on the day,
// so advancing A1 first would change what A2 and A3 are recorded as having done.
export function rotateBlocks(state, ids, { batchId, today }) {
  const records = ids.map(id => buildRotationRecord(state, id, { batchId, today })).filter(Boolean)
  ids.forEach(id => advanceBlock(state, id))
  return records
}

// --- undo: one step, in memory only ---
// A snapshot that survived a reload could undo yesterday's rotation into
// today's class. No undo is safer than a stale one.

export function snapshotBlocks(state, ids, label, batchId) {
  const blocks = {}
  for (const id of ids) {
    const b = state.blocks[id]
    if (!b) continue
    // Not captured: attendance. Undoing a rotation must not also undo the
    // register taken after it.
    blocks[id] = { kitchens: b.kitchens.map(k => k.students.slice()), dutyIndex: b.dutyIndex, centerSink: b.centerSink }
  }
  return { label, blocks, batchId }
}

export function applyUndo(state, snap) {
  for (const [id, s] of Object.entries(snap.blocks)) {
    const b = state.blocks[id]
    if (!b) continue // removed since
    // A student moved or unseated since the rotation: put back what the
    // snapshot had, but never seat anyone twice.
    const seatedNow = new Set(seatedIds(b))
    const current = b.kitchens.map(k => k.students.slice())
    const placed = new Set()
    b.kitchens.forEach((k, ki) => {
      k.students = (s.kitchens[ki] || []).filter(uid => seatedNow.has(uid) && !placed.has(uid) && placed.add(uid))
    })
    // Anyone seated since the snapshot keeps a seat, in the kitchen they're in.
    keepUnplaced(b, current, placed)
    b.dutyIndex = s.dutyIndex
    b.centerSink = s.centerSink
  }
}

// After a re-seat from a saved arrangement: every student seated before it
// (`current`) who the arrangement didn't place goes back in their own kitchen,
// or the first with room if theirs is now full. Nobody is unseated by it.
function keepUnplaced(block, current, placed) {
  current.forEach((students, ki) => {
    for (const uid of students) {
      if (placed.has(uid)) continue
      const own = block.kitchens[ki]
      const k = own.students.length < MAX_KITCHEN ? own : block.kitchens.find(k => k.students.length < MAX_KITCHEN)
      if (k) { k.students.push(uid); placed.add(uid) }
    }
  })
}

// --- saved original ---

export function saveOriginal(state, blockId) {
  const b = state.blocks[blockId]
  b.kitchens.forEach(k => { k.original = k.students.slice() })
  b.dutyIndex = 0
  b.centerSink = 0
}

// Puts the saved seating back. Only students still seated in this class come
// back (a student who left the section stays gone); anyone seated since the
// original was saved stays in the kitchen they're in now, after its original
// members, so nobody is unseated by a restore.
export function restoreOriginal(state, blockId) {
  const b = state.blocks[blockId]
  const seatedNow = new Set(seatedIds(b))
  const current = b.kitchens.map(k => k.students.slice())
  const placed = new Set()
  b.kitchens.forEach(k => {
    k.students = k.original.filter(uid => seatedNow.has(uid) && !placed.has(uid) && placed.add(uid))
  })
  keepUnplaced(b, current, placed)
  b.dutyIndex = 0
  b.centerSink = 0
}

export function hasOriginal(block) {
  return block.kitchens.some(k => k.original.length > 0)
}
