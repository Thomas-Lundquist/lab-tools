// Per-lab, per-section flag state for the kitchen grading screen. This is the
// ONLY place grading state is persisted locally, and it stores FLAGS, not
// scores — so a later threshold change in kitchenScoring.js recomputes old labs
// instead of leaving stale numbers behind. It keeps only Canvas student IDs, no
// names, matching the repo's "no student data cached" posture (see CLAUDE.md).
//
// Shape (localStorage key 'labGrading'):
//   labGrading[labId][sectionId] = {
//     kitchens: { [kitchenNo]: { flagIds: [kitchenFlagId...], exceeded: bool } },
//     students: { [studentId]: { kitchen: kitchenNo|null, flagIds: [individualFlagId...], present: bool } },
//     updatedAt:   isoString | null,  // last local edit (autosave)
//     committedAt: isoString | null,  // last successful push to Canvas
//   }
//
// "Unsaved draft" means updatedAt is newer than committedAt — that is what
// triggers the "there is saved work — resume or discard?" prompt on reopen.

import { kvGet, kvSet } from './kv.js'
import { countKitchenSeverities } from '../config/labFlags.js'
import { kitchenScore, studentScore, ABSENT_SCORE } from '../pages/labs/kitchenScoring.js'

const STORAGE_KEY = 'labGrading'

export function emptySection() {
  return { kitchens: {}, students: {}, updatedAt: null, committedAt: null }
}

// ---- persistence (thin localStorage read-modify-write) ----

async function readAll() {
  return (await kvGet(STORAGE_KEY)) ?? {}
}

async function putSection(labId, sectionId, section) {
  const all = await readAll()
  all[labId] = { ...(all[labId] ?? {}), [sectionId]: section }
  await kvSet(STORAGE_KEY, all)
  return section
}

export async function getLabGrading(labId, sectionId) {
  const all = await readAll()
  return all?.[labId]?.[sectionId] ?? emptySection()
}

// Autosave the working state. Stamps updatedAt (not committedAt), so the section
// now reads as an unsaved draft until the next commit.
export async function saveDraft(labId, sectionId, { kitchens, students }) {
  const prev = await getLabGrading(labId, sectionId)
  const section = { ...prev, kitchens, students, updatedAt: new Date().toISOString() }
  return putSection(labId, sectionId, section)
}

// Record a successful push. Stamps committedAt (and updatedAt to match), so the
// section reads as saved — no resume prompt — until the teacher edits again.
export async function commitLabGrading(labId, sectionId, { kitchens, students }) {
  const now = new Date().toISOString()
  const section = { kitchens, students, updatedAt: now, committedAt: now }
  return putSection(labId, sectionId, section)
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

// True when there is local work newer than the last push. ISO timestamps sort
// lexicographically in time order, so this is a plain string compare.
export function isUnsavedDraft(section) {
  if (!section?.updatedAt) return false
  if (!section.committedAt) return true
  return section.updatedAt > section.committedAt
}

// One student's live score, derived from the stored flags. Absent short-circuits
// to ABSENT_SCORE and never runs through studentScore.
export function deriveStudentScore(section, studentId) {
  const student = section?.students?.[studentId]
  if (!student) return null
  if (student.present === false) return ABSENT_SCORE
  const kitchen = student.kitchen != null ? section?.kitchens?.[student.kitchen] : null
  const { minor, critical } = countKitchenSeverities(kitchen?.flagIds ?? [])
  const ks = kitchenScore(minor, critical, kitchen?.exceeded ?? false)
  return studentScore(ks, (student.flagIds ?? []).length)
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
