// Extra duties and the center sink. Ported from ../kitchen-rotator/js/duties.js
// with the rules unchanged; only the state is passed in instead of global.
import { staffedKitchenIdxs } from './model.js'

export function dutiesForBlock(state, blockId) {
  return state.duties.filter(d => d.apply[blockId]).map(d => d.text)
}

// The blocks of one day, in the order they run. A block pulled out of the
// day's slots is appended so it still gets an assignment.
function dayBlockOrder(state, day, ensureId) {
  const ids = (state.slots[day] || []).filter(Boolean)
  if (ensureId && !ids.includes(ensureId)) ids.push(ensureId)
  return ids
}

// Extra duties are assigned for a WHOLE DAY at once, not block by block.
//
// A kitchen index is a physical station: K3 in first period is the same
// counter as K3 in third period, with a different class at it. Wiping those
// shelves twice is wasted work, so one physical kitchen must not draw the same
// duty twice in a day. Offsetting each block by its position in the day breaks
// the lockstep of blocks that share a pool and rotate together; the scan below
// repairs what arithmetic alone can't (blocks whose pools differ).
//
// Returns { blockId: { kitchenIdx: duty } }.
export function assignDayDuties(state, day, ensureId) {
  const usedByKitchen = new Map()
  const byBlock = {}

  dayBlockOrder(state, day, ensureId).forEach((id, pos) => {
    const block = state.blocks[id]
    const out = {}
    byBlock[id] = out
    if (!block) return

    const pool = dutiesForBlock(state, id)
    const takenHere = new Set()

    // Staffed, not active: a kitchen whose whole crew is out draws no duty.
    staffedKitchenIdxs(block).forEach((ki, seat) => {
      if (pool.length === 0) { out[ki] = ''; return }
      const used = usedByKitchen.get(ki) || []
      // Counted by SEAT (position among staffed kitchens), not kitchen number,
      // so staffing only K5 and K7 doesn't silently skip a duty.
      const start = (block.dutyIndex + seat + pos) % pool.length

      let pick = null
      // Best: new to this kitchen today, and unclaimed in this block.
      for (let i = 0; i < pool.length && pick === null; i++) {
        const cand = pool[(start + i) % pool.length]
        if (!used.includes(cand) && !takenHere.has(cand)) pick = cand
      }
      // Next: new to this kitchen today, even if shared within the block.
      for (let i = 0; i < pool.length && pick === null; i++) {
        const cand = pool[(start + i) % pool.length]
        if (!used.includes(cand)) pick = cand
      }
      // Last resort: repeat whichever it did longest ago.
      if (pick === null) {
        pick = pool.reduce((best, cand) => (used.lastIndexOf(cand) < used.lastIndexOf(best) ? cand : best))
      }

      out[ki] = pick
      takenHere.add(pick)
      usedByKitchen.set(ki, used.concat(pick))
    })
  })
  return byBlock
}

// Center sink: kitchens share sinks in fixed pairs (K1/K2, K3/K4, ...). A
// staffed pair takes turns; a kitchen whose partner is empty, or all out
// today, has the sink every time. Per block, not day-wide: dishes refill
// every period, so washing again the same day isn't redundant.
//
// Returns { kitchenIdx: true } for kitchens on the sink.
export function centerSinks(block) {
  const staffedIdxs = staffedKitchenIdxs(block)
  const staffed = new Set(staffedIdxs)
  const wantOdd = block.centerSink === 0
  const out = {}
  staffedIdxs.forEach(ki => {
    out[ki] = staffed.has(ki ^ 1) ? (((ki + 1) % 2 === 1) === wantOdd) : true
  })
  return out
}

// What a block's board shows right now: { duties: {ki: text}, sinks: {ki: true} }.
// Read-only; the rotation cursors move only in advanceBlock.
export function blockDisplay(state, blockId) {
  const block = state.blocks[blockId]
  if (!block) return { duties: {}, sinks: {} }
  return {
    duties: assignDayDuties(state, block.day, blockId)[blockId] ?? {},
    sinks: centerSinks(block),
  }
}

// Moves a block's cursors on one step — only for a session somebody attended,
// so an all-absent class picks up the same duty when it comes back.
export function advanceCursors(state, blockId, hadStaff) {
  const block = state.blocks[blockId]
  if (!block || !hadStaff) return
  const pool = dutiesForBlock(state, blockId)
  if (pool.length > 0) block.dutyIndex = (block.dutyIndex + 1) % pool.length
  block.centerSink = block.centerSink === 0 ? 1 : 0
}
