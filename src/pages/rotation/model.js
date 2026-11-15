// Kitchen Rotation: state shape and repair. Ported from ../kitchen-rotator
// (js/state.js, js/seats.js). Pure — no storage, no Canvas — so it's tested on
// its own. Everything here works on a plain object; callers clone before
// mutating (see storage/rotation.js's updateRotation).
//
// What changed from the standalone: seats hold Canvas student ids, never
// names. Names are read live from the Canvas roster and shown as "Kelly A."
// (roster.js). Because an id is unique, attendance is keyed by student
// (`block.absent[userId]`) instead of by [kitchen][seat], so nothing has to
// carry marks across a re-seat by name any more.
//
// Kept on purpose from the standalone:
// - `kitchens[ki].students` in stored order IS the rotation cycle. Absence
//   never reorders it; seatOrder() works out present-first seating at render.
// - SPLIT is derived, never stored: a job row with no student under it.
// - A block id (A1, B3, ...) is a permanent identity; the label the teacher
//   sees is the period it sits in now (blockLabel).
//
// Linked to the Labs tool, one way (DECISIONS.md, 2026-11-14): a class whose
// period has home kitchens in Course Settings is seated from them
// (roster.js's reconcileSeating), and on a day its period has a lab, absences
// and visits come from that lab (dayView below). The rotator never writes Labs
// data; it keeps its own seat order, duties and history.

export const MAX_KITCHEN = 5         // seat rows per kitchen, never exceeded
export const TARGET_KITCHEN_SIZE = 4 // ideal students per kitchen when shuffling
export const NUM_KITCHENS = 8
export const DAYS = ['A', 'B']

export const DEFAULT_JOB_TITLES = ['Manager', 'Head Chef', 'Sous Chef', 'Kitchen Porter', 'Dishwasher']

const emptyKitchen = () => ({ students: [], original: [] })

export function blankBlock(day, { courseId = null, sectionId = null, course = 1, className } = {}) {
  return {
    day,
    course,                                   // 1 or 2: visual accent only
    className: className ?? (course === 2 ? 'Culinary 2' : 'Culinary 1'),
    courseId, sectionId,                      // the Canvas section this class is
    kitchens: Array.from({ length: NUM_KITCHENS }, emptyKitchen),
    dutyIndex: 0,
    centerSink: 0,
    absent: {},                               // userId -> true, for absentDate only
    absentDate: '',
  }
}

export function freshState() {
  return {
    blocks: {},
    duties: [],                               // [{ text, apply: { blockId: bool } }]
    jobTitles: [...DEFAULT_JOB_TITLES],
    slots: { A: [null, null, null, null], B: [null, null, null, null] },
    nextNum: { A: 1, B: 1 },                  // never reused, even after a removal
  }
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const padTo4 = arr => { const out = (Array.isArray(arr) ? arr : []).slice(0, 4); while (out.length < 4) out.push(null); return out }
const ids = arr => (Array.isArray(arr) ? arr : []).filter(isRealStudent).map(String)

// Anything read from storage (or pulled from another device) goes through
// here. Never assume a field exists: a synced copy written by an older build,
// or a merge of two devices' edits, can be missing pieces.
export function normalizeState(parsed, today) {
  const base = freshState()
  if (!isObj(parsed)) return base
  const out = {
    ...base,
    duties: Array.isArray(parsed.duties)
      ? parsed.duties.filter(isObj).map(d => ({ text: String(d.text ?? ''), apply: isObj(d.apply) ? { ...d.apply } : {} }))
      : [],
    jobTitles: Array.isArray(parsed.jobTitles) && parsed.jobTitles.length === MAX_KITCHEN
      ? parsed.jobTitles.map((t, i) => String(t || `Seat ${i + 1}`))
      : [...DEFAULT_JOB_TITLES],
    slots: { A: padTo4(parsed.slots?.A), B: padTo4(parsed.slots?.B) },
    nextNum: { A: Number(parsed.nextNum?.A) || 1, B: Number(parsed.nextNum?.B) || 1 },
    blocks: {},
  }
  const seen = new Set()
  for (const day of DAYS) {
    out.slots[day] = out.slots[day].map(id => {
      // A slot pointing at a missing block, or a block listed twice, would
      // render a card with nothing behind it. Drop it to a prep period.
      if (!id || seen.has(id) || !isObj(parsed.blocks?.[id])) return null
      seen.add(id)
      out.blocks[id] = repairBlock(parsed.blocks[id], day)
      if (today) expireAbsences(out.blocks[id], today)
      return id
    })
    // nextNum must stay past every id in use, or a new class could reuse one
    // and inherit its history.
    for (const id of out.slots[day]) {
      const n = Number(String(id ?? '').slice(1))
      if (n >= out.nextNum[day]) out.nextNum[day] = n + 1
    }
  }
  return out
}

function repairBlock(raw, day) {
  const b = { ...blankBlock(day), ...raw, day }
  b.course = b.course === 2 ? 2 : 1
  b.className = String(b.className || (b.course === 2 ? 'Culinary 2' : 'Culinary 1'))
  b.courseId = b.courseId == null ? null : String(b.courseId)
  b.sectionId = b.sectionId == null ? null : String(b.sectionId)
  b.dutyIndex = Number.isInteger(b.dutyIndex) && b.dutyIndex >= 0 ? b.dutyIndex : 0
  b.centerSink = b.centerSink === 1 ? 1 : 0
  b.absent = isObj(b.absent) ? b.absent : {}
  b.absentDate = typeof b.absentDate === 'string' ? b.absentDate : ''
  const kitchens = Array.isArray(b.kitchens) ? b.kitchens : []
  // A student may sit in one seat only. A merge of two devices that each moved
  // the same student could leave them in two kitchens; the first one wins.
  const placed = new Set()
  b.kitchens = Array.from({ length: NUM_KITCHENS }, (_, ki) => {
    const k = isObj(kitchens[ki]) ? kitchens[ki] : {}
    const students = ids(k.students).filter(id => !placed.has(id) && placed.add(id)).slice(0, MAX_KITCHEN)
    return { students, original: ids(k.original).slice(0, MAX_KITCHEN) }
  })
  return b
}

export function allBlockIds(state) {
  return [...state.slots.A, ...state.slots.B].filter(Boolean)
}

// "A2": the block's day and the period it sits in now, not its id.
export function blockLabel(state, blockId) {
  const day = state.blocks[blockId]?.day
  if (!day) return blockId
  return day + (state.slots[day].indexOf(blockId) + 1)
}

// --- seats ---

export function isRealStudent(v) {
  return typeof v === 'string' ? v.trim() !== '' : typeof v === 'number'
}

export function isAbsent(block, userId) {
  return !!block.absent?.[userId]
}

// "Active": the kitchen has students, so its column renders. Rotation uses it.
export function activeKitchenIdxs(block) {
  return block.kitchens.flatMap((k, i) => (k.students.length ? [i] : []))
}

// --- today: who is actually working in each kitchen ---
//
// The stored seating is each kitchen's home crew in rotation order. Today can
// differ from it two ways, and dayView works both out without touching the
// stored order:
//   - absent students leave the job rows (their jobs read SPLIT);
//   - a student moved to another kitchen for today's lab works there, after
//     its home crew, and is flagged as visiting.
//
// `att` is today's attendance from the Labs tool (pages/rotation/today.js):
//   { absent: Set<userId>, kitchen: { userId: kitchenIdx }, labName }
// With no lab today `att` is null and the rotator's own marks
// (block.absent) count instead. DECISIONS.md, 2026-11-14.
//
// Returns { kitchens: [{ working: [userId], visitors: Set }], absent: Set,
//           source: 'lab' | 'rotator', labName }.
export function dayView(block, att = null) {
  const absent = att ? att.absent : new Set(Object.keys(block.absent ?? {}).filter(id => block.absent[id]))
  const moved = att?.kitchen ?? {}
  const kitchens = block.kitchens.map(() => ({ working: [], visitors: new Set() }))
  const home = {}
  block.kitchens.forEach((k, ki) => k.students.forEach(uid => {
    home[uid] = ki
    if (absent.has(uid)) return
    const to = moved[uid]
    if (to != null && to !== ki && kitchens[to]) return // working elsewhere today
    kitchens[ki].working.push(uid)
  }))
  for (const [uid, to] of Object.entries(moved)) {
    if (absent.has(uid) || !kitchens[to] || home[uid] === to) continue
    kitchens[to].working.push(uid)
    // Someone with no home seat isn't visiting anywhere; they just work there.
    if (home[uid] != null) kitchens[to].visitors.add(uid)
  }
  return { kitchens, absent, source: att ? 'lab' : 'rotator', labName: att?.labName ?? null }
}

// "Staffed": somebody is actually working here today. A kitchen whose whole
// crew is out can't wipe a shelf or wash a sink, so duties and the center sink
// use it. A kitchen staffed only by visitors counts.
export function staffedKitchenIdxs(block, view = dayView(block)) {
  return view.kitchens.flatMap((k, i) => (k.working.length ? [i] : []))
}

// Over the 5-seat limit today: only reachable when an absent student comes
// back after others were moved in, so it's flagged rather than prevented.
export function overLimitIdxs(view) {
  return view.kitchens.flatMap((k, i) => (k.working.length > MAX_KITCHEN ? [i] : []))
}

// One kitchen's students in display order: present first (they take the top
// job titles), then absent. Row r beyond the list reads SPLIT.
export function seatOrder(block, ki) {
  const s = block.kitchens[ki].students
  return [...s.filter(id => !isAbsent(block, id)), ...s.filter(id => isAbsent(block, id))]
}

export function seatedIds(block) {
  return block.kitchens.flatMap(k => k.students)
}

export function kitchenOf(block, userId) {
  return block.kitchens.findIndex(k => k.students.includes(userId))
}

// --- attendance: one class day, cleared by a rotation or overnight ---

export function setAbsent(block, userId, on, today) {
  const absent = { ...block.absent }
  if (on) absent[userId] = true
  else delete absent[userId]
  block.absent = absent
  block.absentDate = today
}

export function clearAbsences(block) {
  block.absent = {}
  block.absentDate = ''
}

export function expireAbsences(block, today) {
  if (block.absentDate && block.absentDate !== today) clearAbsences(block)
}

// --- local calendar date (never toISOString(), which is UTC) ---

export function dateStamp(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const todayStamp = () => dateStamp(new Date())
