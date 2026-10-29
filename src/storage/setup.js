// Saved setup for the Labs tool (PLAN.md Section 4). Setup data only — course
// config, labs, terms, and settings. No student information is ever stored
// here; attendance state is re-derived live from Canvas instead (see
// AttendancePanel.jsx), so there is nothing student-identifying to keep in
// sync or clean up.
//
// There used to be a `units` store here (a lab's own id -> {name, order}
// grouping, picked in an old UnitPicker in what's now ProfessionalismPanel).
// It's gone: a lab's "unit" is now whichever Canvas Module it's assigned to,
// read live via
// api/modules.js, since the course's Modules already are the teacher's units
// and don't need a second, disconnected copy of the same grouping.

import { kvGet, kvSet } from './kv.js'

const STORAGE_KEY = 'setup'

export const DEFAULT_SETTINGS = {
  syncLabsToFocus: false,       // per-lab professionalism assignments -> Focus (SIS)
  syncUnitTermToFocus: true,    // unit/term score assignments -> Focus (SIS)
  deductionReasons: ['Dishes left in sink', 'Station not wiped', 'Equipment put away wet', 'Off task'],
  commentLibrary: [],           // reusable feedback comments, pickable per student in the Lab tab
  maxScore: 4,                  // value a top (perfect) lab posts; caps only the top tier, lower tiers unchanged
  sendDeductionReasonsAsComment: false,
  zeroJournalWhenAbsent: true,
  journalDueOffsetDays: 1,      // Journal due date = lab date + this many days
  labCloseDateOffsetDays: 14,   // Journal close date = Journal due date + this many days
  deductionPointsPerStep: 1,    // ScoringPanel's deduction formula: score = max(0, 4 - ceil(markCount / marksPerStep) * pointsPerStep)
  deductionMarksPerStep: 2,
}

const DEFAULT_COURSE = {
  enabled: false,
  professionalismGroupId: null,
  sections: {},                 // sectionId -> { dayType: 'A' | 'B' }
  settings: DEFAULT_SETTINGS,
}

const DEFAULTS = {
  courses: {},  // courseId -> course config (see DEFAULT_COURSE)
  labs: {},     // labId   -> { id, courseId, moduleId, name, professionalismAssignmentId, journalAssignmentId, dates: { sectionId: isoDate }, closeDates: { sectionId: isoDate } }
  terms: {},    // termId  -> { id, courseId, name, moduleIds: [] }
}

export async function getSetup() {
  const stored = await kvGet(STORAGE_KEY)
  return { ...DEFAULTS, ...(stored ?? {}) }
}

async function saveSetup(setup) {
  await kvSet(STORAGE_KEY, setup)
  return setup
}

export async function getCourseSetup(courseId) {
  const setup = await getSetup()
  const course = setup.courses[courseId]
  if (!course) return { ...DEFAULT_COURSE, sections: {}, settings: { ...DEFAULT_SETTINGS } }
  return {
    ...DEFAULT_COURSE,
    ...course,
    sections: { ...course.sections },
    settings: { ...DEFAULT_SETTINGS, ...course.settings },
  }
}

export async function saveCourseSetup(courseId, patch) {
  const setup = await getSetup()
  const current = setup.courses[courseId] ?? DEFAULT_COURSE
  const updated = { ...current, ...patch }
  setup.courses = { ...setup.courses, [courseId]: updated }
  await saveSetup(setup)
  return updated
}

export async function saveSectionDayType(courseId, sectionId, dayType) {
  const course = await getCourseSetup(courseId)
  const sections = { ...course.sections, [sectionId]: { dayType } }
  return saveCourseSetup(courseId, { sections })
}

export async function saveCourseSettings(courseId, patch) {
  const course = await getCourseSetup(courseId)
  const settings = { ...course.settings, ...patch }
  return saveCourseSetup(courseId, { settings })
}

// Resets a course back to DEFAULT_COURSE (Enabled, Professionalism group,
// sections, settings) and drops its Terms. Deliberately does not touch
// `labs` (pairings) — CourseSettingsModal's "Clear setup" calls
// deleteLabsForCourse separately, as its own opt-in choice, since dropping a
// pairing's Canvas Professionalism assignment is an irreversible Canvas
// write this module has no business deciding on its own.
export async function resetCourseSetup(courseId) {
  const setup = await getSetup()
  const courses = { ...setup.courses }
  delete courses[courseId]
  const terms = Object.fromEntries(Object.entries(setup.terms).filter(([, t]) => t.courseId !== courseId))
  setup.courses = courses
  setup.terms = terms
  await saveSetup(setup)
}

// ---- Labs ----
// A "lab" record is any Professionalism assignment this tool tracks. Two kinds,
// derived rather than stored (so no migration): a Pairing has a Journal
// attached, a Standalone (a scored day with no lab activity) doesn't.

export const isStandalone = lab => !lab.journalAssignmentId

export async function getLabs(courseId) {
  const setup = await getSetup()
  return Object.values(setup.labs).filter(l => l.courseId === courseId)
}

export async function saveLab(lab) {
  const setup = await getSetup()
  const id = lab.id ?? `lab_${Date.now()}`
  const updated = { ...setup.labs[id], ...lab, id }
  setup.labs = { ...setup.labs, [id]: updated }
  await saveSetup(setup)
  return updated
}

export async function deleteLab(labId) {
  const setup = await getSetup()
  const labs = { ...setup.labs }
  delete labs[labId]
  setup.labs = labs
  await saveSetup(setup)
}

// Local record only — the caller (CourseSettingsModal) is responsible for
// deleting each pairing's Canvas Professionalism assignment first, if the
// teacher chose not to preserve pairings.
export async function deleteLabsForCourse(courseId) {
  const setup = await getSetup()
  const labs = Object.fromEntries(Object.entries(setup.labs).filter(([, l]) => l.courseId !== courseId))
  setup.labs = labs
  await saveSetup(setup)
}

// ---- Terms ----

export async function getTerms(courseId) {
  const setup = await getSetup()
  return Object.values(setup.terms).filter(t => t.courseId === courseId)
}

export async function saveTerm(term) {
  const setup = await getSetup()
  const id = term.id ?? `term_${Date.now()}`
  const updated = { ...setup.terms[id], ...term, id }
  setup.terms = { ...setup.terms, [id]: updated }
  await saveSetup(setup)
  return updated
}

export async function deleteTerm(termId) {
  const setup = await getSetup()
  const terms = { ...setup.terms }
  delete terms[termId]
  setup.terms = terms
  await saveSetup(setup)
}
