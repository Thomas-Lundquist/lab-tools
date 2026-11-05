// The Canvas side of the rotator: who is in a class, what they're called on the
// board, and keeping seats in step with the section. Pure.
import { MAX_KITCHEN, NUM_KITCHENS, TARGET_KITCHEN_SIZE, seatedIds, kitchenOf } from './model.js'

// "Archer, Kelly Noel" -> "Kelly A." (first name + last initial), the way the
// standalone tool has always shown students on the classroom board.
export function shortName(sortable, full) {
  const s = String(sortable ?? '').trim()
  if (s.includes(',')) {
    const [last, rest] = s.split(',')
    const first = (rest ?? '').trim().split(/\s+/)[0] ?? ''
    if (first && last.trim()) return `${first} ${last.trim()[0].toUpperCase()}.`
  }
  return String(full ?? s ?? '').trim()
}

// { userId: display name } for one class. Two "Kelly A."s in the same class
// get more of their last name until they differ ("Kelly Ar." / "Kelly Ad.").
export function displayNames(students) {
  const parts = students.map(st => {
    const s = String(st.sortableName ?? '')
    const [last, rest] = s.includes(',') ? s.split(',') : ['', s]
    return { id: st.id, first: (rest ?? '').trim().split(/\s+/)[0] || String(st.name ?? '').split(/\s+/)[0] || '', last: last.trim(), fallback: shortName(st.sortableName, st.name) }
  })
  const out = {}
  for (const p of parts) {
    if (!p.first || !p.last) { out[p.id] = p.fallback || p.id; continue }
    let n = 1
    const clash = len => parts.some(q => q !== p && q.first === p.first && q.last.slice(0, len).toLowerCase() === p.last.slice(0, len).toLowerCase())
    while (n < p.last.length && clash(n)) n++
    out[p.id] = `${p.first} ${p.last[0].toUpperCase()}${p.last.slice(1, n)}.`
  }
  return out
}

// How many kitchens a class of n splits into: about 4 each, kitchens of 3
// absorbing a remainder before any kitchen of 5, never more than 8.
export function computeGroupCount(n) {
  if (n <= 0) return 0
  let k = Math.round(n / TARGET_KITCHEN_SIZE)
  if (k < 1) k = 1
  const minForCap5 = Math.ceil(n / MAX_KITCHEN)
  const maxForFloor3 = Math.max(1, Math.floor(n / 3))
  if (k < minForCap5) k = minForCap5
  if (k > maxForFloor3) k = maxForFloor3
  return Math.min(NUM_KITCHENS, Math.max(1, k))
}

export function shuffled(arr, random = Math.random) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Deals students round-robin into kitchens so sizes never differ by more than
// one. Replaces the block's seating; returns the ids that didn't fit (only a
// class over 40).
export function seatShuffled(block, userIds, random) {
  const ids = shuffled(userIds, random)
  const groups = computeGroupCount(ids.length)
  block.kitchens = Array.from({ length: NUM_KITCHENS }, () => ({ students: [], original: [] }))
  const left = []
  ids.forEach((id, i) => {
    const k = block.kitchens[i % groups]
    if (k.students.length < MAX_KITCHEN) k.students.push(id)
    else left.push(id)
  })
  block.kitchens.forEach(k => { k.original = k.students.slice() })
  block.dutyIndex = 0
  block.centerSink = 0
  block.absent = {}
  block.absentDate = ''
  return left
}

// Moves a student to the end of a kitchen (the bottom job; the rotation brings
// them round). Returns false if that kitchen is full.
export function placeStudent(block, userId, ki) {
  const from = kitchenOf(block, userId)
  if (from === ki) return true
  if (block.kitchens[ki].students.length >= MAX_KITCHEN) return false
  if (from >= 0) block.kitchens[from].students = block.kitchens[from].students.filter(id => id !== userId)
  block.kitchens[ki].students = [...block.kitchens[ki].students, userId]
  return true
}

// Swaps a student one job up (-1) or down (+1) within their kitchen.
export function nudgeStudent(block, userId, delta) {
  const ki = kitchenOf(block, userId)
  if (ki < 0) return false
  const s = block.kitchens[ki].students.slice()
  const i = s.indexOf(userId), j = i + delta
  if (j < 0 || j >= s.length) return false;
  [s[i], s[j]] = [s[j], s[i]]
  block.kitchens[ki].students = s
  return true
}

export function unseatStudent(block, userId) {
  block.kitchens.forEach(k => { k.students = k.students.filter(id => id !== userId) })
  if (block.absent?.[userId]) { const a = { ...block.absent }; delete a[userId]; block.absent = a }
}

// Keeps the seats in step with the Canvas section: a student no longer in it
// leaves their seat. Returns the ids removed. Refuses (removes nobody) when the
// section came back empty, which is far more likely a Canvas hiccup than a
// class that dropped all at once — wiping a seating on that would be the worse
// mistake. A student enrolled since is not seated automatically; they show as
// unseated (unseatedIds) for the teacher to place.
export function removeDeparted(block, sectionIds) {
  const inSection = new Set(sectionIds)
  if (inSection.size === 0) return []
  const gone = seatedIds(block).filter(id => !inSection.has(id))
  gone.forEach(id => unseatStudent(block, id))
  return gone
}

export function unseatedIds(block, sectionIds) {
  const seated = new Set(seatedIds(block))
  return sectionIds.filter(id => !seated.has(id))
}

// Which A/B block a Canvas section name points at: "1A" -> A1, "6B" -> B2
// (B day runs periods 5-8 in the same four time slots, "1A/5B"), "Period 3 A"
// -> A3, "A2" -> A2. Null when the name says nothing about it.
export function matchSection(name) {
  const s = String(name ?? '').toUpperCase()
  let m = s.match(/(?:^|[^0-9A-Z])([1-8])\s*-?\s*([AB])(?![A-Z0-9])/)
  let num, day
  if (m) { num = Number(m[1]); day = m[2] }
  else {
    m = s.match(/(?:^|[^A-Z])([AB])\s*-?\s*([1-8])(?![0-9])/)
    if (!m) return null
    day = m[1]; num = Number(m[2])
  }
  const pos = num > 4 ? num - 4 : num
  return { day, pos: pos - 1 } // pos is 0-based: the slot index
}
