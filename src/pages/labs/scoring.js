// Unit and Term professionalism scoring. Originally ported from the standalone
// "professionalism-by-unit.html" tool; the rules changed on 2026-11-02 (see
// DECISIONS.md) once at-home makeups made an absence zero a placeholder rather
// than a final grade, and again on 2026-11-12 to fix how a Term combines its
// Units.
//
// Rules:
//   - A Unit's score is the plain average of its labs' 4-point scores
//     ((score / pointsPossible) * 4), rounded to 2 decimals. Nothing is
//     dropped, and there is no automatic zero: an absence already scores 0,
//     and a makeup replaces it.
//   - A Term's score is the plain average of its Units' own scores (not a
//     pooled average of every lab in those Units) — so each Unit counts the
//     same in a Term regardless of how many labs it has. A Unit's labs run
//     3-8 deep depending on the course; averaging labs directly let whichever
//     Unit had the most labs dominate the Term, and made a thin Unit far more
//     volatile than a deep one. See DECISIONS.md, 2026-11-12.
//   - Ungraded/unsubmitted labs are "blank": not counted, but noted. A Unit
//     with no score yet is likewise left out of its Term, and noted.
//   - Excused labs are not counted, and noted.
//
// scoreStudent/scoreGroup are generic over "a list of labs with an
// id/name/pointsPossible and a submission lookup". scoreTermStudent/
// scoreTermGroup are generic over "a list of Units with a name/labs", built on
// top of scoreStudent. Nothing here touches Canvas.

export const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100
export const fmt = x => String(round2(x))

// A lab's professionalism assignment has "professionalism" in its name, but
// so do the unit/term score assignments this tool (the Scoring tab)
// creates — e.g. "Safety and Sanitation Professionalism (Unit Score)". Those
// must never be counted as labs themselves, or a unit's own score assignment
// would feed back into its average once created. See PLAN.md Section 3.
const PROFESSIONALISM_RE = /professionalism/i
const SCORE_ASSIGNMENT_RE = /\((unit|term) score\)/i
export const isProfessionalismAssignment = name => PROFESSIONALISM_RE.test(name) && !SCORE_ASSIGNMENT_RE.test(name)

// Picks out a course's unit-score assignments specifically — the *input* to
// Term rollup in ScoringPanel.jsx, as opposed to isProfessionalismAssignment's
// job of excluding them from lab rollup.
export const isUnitScore = name => /\(unit score\)/i.test(name)
// Either kind of score assignment this tool pushes to (Unit or Term).
export const isScoreAssignment = name => SCORE_ASSIGNMENT_RE.test(name)

const toFour = (score, points) => (points && points > 0 ? (score / points) * 4 : score)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Attendance's deduction scoring: each deduction "mark" is a reason picked
// for a present student. Marks cost a full step immediately, then another
// step every `marksPerStep` marks after that (ceil, not floor) — e.g. with
// the defaults, 1 mark -> 3, 2 marks -> 3, 3 marks -> 2, 4 marks -> 2, ...
// Never goes below 0 regardless of pointsPossible.
export function scoreFromDeductions(markCount, { pointsPossible = 4, pointsPerStep = 1, marksPerStep = 2 } = {}) {
  if (markCount <= 0) return pointsPossible
  const steps = Math.ceil(markCount / marksPerStep)
  return Math.max(0, pointsPossible - steps * pointsPerStep)
}

// Classifies one student's submission on one lab assignment.
//   submission: { score: number|null, excused: boolean } | undefined (no submission row at all)
export function readSubmission(submission) {
  if (!submission || submission.excused) return { state: 'excused' }
  if (submission.score === null || submission.score === undefined) return { state: 'blank' }
  return { state: 'score', value: submission.score }
}

// labs: [{ id, name, pointsPossible }]
// submissionsByAssignmentId: { [assignmentId]: { score, excused } | undefined } for one student
export function scoreStudent(submissionsByAssignmentId, labs) {
  const notes = []
  const pool = []
  let missed = 0

  for (const lab of labs) {
    const c = readSubmission(submissionsByAssignmentId[lab.id])
    if (c.state === 'score') {
      if (c.value <= 0) missed++
      pool.push(c.value > 0 ? toFour(c.value, lab.pointsPossible) : 0)
    } else if (c.state === 'blank') {
      notes.push(`${lab.name} is blank and wasn't counted`)
    } else if (c.state === 'excused') {
      notes.push(`Excused from ${lab.name}`)
    }
  }

  const counted = pool.length
  if (counted === 0) return { value: null, missed, counted, notes: ['No lab scores yet', ...notes] }
  if (missed) notes.unshift(`${missed} of ${plural(counted, 'lab')} scored 0`)
  const avg = pool.reduce((a, v) => a + v, 0) / counted
  return { value: round2(avg), missed, counted, notes }
}

// students: [{ userId, ... }]; labs: the group's labs.
// submissionsByStudent: { [userId]: { [assignmentId]: { score, excused } } }
export function scoreGroup(students, labs, submissionsByStudent) {
  return students.map(s => scoreStudent(submissionsByStudent[s.userId] ?? {}, labs))
}

// unitResults: [{ name, result }], result a scoreStudent() output for one Unit.
// Each Unit counts once regardless of how many labs fed its own average.
// `missed` sums every Unit's own missed (0-scored) lab count, so an unresolved
// absence is still visible at the Term level even though it no longer skews
// the Term average the way it skews its own Unit.
export function scoreTermStudent(unitResults) {
  const notes = []
  const pool = []
  let missed = 0
  for (const { name, result } of unitResults) {
    missed += result.missed ?? 0
    if (result.value == null) notes.push(`No score yet in ${name}`)
    else pool.push(result.value)
  }
  const counted = pool.length
  if (counted === 0) return { value: null, missed, counted, notes: ['No Unit scores yet', ...notes] }
  const avg = pool.reduce((a, v) => a + v, 0) / counted
  return { value: round2(avg), missed, counted, notes }
}

// students: [{ userId, ... }]; units: the Term's Units, each { name, labs }.
// submissionsByStudent: { [userId]: { [assignmentId]: { score, excused } } }
export function scoreTermGroup(students, units, submissionsByStudent) {
  return students.map(s => {
    const subs = submissionsByStudent[s.userId] ?? {}
    const unitResults = units.map(u => ({ name: u.name, result: scoreStudent(subs, u.labs) }))
    return scoreTermStudent(unitResults)
  })
}

// A lab's paired journal already has a real grade while its professionalism
// score is still blank — a sign grading was simply never finished for this
// student that day, not that nothing happened. profSub/journalSub are each
// { score, excused } | undefined, the same shape readSubmission consumes.
function hasJournalGap(profSub, journalSub) {
  const journalGraded = journalSub && journalSub.score != null && !journalSub.excused
  const profBlank = !profSub || (profSub.score == null && !profSub.excused)
  return journalGraded && profBlank
}

// subs: one student's submissionsByAssignmentId. labs: [{ id, journalAssignmentId }].
// Counts, across the given labs, how many have this gap for this student.
export function journalGapCount(subs, labs) {
  return labs.filter(lab => lab.journalAssignmentId && hasJournalGap(subs[lab.id], subs[lab.journalAssignmentId])).length
}

// students: [{ userId, ... }]; labs: as above.
// submissionsByStudent: { [userId]: { [assignmentId]: { score, excused } } }
export function journalGapGroup(students, labs, submissionsByStudent) {
  return students.map(s => journalGapCount(submissionsByStudent[s.userId] ?? {}, labs))
}

// Single-lab, roster-free version: which userIds have the gap, read straight
// off the two assignments' own submission lists (as { [userId]: { score,
// excused } } maps). For screens with no full student roster loaded — e.g.
// the Professionalism tab's list, which only loads assignments, not enrollments.
export function journalGradedGaps(profSubs, journalSubs) {
  return Object.keys(journalSubs).filter(userId => hasJournalGap(profSubs[userId], journalSubs[userId]))
}

// Fallback "copy as spreadsheet column" export (students in the same order
// passed to scoreGroup).
export function columnText(students, results, title, withHeader) {
  const lines = []
  if (withHeader) lines.push(title)
  students.forEach((s, i) => {
    const r = results[i]
    lines.push(r && r.value !== null ? String(r.value) : '')
  })
  return lines.join('\n')
}
