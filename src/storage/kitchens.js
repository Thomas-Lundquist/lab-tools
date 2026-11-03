// Standing kitchen assignments: which kitchen each student in a period usually
// cooks in, so a new lab starts with everyone already placed instead of every
// student "Unassigned". A lab's own grading state (labGrading.js) still records
// the kitchen each student actually had that day — this is only the starting
// point for labs that haven't been graded yet. Moving a student in any lab
// updates it (the latest arrangement wins).
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

async function updatePeriod(courseId, sectionId, update) {
  const all = (await kvGet(courseKey(courseId))) ?? {}
  const prev = all[sectionId] ?? { students: {} }
  await kvSet(courseKey(courseId), { ...all, [sectionId]: update(prev) })
}

export function saveStandingKitchen(courseId, sectionId, studentId, kitchen) {
  return updatePeriod(courseId, sectionId, prev => ({ ...prev, students: withKitchen(prev.students, studentId, kitchen) }))
}

// A period that has never had standing kitchens is seeded once from its most
// recently graded lab, so arrangements made before this existed carry forward.
export async function seedStandingKitchens(courseId, sectionId, labIds) {
  const existing = await getStandingKitchens(courseId, sectionId)
  if (existing) return existing
  const states = await Promise.all(labIds.map(id => getLabGrading(id, sectionId)))
  const seeded = standingFromLatestLab(states)
  if (!seeded) return null
  await updatePeriod(courseId, sectionId, () => seeded)
  return seeded
}

// ---- pure (unit-tested) ----

export function withKitchen(students = {}, studentId, kitchen) {
  const next = { ...students }
  if (kitchen == null) delete next[studentId]
  else next[studentId] = kitchen
  return next
}

// The kitchens from whichever lab state was touched last (draft or commit).
export function standingFromLatestLab(states) {
  let best = null
  for (const st of states) {
    const sec = st?.draft ?? st?.committed
    const at = st?.updatedAt ?? st?.committedAt
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
