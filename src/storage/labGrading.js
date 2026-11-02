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
// Stored as one key per lab, `labGrading/<labId>`, because each lab is its own
// synced document in Canvas custom data (storage/sync.js) — a draft autosave
// re-sends one lab, not the whole year. Shape of each:
//   [sectionId] = {
//     committed:   { kitchens, students } | null,
//     committedAt: isoString | null,
//     draft:       { kitchens, students } | null,
//     updatedAt:   isoString | null,   // last draft edit (for the "from <time>" prompt)
//     lastCommit:  { at, record, prevCommitted, prevCommittedAt } | null,
//                  // what the most recent commit changed in Canvas, so it can be
//                  // reverted (pages/labs/commitRun.js). The record holds each
//                  // student's prior score/excused state by Canvas id — it syncs to
//                  // the teacher's own Canvas custom data, like the flags.
//   }
// A section object: { kitchens: { [kitchenNo]: { flagIds, exceeded } },
//                     students: { [studentId]: { kitchen, flagIds, present, excused,
//                                               exceeded, comment, libraryComments } } }

import { kvGet, kvSet, kvRemove } from './kv.js'
import { countKitchenSeverities, individualPenalty, FLAG_BY_ID } from '../config/labFlags.js'
import { kitchenScore, studentScore, ABSENT_SCORE } from '../pages/labs/kitchenScoring.js'

const LEGACY_KEY = 'labGrading'
const labKey = labId => `labGrading/${labId}`

export function emptySection() {
  return { kitchens: {}, students: {} }
}

export function emptyState() {
  return { committed: null, committedAt: null, draft: null, updatedAt: null }
}

// ---- persistence (thin localStorage read-modify-write, one lab at a time) ----

async function readLab(labId) {
  return (await kvGet(labKey(labId))) ?? {}
}

async function putState(labId, sectionId, state) {
  const lab = await readLab(labId)
  await kvSet(labKey(labId), { ...lab, [sectionId]: state })
  return state
}

// Before sync, every lab lived under one 'labGrading' key. Split it into
// per-lab keys once; the writes mark each lab for upload.
export async function migrateLegacyLabGrading() {
  const all = await kvGet(LEGACY_KEY)
  if (!all) return
  for (const [labId, sections] of Object.entries(all)) {
    await kvSet(labKey(labId), { ...sections, ...(await kvGet(labKey(labId))) })
  }
  await kvRemove(LEGACY_KEY)
}

export async function getLabGrading(labId, sectionId) {
  const lab = await readLab(labId)
  return lab[sectionId] ?? emptyState()
}

// Autosave the working edits as a draft. Leaves `committed` untouched.
export async function saveDraft(labId, sectionId, section) {
  const prev = await getLabGrading(labId, sectionId)
  return putState(labId, sectionId, { ...prev, draft: section, updatedAt: new Date().toISOString() })
}

// Record a push: the working section becomes the committed set. Normally the
// draft is cleared so the section reads as saved until the next edit; after a
// partly failed commit (`keepDraft`) the draft stays, so the period still shows
// unsaved work and the resume prompt offers a retry. `record` (from runCommit)
// is kept as lastCommit for Revert, with the previous committed set to go back to.
export async function commitLabGrading(labId, sectionId, section, { record = null, keepDraft = false } = {}) {
  const prev = await getLabGrading(labId, sectionId)
  const now = new Date().toISOString()
  return putState(labId, sectionId, {
    committed: section,
    committedAt: now,
    draft: keepDraft ? section : null,
    updatedAt: now,
    lastCommit: record ? { at: now, record, prevCommitted: prev.committed ?? null, prevCommittedAt: prev.committedAt ?? null } : null,
  })
}

// After Canvas has been put back (runRevert): the committed set goes back to what
// it was before that commit, and the reverted work comes back as a draft so the
// teacher can fix it and commit again. Revert is one step: lastCommit is cleared.
export async function revertLabGrading(labId, sectionId) {
  const prev = await getLabGrading(labId, sectionId)
  const lc = prev.lastCommit
  if (!lc) return prev
  return putState(labId, sectionId, {
    committed: lc.prevCommitted,
    committedAt: lc.prevCommittedAt,
    draft: prev.committed,
    updatedAt: new Date().toISOString(),
    lastCommit: null,
  })
}

// Status of every period of a lab, for the checkmarks in the period picker:
// 'done' — committed and no unsaved edits since; 'draft' — unsaved edits; or absent.
export async function getPeriodStatuses(labId) {
  const lab = await readLab(labId)
  return Object.fromEntries(Object.entries(lab).map(([sectionId, st]) => [sectionId, periodStatus(st)]))
}

export function periodStatus(state) {
  if (state?.draft) return 'draft'
  if (state?.committed) return 'done'
  return null
}

// Drop the draft, keeping the last committed set (what "discard" does).
export async function discardDraft(labId, sectionId) {
  const prev = await getLabGrading(labId, sectionId)
  return putState(labId, sectionId, { ...prev, draft: null })
}

export async function clearLabGrading(labId, sectionId) {
  const lab = await readLab(labId)
  if (!lab[sectionId]) return
  const rest = { ...lab }
  delete rest[sectionId]
  await kvSet(labKey(labId), rest)
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
// to ABSENT_SCORE and never runs through studentScore. `flagsById` is the current
// (teacher-editable) flag index, so a severity change recomputes old labs.
export function deriveStudentScore(section, studentId, maxScore = 4, flagsById = FLAG_BY_ID) {
  const student = section?.students?.[studentId]
  if (!student) return null
  if (student.present === false) return ABSENT_SCORE
  const indivCount = (student.flagIds ?? []).length
  // A student marked "Exceeded" earns a true 4 = 100% regardless of their kitchen's
  // flags, as long as they carry no individual flags of their own (flags win).
  if (student.exceeded && indivCount === 0) return 4
  const kitchen = student.kitchen != null ? section?.kitchens?.[student.kitchen] : null
  const { minor, critical } = countKitchenSeverities(kitchen?.flagIds ?? [], flagsById)
  const tier = studentScore(kitchenScore(minor, critical), individualPenalty(student.flagIds ?? [], flagsById))
  // A clean result (tier 4) posts the top: the kitchen's "Exceeded" toggle upgrades
  // it to a true 4 (100%), otherwise it posts the configured max (default 4, e.g.
  // 3.6 for a softer A). Any flag that pulls the tier below 4 overrides the toggle
  // and posts that lower tier as-is. Absent (0) is handled above. See DECISIONS.md.
  if (tier === 4) return kitchen?.exceeded ? 4 : maxScore
  return tier
}

// Every student's live score, keyed by studentId. maxScore and the flag index
// flow through to deriveStudentScore.
export function deriveSectionScores(section, maxScore = 4, flagsById = FLAG_BY_ID) {
  const out = {}
  for (const studentId of Object.keys(section?.students ?? {})) {
    out[studentId] = deriveStudentScore(section, studentId, maxScore, flagsById)
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

// Toggle one reusable library comment on a student. Stored as a list of the
// comment bodies themselves (not ids), so a later edit to the course's library
// does not strip a comment already attached to graded work. buildComment folds
// these into the posted submission comment.
export function toggleStudentLibraryComment(section, studentId, comment) {
  const prev = section.students?.[studentId] ?? { kitchen: null, flagIds: [], present: true }
  return withStudent(section, studentId, { libraryComments: toggleId(prev.libraryComments, comment) })
}
