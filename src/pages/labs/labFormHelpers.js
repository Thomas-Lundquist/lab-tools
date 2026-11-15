// Pure helpers shared by ProfessionalismPanel's create form, EditLabModal, and
// scopeDiff.js. Deliberately plain .js (no JSX) so this stays directly
// testable with `node --test`, unlike LabFormFields.jsx's components.

// JournalSelect sentinel for "no journal — standalone". The primary create
// form requires an explicit pick (placeholder is disabled), so a real lab
// can't end up Standalone just because the teacher forgot to choose its
// Journal.
export const STANDALONE = 'standalone'

// Scope options shared by the create form and EditLabModal. 'all' is the
// historical behavior — the assignment is visible to the whole course. 'A' /
// 'B' restrict it to the sections tagged with that day type in Course Settings.
export const SCOPE_OPTIONS = [
  { value: 'all', label: 'All periods' },
  { value: 'A', label: 'A-day periods only' },
  { value: 'B', label: 'B-day periods only' },
]

// Which sections a given scope targets. 'all' is every section; an 'A'/'B'
// scope keeps only sections tagged with that day type. Sections with no day
// type set are intentionally excluded from a scoped create — the teacher adds
// them afterward with "Add a section" once they know that section's date.
export function sectionsInScope(sections, courseSetup, scope) {
  if (scope === 'all') return sections
  return sections.filter(sec => courseSetup?.sections?.[sec.id]?.dayType === scope)
}

// The scope a tracked assignment is already in, inferred from Canvas's own
// state: visible to everyone reads as 'all'; override-gated reads as the one
// day type every section override shares, or 'custom' when that set is mixed,
// empty, or student-targeted rather than section-targeted — EditLabModal
// starts there and asks the teacher to pick one of the three to normalize it.
export function inferScope(assignment, courseSetup) {
  if (!assignment) return null
  if (!assignment.onlyVisibleToOverrides) return 'all'
  const sectionOverrides = (assignment.overrides ?? []).filter(o => o.courseSectionId)
  if (sectionOverrides.length === 0) return 'custom'
  const dayTypes = new Set(sectionOverrides.map(o => courseSetup?.sections?.[o.courseSectionId]?.dayType))
  if (dayTypes.size === 1) {
    const only = [...dayTypes][0]
    if (only === 'A') return 'A'
    if (only === 'B') return 'B'
  }
  return 'custom'
}

// What a tracked assignment is actually assigned to, in words, for the list
// badge and EditLabModal. inferScope answers "which of the three picker
// choices is this?" and falls back to 'custom'; this describes what's there
// instead, so a lab run on both A and B days doesn't read as something wrong.
//   { label, kind: 'all' | 'A' | 'B' | 'periods' | 'students' | 'none',
//     noDayType: [names of covered periods with no A/B day in Course Settings] }
// `sections` is the course's sections in display order ({ id, name }).
export function describeScope(assignment, courseSetup, sections = []) {
  if (!assignment) return null
  const none = []
  if (!assignment.onlyVisibleToOverrides) return { label: 'All periods', kind: 'all', noDayType: none }
  const overrides = assignment.overrides ?? []
  const ids = new Set(overrides.map(o => o.courseSectionId).filter(Boolean))
  if (ids.size === 0) {
    return overrides.some(o => o.studentIds?.length)
      ? { label: 'Individual students', kind: 'students', noDayType: none }
      : { label: 'No periods', kind: 'none', noDayType: none }
  }
  const known = sections.filter(s => ids.has(s.id))
  const covered = [...known, ...[...ids].filter(id => !sections.some(s => s.id === id)).map(id => ({ id, name: id }))]
  const dayOf = s => courseSetup?.sections?.[s.id]?.dayType
  const noDayType = covered.filter(s => dayOf(s) !== 'A' && dayOf(s) !== 'B').map(s => s.name)
  if (sections.length > 0 && sections.every(s => ids.has(s.id))) return { label: 'All periods', kind: 'all', noDayType }
  const days = new Set(covered.map(dayOf))
  if (days.size === 1 && days.has('A')) return { label: 'A day', kind: 'A', noDayType }
  if (days.size === 1 && days.has('B')) return { label: 'B day', kind: 'B', noDayType }
  return { label: covered.map(s => s.name).join(', '), kind: 'periods', noDayType }
}

// ISO for the end (23:59) and start (00:00) of a YYYY-MM-DD date string, in the
// browser's local zone, matching how the form writes section override dates.
function endOfDayIso(dateStr) {
  return new Date(`${dateStr}T23:59:00`).toISOString()
}
function startOfDayIso(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toISOString()
}

// A YYYY-MM-DD string shifted by a whole number of days. These offsets are fixed
// arithmetic on a date the teacher typed (the lab date) — not a guess about the
// A/B calendar — so +1 and +14 are safe to derive automatically.
function addDays(dateStr, days) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// The lab date drives every override date. A Professionalism assignment takes no
// submission, so it opens and closes on the lab day itself. Its paired Journal
// opens the lab day, is due some days later, and closes some days after that —
// both offsets come from Course Settings (defaults: due +1 day, close +14 days
// after due).
export function professionalismOverrideDates(labDate) {
  return { unlockAt: startOfDayIso(labDate), dueAt: endOfDayIso(labDate), lockAt: endOfDayIso(labDate) }
}
export function journalOverrideDates(labDate, dueOffsetDays, closeOffsetDays) {
  const dueDate = addDays(labDate, dueOffsetDays)
  return {
    unlockAt: startOfDayIso(labDate),
    dueAt: endOfDayIso(dueDate),
    lockAt: endOfDayIso(addDays(dueDate, closeOffsetDays)),
  }
}
