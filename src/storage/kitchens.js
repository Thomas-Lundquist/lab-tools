// Standing kitchen assignments: which kitchen each student in a period usually
// cooks in, so a new lab starts with everyone already placed instead of every
// student "Unassigned". A lab's own grading state (labGrading.js) still records
// the kitchen each student actually had that day — this is only the starting
// point for labs that haven't been graded yet. Moving a student updates it,
// unless the move is a fix to an older lab (isLatestLab).
//
// One synced key per course, `kitchens/<courseId>`, shaped
//   { [sectionId]: { students: { [studentId]: kitchenNo } } }
// Canvas student ids only, no names — the same posture as labGrading.

import { kvGet, kvSet } from './kv.js'
import { getLabGrading } from './labGrading.js'

const courseKey = courseId => `kitchens/${courseId}`

export async function getStandingKitchens(courseId, sectionId) {
  return (await kvGet(courseKey(courseId)))?.[sectionId] ?? null
}

// Every period's standing kitchens for a course, for the Course Settings editor.
export async function getAllStandingKitchens(courseId) {
  return (await kvGet(courseKey(courseId))) ?? {}
}

async function updatePeriod(courseId, sectionId, update) {
  const all = (await kvGet(courseKey(courseId))) ?? {}
  const prev = all[sectionId] ?? { students: {} }
  const next = update(prev)
  await kvSet(courseKey(courseId), { ...all, [sectionId]: next })
  return next
}

export function saveStandingKitchen(courseId, sectionId, studentId, kitchen) {
  return updatePeriod(courseId, sectionId, prev => ({ ...prev, students: withKitchen(prev.students, studentId, kitchen) }))
}

// A period that has never had standing kitchens is seeded once from its most
// recently graded lab, so arrangements made before this existed carry forward.
// An empty result is saved too, so the scan runs only once per period. Never
// throws: kitchens are a convenience and must not block the roster loading.
export async function seedStandingKitchens(courseId, sectionId, labIds) {
  try {
    const existing = await getStandingKitchens(courseId, sectionId)
    if (existing) return existing
    const states = await Promise.all(labIds.map(id => getLabGrading(id, sectionId).catch(() => null)))
    const seeded = standingFromLatestLab(states) ?? { students: {} }
    await updatePeriod(courseId, sectionId, () => seeded)
    return seeded
  } catch {
    return null
  }
}

// ---- pure (unit-tested) ----

export function withKitchen(students = {}, studentId, kitchen) {
  const next = { ...students }
  if (kitchen == null) delete next[studentId]
  else next[studentId] = kitchen
  return next
}

// The kitchens from whichever lab state was touched last: a live draft by its
// last edit, otherwise the commit by its commit time. (updatedAt outlives a
// discarded draft, so it only counts while the draft exists.)
export function standingFromLatestLab(states) {
  let best = null
  for (const st of states) {
    const sec = st?.draft ?? st?.committed
    const at = st?.draft ? st.updatedAt : st?.committedAt
    if (!sec || !at) continue
    if (!best || at > best.at) best = { at, sec }
  }
  if (!best) return null
  const students = {}
  for (const [id, s] of Object.entries(best.sec.students ?? {})) {
    if (typeof s.kitchen === 'number') students[id] = s.kitchen
  }
  return Object.keys(students).length ? { students } : null
}

// Today as YYYY-MM-DD in the browser's zone: lab dates are typed in local
// time, and UTC is already tomorrow by evening in Utah.
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The labs to offer, newest first (by their latest lab date in any period).
export function newestFirst(entries) {
  const latest = e => Object.values(e.dates ?? {}).filter(Boolean).sort().pop() || labDateFor(e, null)
  return [...entries].sort((a, b) => latest(b).localeCompare(latest(a)) || String(b.id).localeCompare(String(a.id)))
}

// The lab to open on launch: one dated today (for this period if it has a date
// there), else null.
export function todaysLab(entries, sectionId, today = localToday()) {
  const todays = entries.filter(e => Object.values(e.dates ?? {}).includes(today))
  return todays.find(e => sectionId && e.dates?.[sectionId] === today) ?? todays[0] ?? null
}

// A lab's date for one period: its lab date there, else the day it was added.
export function labDateFor(entry, sectionId) {
  const d = entry?.dates?.[sectionId]
  if (d) return d
  const ms = Number(String(entry?.id ?? '').replace(/^lab_/, ''))
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : ''
}

// Whether a kitchen move in this lab should become the period's usual kitchens:
// yes unless a later lab (up to today; labs set up ahead of time don't count)
// exists for the period, i.e. this is a fix to an older lab.
export function isLatestLab(entry, entries, sectionId, today = localToday()) {
  const mine = labDateFor(entry, sectionId)
  return !entries.some(e => {
    if (e.id === entry.id) return false
    const d = labDateFor(e, sectionId)
    return d > mine && d <= today
  })
}
