// Rotating seats, the saved original, and one-step undo. Ported from
// ../kitchen-rotator/js/rotation.js. Every function mutates the state it's
// given; callers pass a clone (storage/rotation.js's updateRotation).
import { activeKitchenIdxs, staffedKitchenIdxs, seatedIds, dayView, MAX_KITCHEN } from './model.js'
import { advanceCursors } from './duties.js'
import { buildRotationRecord } from './history.js'

// One rotation of one block: everyone moves to the next job (the last seat
// wraps to the top), and the duty and sink cursors move on if anybody was in
// last session. Uses active, not staffed: a kitchen whose whole crew is out
// still turns, or they'd come back to the wrong jobs.
//
// Rotation happens at the START of class (DECISIONS.md, 2026-11-14), so it
// doesn't clear attendance: marks taken before rotating are today's, and the
// rotator's own marks lapse overnight anyway (expireAbsences). `hadStaff` is
// whether last session had anyone in (from its record, history.js's
// recordHadStaff); left out, it's read from the current marks.
export function advanceBlock(state, blockId, view, { hadStaff } = {}) {
  const block = state.blocks[blockId]
  if (!block) return
  const staffed = hadStaff ?? staffedKitchenIdxs(block, view).length > 0
  for (const ki of activeKitchenIdxs(block)) {
    const s = block.kitchens[ki].students.slice()
    if (s.length > 1) s.unshift(s.pop())
    block.kitchens[ki].students = s
  }
  advanceCursors(state, blockId, staffed)
}

// Rotates a set of blocks (one day, or one card's Advance) at the start of
// class and returns today's records: the jobs, duties and sink each class is
// about to do. Every block advances before any record is built, since the
// day-wide duty assignment reads every block on the day. `atts` is today's
// attendance per block (model.js's dayView); `prevHadStaff` per block says
// whether last session had anyone in. Today's records then follow attendance
// for the rest of the day (history.js's refreshTodaysRecord).
export function rotateBlocks(state, ids, { batchId, today, atts = {}, prevHadStaff = {} }) {
  ids.forEach(id => advanceBlock(state, id, undefined, { hadStaff: prevHadStaff[id] ?? true }))
  const views = Object.fromEntries(Object.keys(state.blocks).map(id => [id, dayView(state.blocks[id], atts[id] ?? null)]))
  return ids.map(id => buildRotationRecord(state, id, { batchId, today, views, allowEmpty: true })).filter(Boolean)
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
