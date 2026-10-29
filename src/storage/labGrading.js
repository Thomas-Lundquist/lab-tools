// Per-lab, per-section flag state for the kitchen grading screen. This is the
// ONLY place grading state is persisted locally, and it stores FLAGS, not
// scores — so a later threshold change in kitchenScoring.js recomputes old labs
// instead of leaving stale numbers behind. It keeps only Canvas student IDs, no
// names, matching the repo's "no student data cached" posture (see CLAUDE.md).
//
// Two slots per lab/section so the reopen flow is unambiguous:
//   - `committed`: the flag set as of the last successful push to Canvas. This is
//     what a threshold change recomputes against, and what "discard" reverts to.
//   - `draft`:     unsaved working edits. Its presence IS "there is saved work";
//     that triggers the resume/discard prompt on reopen.
//
// Shape (localStorage key 'labGrading'):
//   labGrading[labId][sectionId] = {
//     committed:   { kitchens, students } | null,
//     committedAt: isoString | null,
//     draft:       { kitchens, students } | null,
//     updatedAt:   isoString | null,   // last draft edit (for the "from <time>" prompt)
//   }
// A section object: { kitchens: { [kitchenNo]: { flagIds, exceeded } },
//                     students: { [studentId]: { kitchen, flagIds, present } } }

import { kvGet, kvSet } from './kv.js'
import { countKitchenSeverities } from '../config/labFlags.js'
import { kitchenScore, studentScore, ABSENT_SCORE } from '../pages/labs/kitchenScoring.js'

const STORAGE_KEY = 'labGrading'

export function emptySection() {
  return { kitchens: {}, students: {} }
}

export function emptyState() {
  return { committed: null, committedAt: null, draft: null, updatedAt: null }
}

// ---- persistence (thin localStorage read-modify-write) ----

async function readAll() {
  return (await kvGet(STORAGE_KEY)) ?? {}
}

async function putState(labId, sectionId, state) {
  const all = await readAll()
  all[labId] = { ...(all[labId] ?? {}), [sectionId]: state }
  await kvSet(STORAGE_KEY, all)
  return state
}

export async function getLabGrading(labId, sectionId) {
  const all = await readAll()
  return all?.[labId]?.[sectionId] ?? emptyState()
}

// Autosave the working edits as a draft. Leaves `committed` untouched.
export async function saveDraft(labId, sectionId, section) {
  const prev = await getLabGrading(labId, sectionId)
  return putState(labId, sectionId, { ...prev, draft: section, updatedAt: new Date().toISOString() })
}

// Record a successful push: the working section becomes the committed set and the
// draft is cleared, so the section reads as saved until the next edit.
export async function commitLabGrading(labId, sectionId, section) {
  const now = new Date().toISOString()
  return putState(labId, sectionId, { committed: section, committedAt: now, draft: null, updatedAt: now })
}

// Drop the draft, keeping the last committed set (what "discard" does).
export async function discardDraft(labId, sectionId) {
  const prev = await getLabGrading(labId, sectionId)
  return putState(labId, sectionId, { ...prev, draft: null })
}

export async function clearLabGrading(labId, sectionId) {
  const all = await readAll()
  if (!all?.[labId]?.[sectionId]) return
  const forLab = { ...all[labId] }
  delete forLab[sectionId]
  all[labId] = forLab
  await kvSet(STORAGE_KEY, all)
}

export async function hasUnsavedDraft(labId, sectionId) {
  return isUnsavedDraft(await getLabGrading(labId, sectionId))
}

// ---- pure logic (no storage; unit-tested) ----

// An unsaved draft exists whenever a draft slot is populated.
export function isUnsavedDraft(state) {
  return !!state?.draft
}

// The section the screen should show by default: the draft if one exists, else
// the last committed set, else an empty section.
export function activeSection(state) {
  return state?.draft ?? state?.committed ?? emptySection()
}

// One student's live score, derived from the stored flags. Absent short-circuits
// to ABSENT_SCORE and never runs through studentScore.
export function deriveStudentScore(section, studentId) {
  const student = section?.students?.[studentId]
  if (!student) return null
  if (student.present === false) return ABSENT_SCORE
  const indivCount = (student.flagIds ?? []).length
  // An individual "exceeded" marks a standout even when the kitchen is not a 4 —
  // but only if that student has no individual flags (flags win over exceeded,
  // same as the kitchen rule).
  if (student.exceeded && indivCount === 0) return 4
  const kitchen = student.kitchen != null ? section?.kitchens?.[student.kitchen] : null
  const { minor, critical } = countKitchenSeverities(kitchen?.flagIds ?? [])
  const ks = kitchenScore(minor, critical, kitchen?.exceeded ?? false)
  return studentScore(ks, indivCount)
}

// Every student's live score, keyed by studentId.
export function deriveSectionScores(section) {
  const out = {}
  for (const studentId of Object.keys(section?.students ?? {})) {
    out[studentId] = deriveStudentScore(section, studentId)
  }
  return out
}

// ---- pure transforms the grading screen applies to its working section ----
// Each returns a NEW section; none touch storage (the screen autosaves via
// saveDraft on a debounce).

function toggleId(list = [], id) {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}

function withKitchen(section, kitchenNo, patch) {
  const prev = section.kitchens?.[kitchenNo] ?? { flagIds: [], exceeded: false }
  return { ...section, kitchens: { ...section.kitchens, [kitchenNo]: { ...prev, ...patch } } }
}

function withStudent(section, studentId, patch) {
  const prev = section.students?.[studentId] ?? { kitchen: null, flagIds: [], present: true }
  return { ...section, students: { ...section.students, [studentId]: { ...prev, ...patch } } }
}

export function toggleKitchenFlag(section, kitchenNo, flagId) {
  const prev = section.kitchens?.[kitchenNo] ?? { flagIds: [], exceeded: false }
  return withKitchen(section, kitchenNo, { flagIds: toggleId(prev.flagIds, flagId) })
}

export function setKitchenExceeded(section, kitchenNo, exceeded) {
  return withKitchen(section, kitchenNo, { exceeded })
}

export function toggleStudentFlag(section, studentId, flagId) {
  const prev = section.students?.[studentId] ?? { kitchen: null, flagIds: [], present: true }
  return withStudent(section, studentId, { flagIds: toggleId(prev.flagIds, flagId) })
}

export function setStudentKitchen(section, studentId, kitchenNo) {
  return withStudent(section, studentId, { kitchen: kitchenNo })
}

export function setPresent(section, studentId, present) {
  return withStudent(section, studentId, { present })
}

export function setStudentComment(section, studentId, comment) {
  return withStudent(section, studentId, { comment })
}

export function setStudentExceeded(section, studentId, exceeded) {
  return withStudent(section, studentId, { exceeded })
}
