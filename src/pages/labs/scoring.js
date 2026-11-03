// Unit and Term professionalism scoring. Originally ported from the standalone
// "professionalism-by-unit.html" tool; the rules changed on 2026-11-02 (see
// DECISIONS.md) once at-home makeups made an absence zero a placeholder rather
// than a final grade.
//
// Rules:
//   - Each graded lab is put on a 4-point scale via (score / pointsPossible) * 4.
//   - The score is the plain average of every graded lab, rounded to 2 decimals.
//     Nothing is dropped, and there is no automatic zero: an absence already
//     scores 0, and a makeup replaces it.
//   - A Term averages every lab in its Units directly, so each lab counts the
//     same however the labs are split into Units.
//   - Ungraded/unsubmitted labs are "blank": not counted, but noted.
//   - Excused labs are not counted, and noted.
//
// scoreStudent/scoreGroup are generic over "a list of labs with an
// id/name/pointsPossible and a submission lookup". Nothing here touches Canvas.

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
